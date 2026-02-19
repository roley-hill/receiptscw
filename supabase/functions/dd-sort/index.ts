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

// Cap each file at 512 KB to avoid edge-function memory limits
const MAX_FILE_BYTES = 512 * 1024;

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

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
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 512 }),
  });
  if (resp.status === 429) throw new Error("Rate limit exceeded — please try again shortly.");
  if (resp.status === 402) throw new Error("AI credits exhausted — add funds to your workspace.");
  if (!resp.ok) throw new Error(`AI call failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// Phase 1: detect address from a single file (first only, to save memory)
async function detectAddress(file: File): Promise<{
  address: string; city: string; state: string; postal_code: string; confidence: number;
}> {
  const parts: unknown[] = [
    {
      type: "text",
      text: `You are a real-estate document analyst. Examine this document and extract the PROPERTY building address (NOT a tenant mailing address).
Return ONLY valid JSON, no markdown fences:
{ "address": "full street address", "city": "city", "state": "2-letter state", "postal_code": "5-digit zip", "confidence": 0.0-1.0 }
If you cannot determine it, set confidence to 0 and all other fields to empty strings.`,
    },
  ];
  try {
    const { b64, mime } = await fileToBase64Limited(file);
    parts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } });
  } catch (_) { /* skip */ }

  const raw = await callAI([{ role: "user", content: parts }]);
  const jsonStr = raw.replace(/```json\n?/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(jsonStr); }
  catch { return { address: "", city: "", state: "", postal_code: "", confidence: 0 }; }
}

interface ClassifiedFile {
  original_name: string;
  renamed_to: string;
  category: "lease" | "rent-roll" | "notice" | "estoppel" | "other";
  building_slug: string;
  unit: string;
  confidence: number;
}

// Phase 2a: classify + rename a single file (sequential, one at a time)
async function classifyAndRename(
  file: File, dealSlug: string, propertyAddress: string,
): Promise<ClassifiedFile> {
  const defaultRenamed = `DOC_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
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
{unit} = bare number only (11, not #11 or Apt 11). Keep original extension if not PDF.

Property: ${propertyAddress}
Original filename: ${file.name}

Return ONLY valid JSON, no markdown fences:
{ "category": "...", "renamed_to": "...", "unit": "...", "building_address": "...", "confidence": 0.0-1.0 }`,
    },
  ];
  try {
    const { b64, mime } = await fileToBase64Limited(file);
    parts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } });
  } catch (_) { /* skip */ }

  try {
    const raw = await callAI([{ role: "user", content: parts }]);
    const jsonStr = raw.replace(/```json\n?/gi, "").replace(/```/g, "").trim();
    const p = JSON.parse(jsonStr);
    return {
      original_name: file.name,
      renamed_to: p.renamed_to || defaultRenamed,
      category: (["lease","rent-roll","notice","estoppel","other"].includes(p.category) ? p.category : "other") as ClassifiedFile["category"],
      building_slug: p.building_address ? (slugify(p.building_address.split(",")[0].trim()) || dealSlug) : dealSlug,
      unit: p.unit || "",
      confidence: p.confidence || 0.5,
    };
  } catch {
    return { original_name: file.name, renamed_to: defaultRenamed, category: "other", building_slug: dealSlug, unit: "", confidence: 0.3 };
  }
}

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

    // ── Phase 1: detect address from first file only ──────────────────────────
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

    // ── Phase 2: full processing — ONE FILE AT A TIME ─────────────────────────
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
        .insert({
          deal_name: dealName, property_address: propertyAddress,
          address_city: addressCity, address_state: addressState,
          address_postal_code: addressPostalCode, created_by: userIdRaw ?? null,
        })
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

      // Process strictly one file at a time — no concurrency — to stay in memory budget
      for (const file of files) {
        const info = await classifyAndRename(file, dealSlug, propertyAddress);
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
        JSON.stringify({
          deal_id: deal.id, package_id: pkgId, deal_name: dealName,
          property_address: propertyAddress, total_files: files.length, files: sortedFiles,
        }),
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
