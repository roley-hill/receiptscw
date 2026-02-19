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

// ── helpers ──────────────────────────────────────────────────────────────────

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Convert File → base64 data-URI (PDF/image) for Gemini vision */
async function fileToBase64(file: File): Promise<{ b64: string; mime: string }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // chunk encode to avoid stack overflow
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const b64 = btoa(binary);
  const mime = file.type || "application/pdf";
  return { b64, mime };
}

async function callAI(messages: unknown[]): Promise<string> {
  const resp = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 1024 }),
  });
  if (resp.status === 429) throw new Error("Rate limit exceeded — please try again shortly.");
  if (resp.status === 402) throw new Error("AI credits exhausted — add funds to your workspace.");
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`AI call failed: ${resp.status} ${t}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// ── address detection ─────────────────────────────────────────────────────────

async function detectAddress(files: File[]): Promise<{
  address: string;
  city: string;
  state: string;
  postal_code: string;
  confidence: number;
}> {
  // Use first 3 files only for speed
  const sample = files.slice(0, 3);

  const contentParts: unknown[] = [
    {
      type: "text",
      text: `You are a real-estate document analyst. Examine the attached document(s) and extract the PROPERTY address (building address, NOT a tenant's mailing address).
Return ONLY valid JSON (no markdown fences) in this shape:
{ "address": "full street address", "city": "city name", "state": "2-letter state code", "postal_code": "5-digit zip", "confidence": 0.0-1.0 }
If you cannot determine the address set confidence to 0 and leave the fields empty strings.`,
    },
  ];

  for (const file of sample) {
    try {
      const { b64, mime } = await fileToBase64(file);
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${b64}` },
      });
    } catch (_) {
      // skip unreadable files
    }
  }

  const raw = await callAI([{ role: "user", content: contentParts }]);
  // strip possible markdown fences
  const jsonStr = raw.replace(/```json\n?/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(jsonStr);
  } catch {
    return { address: "", city: "", state: "", postal_code: "", confidence: 0 };
  }
}

// ── file classification & naming ──────────────────────────────────────────────

interface ClassifiedFile {
  original_name: string;
  renamed_to: string;
  category: "lease" | "rent-roll" | "notice" | "estoppel" | "other";
  building_slug: string;
  unit: string;
  confidence: number;
}

async function classifyAndRename(
  file: File,
  dealSlug: string,
  propertyAddress: string,
): Promise<ClassifiedFile> {
  const contentParts: unknown[] = [
    {
      type: "text",
      text: `You are a real-estate document analyst. Examine this document and:
1. Classify it into ONE of: lease | rent-roll | notice | estoppel | other
2. Extract: tenant_last_name, tenant_first_name, unit_number, effective_date (YYYY-MM-DD), building_address
3. Generate a standardized file name following this convention:
   - Lease:     LEASE_{unit}_{LastName-FirstName}_{YYYY-MM-DD}.pdf
   - Rent Roll: RENTROLL_{property-slug}_{YYYY-MM-DD}.pdf  
   - Notice:    NOTICE_{unit}_{LastName-FirstName}_{YYYY-MM-DD}.pdf
   - Estoppel:  ESTOPPEL_{unit}_{LastName-FirstName}_{YYYY-MM-DD}.pdf
   - Other:     DOC_{sanitized-original-name}
   Where {unit} = stripped unit number (e.g. 11, not #11 or Apt 11)
   Where {property-slug} = slugified street address (e.g. 13412-vanowen-st)
   Use the ORIGINAL file extension if not a PDF.

Property address for context: ${propertyAddress}
Original filename: ${file.name}

Return ONLY valid JSON (no markdown fences):
{ "category": "lease|rent-roll|notice|estoppel|other", "renamed_to": "...", "unit": "...", "building_address": "...", "confidence": 0.0-1.0 }`,
    },
  ];

  try {
    const { b64, mime } = await fileToBase64(file);
    contentParts.push({
      type: "image_url",
      image_url: { url: `data:${mime};base64,${b64}` },
    });
  } catch (_) {
    // skip
  }

  let category: ClassifiedFile["category"] = "other";
  let renamed_to = `DOC_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  let unit = "";
  let confidence = 0.5;
  let building_slug = dealSlug;

  try {
    const raw = await callAI([{ role: "user", content: contentParts }]);
    const jsonStr = raw.replace(/```json\n?/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr);
    category = parsed.category ?? "other";
    renamed_to = parsed.renamed_to ?? renamed_to;
    unit = parsed.unit ?? "";
    confidence = parsed.confidence ?? 0.5;
    if (parsed.building_address) {
      building_slug = slugify(parsed.building_address.split(",")[0].trim()) || dealSlug;
    }
  } catch (_) {
    // keep defaults
  }

  return { original_name: file.name, renamed_to, category, building_slug, unit, confidence };
}

// ── category → folder map ─────────────────────────────────────────────────────
const CATEGORY_FOLDER: Record<string, string> = {
  lease: "lease",
  "rent-roll": "rent-roll",
  notice: "notice",
  estoppel: "estoppel",
  other: "other",
};

// ── serve ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const formData = await req.formData();
    const action = formData.get("action") as string; // "detect_address" | "process"

    // ── Phase 1: detect address from first few files ──────────────────────────
    if (action === "detect_address") {
      const files: File[] = [];
      for (const [key, value] of formData.entries()) {
        if (key === "files" && value instanceof File) files.push(value);
      }
      if (files.length === 0) {
        return new Response(JSON.stringify({ error: "No files provided" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await detectAddress(files);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Phase 2: full processing ──────────────────────────────────────────────
    if (action === "process") {
      const dealName = formData.get("deal_name") as string;
      const propertyAddress = formData.get("property_address") as string;
      const addressCity = formData.get("address_city") as string || "";
      const addressState = formData.get("address_state") as string || "";
      const addressPostalCode = formData.get("address_postal_code") as string || "";
      const userIdRaw = formData.get("user_id") as string | null;

      if (!dealName || !propertyAddress) {
        return new Response(JSON.stringify({ error: "deal_name and property_address are required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const files: File[] = [];
      for (const [key, value] of formData.entries()) {
        if (key === "files" && value instanceof File) files.push(value);
      }

      if (files.length === 0) {
        return new Response(JSON.stringify({ error: "No files to process" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const dealSlug = slugify(dealName);

      // Upsert deal record
      const { data: deal, error: dealError } = await supabase
        .from("dd_deals")
        .insert({
          deal_name: dealName,
          property_address: propertyAddress,
          address_city: addressCity,
          address_state: addressState,
          address_postal_code: addressPostalCode,
          created_by: userIdRaw ?? null,
        })
        .select()
        .single();

      if (dealError) throw new Error(`Failed to create deal: ${dealError.message}`);

      // Create package record
      const pkgId = crypto.randomUUID();
      const storagePrefix = `${dealSlug}/${pkgId}`;

      const { error: pkgError } = await supabase.from("dd_packages").insert({
        id: pkgId,
        deal_id: deal.id,
        status: "processing",
        total_files: files.length,
        processed_files: 0,
        storage_prefix: storagePrefix,
        created_by: userIdRaw ?? null,
      });

      if (pkgError) throw new Error(`Failed to create package: ${pkgError.message}`);

      // Process files concurrently (cap at 5 parallel)
      const results: ClassifiedFile[] = [];
      const BATCH = 5;
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH);
        const classified = await Promise.all(
          batch.map((f) => classifyAndRename(f, dealSlug, propertyAddress)),
        );
        results.push(...classified);
      }

      // Upload renamed files to storage + persist records
      const sortedFiles = [];
      for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        const info = results[idx];
        const folder = CATEGORY_FOLDER[info.category] ?? "other";
        const unitPath = info.unit ? `units/${info.unit}/` : "";
        const storagePath = `${storagePrefix}/buildings/${info.building_slug}/${unitPath}${folder}/${info.renamed_to}`;

        const { error: uploadError } = await supabase.storage
          .from("dd-documents")
          .upload(storagePath, file, { upsert: true });

        if (uploadError) {
          console.error(`Upload failed for ${file.name}:`, uploadError.message);
        }

        const { data: sfRow } = await supabase.from("dd_sorted_files").insert({
          package_id: pkgId,
          deal_id: deal.id,
          original_name: info.original_name,
          renamed_to: info.renamed_to,
          category: info.category,
          building_slug: info.building_slug,
          unit: info.unit,
          storage_path: storagePath,
          ai_confidence: info.confidence,
        }).select().single();

        sortedFiles.push({
          ...info,
          storage_path: storagePath,
          id: sfRow?.id,
        });
      }

      // Mark package done
      await supabase
        .from("dd_packages")
        .update({ status: "done", processed_files: files.length })
        .eq("id", pkgId);

      return new Response(
        JSON.stringify({
          deal_id: deal.id,
          package_id: pkgId,
          deal_name: dealName,
          property_address: propertyAddress,
          total_files: files.length,
          files: sortedFiles,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("dd-sort error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
