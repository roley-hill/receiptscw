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
const MAX_FILE_BYTES = 512 * 1024; // 512 KB cap

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function cleanUnit(unit: string): string {
  return unit.replace(/^(unit|apt|apartment|suite|ste|#)\s*/i, "").replace(/^0+(?=\d)/, "").trim();
}

// ── Step 1: Lightweight PDF text extraction (no pdfjs) ───────────────────────

function extractTextFromPdfBytes(bytes: Uint8Array): string {
  try {
    const raw = new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.length, MAX_FILE_BYTES)));
    const chunks: string[] = [];

    const parenRe = /\(([^)\\]{1,300})\)/g;
    let m: RegExpExecArray | null;
    while ((m = parenRe.exec(raw)) !== null) {
      const s = m[1].replace(/\\n/g, " ").replace(/\\r/g, " ").replace(/[^\x20-\x7E]/g, "").trim();
      if (s.length > 2) chunks.push(s);
    }

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
    return extractTextFromPdfBytes(new Uint8Array(buf));
  } catch {
    return "";
  }
}

// ── Address detection ─────────────────────────────────────────────────────────

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

async function detectAddressViaAI(ocrText: string): Promise<AddressResult> {
  if (!ocrText || ocrText.length < 20) {
    return { address: "", city: "", state: "", postal_code: "", confidence: 0, method: "ai" };
  }
  const raw = await callAI([{
    role: "user",
    content: `Extract the PROPERTY building address from this document text (NOT a tenant mailing address).
Return ONLY valid JSON, no markdown fences:
{ "address": "full street address", "city": "city", "state": "2-letter state", "postal_code": "5-digit zip", "confidence": 0.0-1.0 }
If you cannot determine it, set confidence to 0 and all fields to empty strings.

Document text:
${ocrText.slice(0, 3000)}`,
  }]);
  const jsonStr = raw.replace(/```json\n?/gi, "").replace(/```/g, "").trim();
  try {
    return { ...JSON.parse(jsonStr), method: "ai" };
  } catch {
    return { address: "", city: "", state: "", postal_code: "", confidence: 0, method: "ai" };
  }
}

async function detectAddress(file: File): Promise<AddressResult> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const ocrText = isPdf ? await extractTextFromPdf(file) : "";

  if (ocrText.length > 80) {
    const ocr = detectAddressFromText(ocrText);
    if (ocr && ocr.confidence >= 0.6 && ocr.address) return ocr;
  }

  return detectAddressViaAI(ocrText);
}

// ── Document classification ───────────────────────────────────────────────────

type DocCategory = "lease" | "rent-roll" | "notice" | "estoppel" | "other";

interface ClassifyResult {
  category: DocCategory;
  unit: string;
  tenant_last: string;
  tenant_first: string;
  effective_date: string;
  building_address: string;
  confidence: number;
  method: "ocr" | "ai";
}

const CATEGORY_KEYWORDS: Array<{ category: DocCategory; patterns: RegExp[] }> = [
  { category: "lease", patterns: [/\b(lease\s+agreement|rental\s+agreement|tenancy\s+agreement|residential\s+lease|lease\s+contract)\b/i] },
  { category: "rent-roll", patterns: [/\b(rent\s+roll|rent\s+schedule|current\s+rents|rental\s+schedule|monthly\s+rent\s+summary)\b/i] },
  { category: "notice", patterns: [/\b(notice\s+to\s+(quit|vacate|pay|comply)|3[-\s]day\s+notice|30[-\s]day\s+notice|60[-\s]day\s+notice|notice\s+of\s+(termination|eviction))\b/i] },
  { category: "estoppel", patterns: [/\b(estoppel\s+certificate|tenant\s+estoppel|estoppel\s+letter|tenant\s+certification)\b/i] },
];

