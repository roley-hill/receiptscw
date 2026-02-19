import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";
const MAX_FILE_BYTES = 512 * 1024; // 512 KB cap for AI vision payloads

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function cleanUnit(unit: string): string {
  return unit.replace(/^(unit|apt|apartment|suite|ste|#)\s*/i, "").replace(/^0+(?=\d)/, "").trim();
}

// ── Step 1: PDF Text Extraction (lightweight byte scan, no pdfjs) ────────────
// Reads raw PDF bytes and pulls printable ASCII text streams out directly.
// This avoids loading pdfjs-dist which causes memory limit errors in edge functions.

function extractTextFromPdfBytes(bytes: Uint8Array): string {
  try {
    // Decode bytes as latin-1 so we can scan for PDF stream content
    const raw = new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.length, MAX_FILE_BYTES)));

    // Extract content between BT (begin text) and ET (end text) PDF operators
    const chunks: string[] = [];

    // Match parenthesized strings: (text content) inside streams
    const parenRe = /\(([^)\\]{1,300})\)/g;
    let m: RegExpExecArray | null;
    while ((m = parenRe.exec(raw)) !== null) {
      const s = m[1].replace(/\\n/g, " ").replace(/\\r/g, " ").replace(/[^\x20-\x7E]/g, "").trim();
      if (s.length > 2) chunks.push(s);
    }

    // Also match hex strings: <48656c6c6f> → "Hello"
    const hexRe = /<([0-9a-fA-F]{4,})>/g;
    while ((m = hexRe.exec(raw)) !== null) {
      const hex = m[1];
      let decoded = "";
      for (let i = 0; i < hex.length - 1; i += 2) {
        const code = parseInt(hex.slice(i, i + 2), 16);
        if (code >= 0x20 && code <= 0x7e) decoded += String.fromCharCode(code);
      }
      if (decoded.length > 2) chunks.push(decoded);
    }

    return chunks.join(" ").slice(0, 8000);
  } catch (err) {
    console.warn("PDF byte scan failed:", err instanceof Error ? err.message : err);
    return "";
  }
}

async function extractTextFromPdf(file: File): Promise<string> {
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    return extractTextFromPdfBytes(bytes);
  } catch {
    return "";
  }
}

// ── Step 2a: Address detection from text (regex, no AI) ───────────────────────

interface AddressResult {
  address: string;
  city: string;
  state: string;
  postal_code: string;
  confidence: number;
  method: "ocr" | "ai";
}

