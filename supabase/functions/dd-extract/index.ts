import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth check
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const formData = await req.formData();
    const uploadType = formData.get("upload_type") as string;

    // Collect text content from all files
    const textChunks: { name: string; content: string }[] = [];
    const sourceFiles: string[] = [];

    const RELEVANT_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".csv", ".docx", ".txt", ".eml"];

    const isRelevant = (name: string) =>
      RELEVANT_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext)) ||
      name.toLowerCase().includes("rent roll") ||
      name.toLowerCase().includes("lease") ||
      name.toLowerCase().includes("tenant");

    if (uploadType === "zip") {
      const zipFile = formData.get("file") as File;
      if (!zipFile) throw new Error("No zip file provided");

      const zipBuffer = await zipFile.arrayBuffer();
      const zip = await JSZip.loadAsync(zipBuffer);

      for (const [filename, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        const basename = filename.split("/").pop() || filename;
        if (!isRelevant(basename)) continue;

        try {
          const content = await zipEntry.async("string");
          textChunks.push({ name: basename, content: content.slice(0, 15000) });
          sourceFiles.push(basename);
        } catch {
          // Binary file — skip text extraction
          sourceFiles.push(basename + " (binary)");
        }
      }
    } else {
      // Folder: multiple files
      const files = formData.getAll("files") as File[];
      for (const f of files) {
        const basename = (f as any).name || "unknown";
        if (!isRelevant(basename)) continue;

        try {
          const text = await f.text();
          textChunks.push({ name: basename, content: text.slice(0, 15000) });
          sourceFiles.push(basename);
        } catch {
          sourceFiles.push(basename + " (binary)");
        }
      }
    }

    if (textChunks.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No readable documents found. Please include rent rolls, leases, or CSV/text files.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build a combined text for AI extraction (cap at ~80k chars total)
    const combinedText = textChunks
      .map((c) => `=== FILE: ${c.name} ===\n${c.content}`)
      .join("\n\n")
      .slice(0, 80000);

    const prompt = `You are an expert real estate data extractor. Analyze the following documents from a Due Diligence package and extract structured data for an AppFolio import.

Extract as much data as possible for these four sheets:

1. UNITS: unit_number, unit_type (e.g. 1BD/1BA), bedrooms, bathrooms, sqft, market_rent
2. TENANTS: unit_number, first_name, last_name, email, phone, lease_start (YYYY-MM-DD), lease_end (YYYY-MM-DD), move_in (YYYY-MM-DD), rent_amount (number only), status (Current/Vacant/Month-to-Month)
3. CHARGES: unit_number, tenant_name, charge_type (Rent/Pet Fee/Parking/Storage/etc.), amount (number only), frequency (Monthly/One-Time), effective_date (YYYY-MM-DD)
4. DEPOSITS: unit_number, tenant_name, deposit_type (Security Deposit/Pet Deposit/etc.), amount (number only)

Also identify:
- property_name: the property name or address
- warnings: list of data quality issues or missing fields

Respond ONLY with valid JSON in this exact schema:
{
  "property_name": "string",
  "units": [{"unit_number":"","unit_type":"","bedrooms":"","bathrooms":"","sqft":"","market_rent":""}],
  "tenants": [{"unit_number":"","first_name":"","last_name":"","email":"","phone":"","lease_start":"","lease_end":"","move_in":"","rent_amount":"","status":""}],
  "charges": [{"unit_number":"","tenant_name":"","charge_type":"","amount":"","frequency":"","effective_date":""}],
  "deposits": [{"unit_number":"","tenant_name":"","deposit_type":"","amount":""}],
  "warnings": ["string"]
}

DOCUMENTS:
${combinedText}`;

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("AI API key not configured");

    const aiResp = await fetch("https://router.lovable.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 8000,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      throw new Error(`AI extraction failed: ${errText}`);
    }

    const aiData = await aiResp.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    // Parse JSON from AI response
    let extracted: any = {};
    try {
      // Strip markdown code fences if present
      const cleaned = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      extracted = JSON.parse(cleaned);
    } catch {
      // Try to find JSON in response
      const match = rawContent.match(/\{[\s\S]*\}/);
      if (match) {
        extracted = JSON.parse(match[0]);
      } else {
        throw new Error("AI returned unparseable response");
      }
    }

    const result = {
      property_name: extracted.property_name || "Unknown Property",
      units: extracted.units || [],
      tenants: extracted.tenants || [],
      charges: extracted.charges || [],
      deposits: extracted.deposits || [],
      summary: {
        units_found: (extracted.units || []).length,
        tenants_found: (extracted.tenants || []).length,
        charges_found: (extracted.charges || []).length,
        deposits_found: (extracted.deposits || []).length,
        source_files: sourceFiles,
        warnings: extracted.warnings || [],
      },
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("DD extract error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