const UNIT_PATTERN = /\b(?:unit|apt|apartment|suite|ste|#)\s*([A-Za-z0-9-]+)\b/i;
const DATE_PATTERN = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/;
const TENANT_PATTERN = /\b(?:tenant|lessee|resident)s?\s*[:\-–]?\s*([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/;

function classifyFromText(text: string, filename: string): ClassifyResult | null {
  let category: DocCategory | null = null;
  for (const { category: cat, patterns } of CATEGORY_KEYWORDS) {
    if (patterns.some((p) => p.test(text))) { category = cat; break; }
  }
  if (!category) {
    const fn = filename.toLowerCase();
    if (fn.includes("lease") || fn.includes("rental")) category = "lease";
    else if (fn.includes("rent roll") || fn.includes("rentroll")) category = "rent-roll";
    else if (fn.includes("notice")) category = "notice";
    else if (fn.includes("estoppel")) category = "estoppel";
  }
  if (!category) return null;

  const unitMatch = UNIT_PATTERN.exec(text);
  const unit = unitMatch ? cleanUnit(unitMatch[1]) : "";
  const dateMatch = DATE_PATTERN.exec(text);
  let effectiveDate = "";
  if (dateMatch) {
    const [, m, d, y] = dateMatch;
    const year = y.length === 2 ? `20${y}` : y;
    effectiveDate = `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const tenantMatch = TENANT_PATTERN.exec(text);
  STREET_PATTERN.lastIndex = 0;
  const addrMatch = STREET_PATTERN.exec(text);

  return {
    category,
    unit,
    tenant_last: tenantMatch?.[2] ?? "",
    tenant_first: tenantMatch?.[1] ?? "",
    effective_date: effectiveDate || new Date().toISOString().slice(0, 10),
    building_address: addrMatch?.[0]?.trim() ?? "",
    confidence: [unit, effectiveDate, tenantMatch?.[2]].filter(Boolean).length >= 2 ? 0.8 : 0.6,
    method: "ocr",
  };
}

async function classifyViaAI(file: File, propertyAddress: string, ocrText: string): Promise<ClassifyResult> {
  const textSnippet = ocrText ? `\n\nExtracted text (first 2000 chars):\n${ocrText.slice(0, 2000)}` : "";
  const parts: unknown[] = [{
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
  }];

  if (!ocrText) {
    try {
      const buf = await file.arrayBuffer();
      const limited = new Uint8Array(buf, 0, Math.min(buf.byteLength, MAX_FILE_BYTES));
      let binary = "";
      const CHUNK = 8192;
      for (let i = 0; i < limited.length; i += CHUNK) binary += String.fromCharCode(...limited.subarray(i, i + CHUNK));
      const b64 = btoa(binary);
      parts.push({ type: "image_url", image_url: { url: `data:${file.type || "application/pdf"};base64,${b64}` } });
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

function buildFilename(info: ClassifyResult, original: string, dealSlug: string): { renamed_to: string; building_slug: string } {
  const ext = original.includes(".") ? `.${original.split(".").pop()}` : ".pdf";
  const normExt = ext.toLowerCase() === ".pdf" ? ".pdf" : ext;
  const date = info.effective_date || new Date().toISOString().slice(0, 10);
  const unit = info.unit || "XX";

  let renamed_to: string;
  switch (info.category) {
    case "lease":      renamed_to = `LEASE_${unit}_${info.tenant_last || "Unknown"}-${info.tenant_first || "Unknown"}_${date}${normExt}`; break;
    case "rent-roll":  renamed_to = `RENTROLL_${slugify(info.building_address || dealSlug)}_${date}${normExt}`; break;
    case "notice":     renamed_to = `NOTICE_${unit}_${info.tenant_last || "Unknown"}-${info.tenant_first || "Unknown"}_${date}${normExt}`; break;
    case "estoppel":   renamed_to = `ESTOPPEL_${unit}_${info.tenant_last || "Unknown"}-${info.tenant_first || "Unknown"}_${date}${normExt}`; break;
    default:           renamed_to = `DOC_${original.replace(/[^a-zA-Z0-9._-]/g, "_")}`; break;
  }

  const building_slug = info.building_address
    ? slugify(info.building_address.split(",")[0].trim()) || dealSlug
    : dealSlug;

  return { renamed_to, building_slug };
}

// ── Serve ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const formData = await req.formData();
    const action = formData.get("action") as string;

    // ── Action: detect_address ─────────────────────────────────────────────────
    // Send one file; returns AddressResult
    if (action === "detect_address") {
      let firstFile: File | null = null;
      for (const [k, v] of formData.entries()) {
        if (k === "files" && v instanceof File) { firstFile = v; break; }
      }
      if (!firstFile) {
        return new Response(JSON.stringify({ error: "No file provided" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await detectAddress(firstFile);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Action: create_deal ────────────────────────────────────────────────────
    // Creates the deal + package records, returns { deal_id, package_id }
    if (action === "create_deal") {
      const dealName = formData.get("deal_name") as string;
      const propertyAddress = formData.get("property_address") as string;
      const addressCity = (formData.get("address_city") as string) || "";
      const addressState = (formData.get("address_state") as string) || "";
      const addressPostalCode = (formData.get("address_postal_code") as string) || "";
      const userIdRaw = formData.get("user_id") as string | null;
      const totalFiles = parseInt(formData.get("total_files") as string || "0", 10);

      if (!dealName || !propertyAddress) {
        return new Response(JSON.stringify({ error: "deal_name and property_address required" }), {
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
        total_files: totalFiles, processed_files: 0,
        storage_prefix: storagePrefix, created_by: userIdRaw ?? null,
      });

      return new Response(JSON.stringify({ deal_id: deal.id, package_id: pkgId, deal_slug: dealSlug, storage_prefix: storagePrefix }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Action: process_file ───────────────────────────────────────────────────
    // Send ONE file + deal context; OCR → classify → upload → insert db row
    if (action === "process_file") {
      const dealId = formData.get("deal_id") as string;
      const packageId = formData.get("package_id") as string;
      const dealSlug = formData.get("deal_slug") as string;
      const storagePrefix = formData.get("storage_prefix") as string;
      const propertyAddress = formData.get("property_address") as string;

      let file: File | null = null;
      for (const [k, v] of formData.entries()) {
        if (k === "file" && v instanceof File) { file = v; break; }
      }
      if (!file || !dealId || !packageId) {
        return new Response(JSON.stringify({ error: "file, deal_id and package_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 1. OCR
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const ocrText = isPdf ? await extractTextFromPdf(file) : "";
      const hasText = ocrText.length > 80;

      // 2. Classify (OCR first, AI fallback)
      let classResult: ClassifyResult | null = hasText ? classifyFromText(ocrText, file.name) : null;
      let method: "ocr" | "ai" | "ocr+ai" = "ocr";
      if (!classResult) {
        classResult = await classifyViaAI(file, propertyAddress, ocrText);
        method = hasText ? "ocr+ai" : "ai";
      }

      const { renamed_to, building_slug } = buildFilename(classResult, file.name, dealSlug);
      const folder = classResult.category;
      const unitPath = classResult.unit ? `units/${classResult.unit}/` : "";
      const storagePath = `${storagePrefix}/buildings/${building_slug}/${unitPath}${folder}/${renamed_to}`;

      // 3. Upload to storage
      const { error: uploadErr } = await supabase.storage
        .from("dd-documents").upload(storagePath, file, { upsert: true });
      if (uploadErr) console.error(`Upload failed for ${file.name}:`, uploadErr.message);

      // 4. Insert db row
      const { data: sfRow } = await supabase.from("dd_sorted_files").insert({
        package_id: packageId, deal_id: dealId,
        original_name: file.name, renamed_to,
        category: classResult.category, building_slug,
        unit: classResult.unit, storage_path: storagePath,
        ai_confidence: classResult.confidence,
      }).select().single();

      return new Response(JSON.stringify({
        id: sfRow?.id,
        original_name: file.name,
        renamed_to,
        category: classResult.category,
        building_slug,
        unit: classResult.unit,
        confidence: classResult.confidence,
        method,
        storage_path: storagePath,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Action: finalize_package ───────────────────────────────────────────────
    if (action === "finalize_package") {
      const packageId = formData.get("package_id") as string;
      const processedFiles = parseInt(formData.get("processed_files") as string || "0", 10);
      await supabase.from("dd_packages")
        .update({ status: "done", processed_files: processedFiles })
        .eq("id", packageId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