const STREET_PATTERN =
  /\b(\d{1,5})\s+([A-Za-z0-9 .'-]{2,40}?)\s+(Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Court|Ct|Place|Pl|Way|Circle|Cir|Terrace|Ter|Parkway|Pkwy|Highway|Hwy)\.?\b/gi;

const CITY_STATE_ZIP =
  /([A-Za-z ]{2,30}),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/g;

function detectAddressFromText(text: string): AddressResult | null {
  STREET_PATTERN.lastIndex = 0;
  CITY_STATE_ZIP.lastIndex = 0;

  const streetMatch = STREET_PATTERN.exec(text);
  if (!streetMatch) return null;

  const address = streetMatch[0].trim();
  CITY_STATE_ZIP.lastIndex = Math.max(0, streetMatch.index - 10);
  const cityMatch = CITY_STATE_ZIP.exec(text);

  return {
    address,
    city: cityMatch?.[1]?.trim() ?? "",
    state: cityMatch?.[2]?.trim() ?? "",
    postal_code: cityMatch?.[3]?.trim() ?? "",
    confidence: cityMatch ? 0.85 : 0.6,
    method: "ocr",
  };
}

// ── Step 2b: Document classification from text (keywords, no AI) ──────────────

type DocCategory = "lease" | "rent-roll" | "notice" | "estoppel" | "other";

interface ClassifyResult {
  category: DocCategory;
  unit: string;
  tenant_last: string;
  tenant_first: string;
  effective_date: string; // YYYY-MM-DD
  building_address: string;
  confidence: number;
  method: "ocr" | "ai";
}

const CATEGORY_KEYWORDS: Array<{ category: DocCategory; patterns: RegExp[] }> = [
  {
    category: "lease",
    patterns: [
      /\b(lease\s+agreement|rental\s+agreement|tenancy\s+agreement|residential\s+lease|lease\s+contract)\b/i,
    ],
  },
  {
    category: "rent-roll",
    patterns: [
      /\b(rent\s+roll|rent\s+schedule|current\s+rents|rental\s+schedule|monthly\s+rent\s+summary)\b/i,
    ],
  },
  {
    category: "notice",
    patterns: [
      /\b(notice\s+to\s+(quit|vacate|pay|comply)|3[-\s]day\s+notice|30[-\s]day\s+notice|60[-\s]day\s+notice|notice\s+of\s+(termination|eviction))\b/i,
    ],
  },
  {
    category: "estoppel",
    patterns: [
      /\b(estoppel\s+certificate|tenant\s+estoppel|estoppel\s+letter|tenant\s+certification)\b/i,
    ],
  },
];

const UNIT_PATTERN = /\b(?:unit|apt|apartment|suite|ste|#)\s*([A-Za-z0-9-]+)\b/i;
const DATE_PATTERN = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/;
const TENANT_PATTERN =
  /\b(?:tenant|lessee|resident)s?\s*[:\-–]?\s*([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/;

function classifyFromText(text: string, filename: string): ClassifyResult | null {
  // Find category
  let category: DocCategory | null = null;
  for (const { category: cat, patterns } of CATEGORY_KEYWORDS) {
    if (patterns.some((p) => p.test(text))) { category = cat; break; }
  }

  // Filename hints as fallback
  if (!category) {
    const fn = filename.toLowerCase();
    if (fn.includes("lease") || fn.includes("rental")) category = "lease";
    else if (fn.includes("rent roll") || fn.includes("rentroll")) category = "rent-roll";
    else if (fn.includes("notice")) category = "notice";
    else if (fn.includes("estoppel")) category = "estoppel";
  }

  if (!category) return null; // can't classify without AI

  // Extract unit
  const unitMatch = UNIT_PATTERN.exec(text);
  const unit = unitMatch ? cleanUnit(unitMatch[1]) : "";

  // Extract date (take first full date found)
  const dateMatch = DATE_PATTERN.exec(text);
  let effectiveDate = "";
  if (dateMatch) {
    const [, m, d, y] = dateMatch;
    const year = y.length === 2 ? `20${y}` : y;
    effectiveDate = `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Extract tenant
  const tenantMatch = TENANT_PATTERN.exec(text);
  const tenantFirst = tenantMatch?.[1] ?? "";
  const tenantLast = tenantMatch?.[2] ?? "";

  // Extract address from text for building_slug
  STREET_PATTERN.lastIndex = 0;
  const addrMatch = STREET_PATTERN.exec(text);
  const buildingAddress = addrMatch?.[0]?.trim() ?? "";

  const confidence = [unit, effectiveDate, tenantLast].filter(Boolean).length >= 2 ? 0.8 : 0.6;

  return {
    category,
    unit,
    tenant_last: tenantLast,
    tenant_first: tenantFirst,
    effective_date: effectiveDate || new Date().toISOString().slice(0, 10),
    building_address: buildingAddress,
    confidence,
    method: "ocr",
  };
}

// ── Step 3: AI helpers (fallback only) ────────────────────────────────────────

async function fileToBase64Limited(file: File): Promise<{ b64: string; mime: string }> {
  const buf = await file.arrayBuffer();
  const limited = new Uint8Array(buf, 0, Math.min(buf.byteLength, MAX_FILE_BYTES));
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < limited.length; i += CHUNK) {
    binary += String.fromCharCode(...limited.subarray(i, i + CHUNK));
  }
  return { b64: btoa(binary), mime: file.type || "application/pdf" };
}

async function callAI(messages: unknown[]): Promise<string> {
  const resp = await fetch(AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 512 }),
  });
  if (resp.status === 429) throw new Error("Rate limit exceeded — please try again shortly.");
  if (resp.status === 402) throw new Error("AI credits exhausted — add funds to your workspace.");
  if (!resp.ok) throw new Error(`AI call failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function detectAddressViaAI(file: File): Promise<AddressResult> {
  const parts: unknown[] = [
    {
      type: "text",
      text: `Examine this document and extract the PROPERTY building address (NOT a tenant mailing address).
Return ONLY valid JSON, no markdown fences:
{ "address": "full street address", "city": "city", "state": "2-letter state", "postal_code": "5-digit zip", "confidence": 0.0-1.0 }
If you cannot determine it, set confidence to 0 and all fields to empty strings.`,
    },
  ];
  try {
    const { b64, mime } = await fileToBase64Limited(file);
    parts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } });
  } catch (_) { /* skip */ }

  const raw = await callAI([{ role: "user", content: parts }]);
  const jsonStr = raw.replace(/```json\n?/gi, "").replace(/```/g, "").trim();
  try {
    return { ...JSON.parse(jsonStr), method: "ai" };
  } catch {
    return { address: "", city: "", state: "", postal_code: "", confidence: 0, method: "ai" };
  }
}

async function classifyViaAI(file: File, propertyAddress: string, ocrText: string): Promise<ClassifyResult> {
  const textSnippet = ocrText ? `\n\nExtracted text (first 2000 chars):\n${ocrText.slice(0, 2000)}` : "";
  const parts: unknown[] = [
    {
      type: "text",
      text: `Real-estate document analyst. Classify this document and generate a standardized filename.
Categories: lease | rent-roll | notice | estoppel | other
Naming convention:
  Lease:     LEASE_{unit}_{LastName-FirstName}_{YYYY-MM-DD}.pdf
  Rent Roll: RENTROLL_{property-slug}_{YYYY-MM-DD}.pdf
  Notice:    NOTICE_{unit}_{LastName-FirstName}_{YYYY-MM-DD}.pdf
  Estoppel:  ESTOPPEL_{unit}_{LastName-FirstName}_{YYYY-MM-DD}.pdf
  Other:     DOC_{sanitized-original-name}
{unit} = bare number only (e.g. 11, not #11 or Apt 11).

Property: ${propertyAddress}
Original filename: ${file.name}${textSnippet}

Return ONLY valid JSON, no markdown fences:
{ "category": "...", "unit": "...", "tenant_last": "...", "tenant_first": "...", "effective_date": "YYYY-MM-DD", "building_address": "...", "confidence": 0.0-1.0 }`,
    },
  ];

  // Only send image bytes if OCR got nothing (scanned PDF)
  if (!ocrText) {
    try {
      const { b64, mime } = await fileToBase64Limited(file);
      parts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } });
    } catch (_) { /* skip */ }
  }

  try {
    const raw = await callAI([{ role: "user", content: parts }]);
    const jsonStr = raw.replace(/```json\n?/gi, "").replace(/```/g, "").trim();
    const p = JSON.parse(jsonStr);
    return {
      category: (["lease","rent-roll","notice","estoppel","other"].includes(p.category) ? p.category : "other") as DocCategory,
      unit: p.unit || "",
      tenant_last: p.tenant_last || "",
      tenant_first: p.tenant_first || "",
      effective_date: p.effective_date || new Date().toISOString().slice(0, 10),
      building_address: p.building_address || "",
      confidence: p.confidence || 0.5,
      method: "ai",
    };
  } catch {
    return { category: "other", unit: "", tenant_last: "", tenant_first: "", effective_date: new Date().toISOString().slice(0, 10), building_address: "", confidence: 0.3, method: "ai" };
  }
}

// ── Step 4: Build standardized filename from classification result ─────────────

function buildFilename(info: ClassifyResult, original: string, dealSlug: string): { renamed_to: string; building_slug: string } {
  const ext = original.includes(".") ? `.${original.split(".").pop()}` : ".pdf";
  const normExt = ext.toLowerCase() === ".pdf" ? ".pdf" : ext;
  const date = info.effective_date || new Date().toISOString().slice(0, 10);
  const unit = info.unit || "XX";

  let renamed_to: string;
  switch (info.category) {
    case "lease":
      renamed_to = `LEASE_${unit}_${info.tenant_last || "Unknown"}-${info.tenant_first || "Unknown"}_${date}${normExt}`;
      break;
    case "rent-roll":
      renamed_to = `RENTROLL_${slugify(info.building_address || dealSlug)}_${date}${normExt}`;
      break;
    case "notice":
      renamed_to = `NOTICE_${unit}_${info.tenant_last || "Unknown"}-${info.tenant_first || "Unknown"}_${date}${normExt}`;
      break;
    case "estoppel":
      renamed_to = `ESTOPPEL_${unit}_${info.tenant_last || "Unknown"}-${info.tenant_first || "Unknown"}_${date}${normExt}`;
      break;
    default:
      renamed_to = `DOC_${original.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  }

  const building_slug = info.building_address
    ? slugify(info.building_address.split(",")[0].trim()) || dealSlug
    : dealSlug;

  return { renamed_to, building_slug };
}

// ── Orchestrator: OCR → regex → AI fallback ───────────────────────────────────

async function processFile(
  file: File,
  dealSlug: string,
  propertyAddress: string,
): Promise<{
  original_name: string;
  renamed_to: string;
  category: DocCategory;
  building_slug: string;
  unit: string;
  confidence: number;
  method: "ocr" | "ai" | "ocr+ai";
}> {
  // 1. Extract text via OCR (no AI)
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const ocrText = isPdf ? await extractTextFromPdf(file) : "";
  const hasText = ocrText.length > 80;

  // 2. Try OCR-based classification
  let classResult: ClassifyResult | null = hasText ? classifyFromText(ocrText, file.name) : null;

  // 3. Fall back to AI if OCR classification failed
  let method: "ocr" | "ai" | "ocr+ai" = "ocr";
  if (!classResult) {
    classResult = await classifyViaAI(file, propertyAddress, ocrText);
    method = hasText ? "ocr+ai" : "ai"; // ocr+ai means text was extracted but AI did the classification
  }

  const { renamed_to, building_slug } = buildFilename(classResult, file.name, dealSlug);

  return {
    original_name: file.name,
    renamed_to,
    category: classResult.category,
    building_slug,
    unit: classResult.unit,
    confidence: classResult.confidence,
    method,
  };
}

// ── Address detection orchestrator: OCR → regex → AI fallback ────────────────

async function detectAddress(file: File): Promise<AddressResult> {
  // 1. Try OCR first
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const ocrText = isPdf ? await extractTextFromPdf(file) : "";

  if (ocrText.length > 80) {
    const ocr = detectAddressFromText(ocrText);
    if (ocr && ocr.confidence >= 0.6 && ocr.address) {
      console.log(`Address detected via OCR: ${ocr.address}`);
      return ocr;
    }
  }

  // 2. Fall back to AI
  console.log("Address not found via OCR, falling back to AI");
  return detectAddressViaAI(file);
}

// ── Serve ─────────────────────────────────────────────────────────────────────

const CATEGORY_FOLDER: Record<string, string> = {
  lease: "lease", "rent-roll": "rent-roll", notice: "notice", estoppel: "estoppel", other: "other",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const formData = await req.formData();
    const action = formData.get("action") as string;

    // ── Phase 1: detect address (OCR first, AI fallback) ─────────────────────
    if (action === "detect_address") {
      let firstFile: File | null = null;
      for (const [k, v] of formData.entries()) {
        if (k === "files" && v instanceof File) { firstFile = v; break; }
      }
      if (!firstFile) {
        return new Response(JSON.stringify({ error: "No files provided" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await detectAddress(firstFile);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Phase 2: full processing (OCR first, AI fallback, one file at a time) ─
    if (action === "process") {
      const dealName = formData.get("deal_name") as string;
      const propertyAddress = formData.get("property_address") as string;
      const addressCity = (formData.get("address_city") as string) || "";
      const addressState = (formData.get("address_state") as string) || "";
      const addressPostalCode = (formData.get("address_postal_code") as string) || "";
      const userIdRaw = formData.get("user_id") as string | null;

      if (!dealName || !propertyAddress) {
        return new Response(JSON.stringify({ error: "deal_name and property_address required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const files: File[] = [];
      for (const [k, v] of formData.entries()) {
        if (k === "files" && v instanceof File) files.push(v);
      }
      if (!files.length) {
        return new Response(JSON.stringify({ error: "No files to process" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const dealSlug = slugify(dealName);

      const { data: deal, error: dealErr } = await supabase
        .from("dd_deals")
        .insert({ deal_name: dealName, property_address: propertyAddress, address_city: addressCity, address_state: addressState, address_postal_code: addressPostalCode, created_by: userIdRaw ?? null })
        .select().single();
      if (dealErr) throw new Error(`Failed to create deal: ${dealErr.message}`);

      const pkgId = crypto.randomUUID();
      const storagePrefix = `${dealSlug}/${pkgId}`;

      await supabase.from("dd_packages").insert({
        id: pkgId, deal_id: deal.id, status: "processing",
        total_files: files.length, processed_files: 0,
        storage_prefix: storagePrefix, created_by: userIdRaw ?? null,
      });

      const sortedFiles = [];

      // Process one file at a time to stay within memory budget
      for (const file of files) {
        const info = await processFile(file, dealSlug, propertyAddress);
        const folder = CATEGORY_FOLDER[info.category] ?? "other";
        const unitPath = info.unit ? `units/${info.unit}/` : "";
        const storagePath = `${storagePrefix}/buildings/${info.building_slug}/${unitPath}${folder}/${info.renamed_to}`;

        const { error: uploadErr } = await supabase.storage
          .from("dd-documents").upload(storagePath, file, { upsert: true });
        if (uploadErr) console.error(`Upload failed for ${file.name}:`, uploadErr.message);

        const { data: sfRow } = await supabase.from("dd_sorted_files").insert({
          package_id: pkgId, deal_id: deal.id,
          original_name: info.original_name, renamed_to: info.renamed_to,
          category: info.category, building_slug: info.building_slug,
          unit: info.unit, storage_path: storagePath, ai_confidence: info.confidence,
        }).select().single();

        sortedFiles.push({ ...info, storage_path: storagePath, id: sfRow?.id });
      }

      await supabase.from("dd_packages")
        .update({ status: "done", processed_files: files.length })
        .eq("id", pkgId);

      return new Response(
        JSON.stringify({ deal_id: deal.id, package_id: pkgId, deal_name: dealName, property_address: propertyAddress, total_files: files.length, files: sortedFiles }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("dd-sort error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
