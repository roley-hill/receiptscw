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
          sourceFiles.push(basename + " (binary)");
        }
      }
    } else {
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
        JSON.stringify({ error: "No readable documents found. Please include rent rolls, leases, or CSV/text files." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const combinedText = textChunks
      .map((c) => `=== FILE: ${c.name} ===\n${c.content}`)
      .join("\n\n")
      .slice(0, 80000);

    const prompt = `You are an expert real estate data extractor. Analyze these Due Diligence documents and extract structured data to populate an AppFolio import spreadsheet exactly.

The AppFolio import template has these exact columns for each row (one row per unit/tenant):

- Unit Name: unit identifier (e.g. "101", "Unit 1", "A")
- Unit Address1: street address of the unit
- Unit Address2: apt/suite suffix if any
- Unit City
- Unit State: 2-letter state code
- Unit Postal Code
- Unit Tags: any tags (leave blank if unknown)
- Market Rent: market rent number only
- Square Feet: number only
- Bedrooms: number only (0 for studio)
- Bathrooms: number only
- Cats Allowed: Yes or No
- Dogs Allowed: Yes or No
- Primary Tenant First Name
- Primary Tenant Last Name
- Primary Tenant Company Name: company if applicable
- Primary Tenant Move In: MM/DD/YYYY format
- Primary Tenant Move Out: MM/DD/YYYY format (blank if still active)
- Lease From: MM/DD/YYYY format
- Lease To: MM/DD/YYYY format
- Unit Rent Charge: rent amount number only
- Unit Rent Frequency: Monthly
- Unit Rent Start Date: MM/DD/YYYY format
- Unit Rent End Date: MM/DD/YYYY format (usually blank)
- Primary Tenant Email Address
- Primary Tenant Phone Number #1: phone number
- Primary Tenant Phone Label #1: Home or Mobile or Work
- Primary Tenant Phone Notes #1: blank usually
- Tenant Tags: blank usually
- Tenant Address1: tenant mailing address if different
- Tenant Address2
- Tenant City
- Tenant State
- Tenant Postal Code
- Roommate First #1: first roommate/co-tenant first name
- Roommate Last #1: first roommate/co-tenant last name
- Roommate Email #1
- Roommate #1 Phone #1
- Roommate #1 Phone Label #1: Home or Mobile
- Roommate Move In #1: MM/DD/YYYY
- Roommate Move Out #1: MM/DD/YYYY
- Addt Recurring GL Account #1: GL account name for additional recurring charge (e.g. "Parking", "Pet Fee", "Storage")
- Addt Recurring Start Date #1: MM/DD/YYYY
- Addt Recurring End Date #1: MM/DD/YYYY (blank usually)
- Addt Recurring Charge Amount #1: number only
- Addt Recurring Frequency #1: Monthly
- 3300: Prepayment Amount: prepaid rent amount if any
- 3300: Prepayment Date: MM/DD/YYYY
- 3201: Security Deposits - Residential Amount: security deposit number only
- 3201: Security Deposits - Residential Date: date collected MM/DD/YYYY
- 3202: Security Deposits - Pets Amount: pet deposit number only
- 3202: Security Deposits - Pets Date: MM/DD/YYYY

Extract all data you can find. For vacant units, leave tenant fields blank. Use MM/DD/YYYY for all dates. Numbers should have no currency symbols.

Also identify property_name and any warnings about missing or uncertain data.

Respond ONLY with valid JSON:
{
  "property_name": "string",
  "property_address": "string",
  "property_city": "string",
  "property_state": "string",
  "property_zip": "string",
  "rows": [
    {
      "Unit Name": "",
      "Unit Address1": "",
      "Unit Address2": "",
      "Unit City": "",
      "Unit State": "",
      "Unit Postal Code": "",
      "Unit Tags": "",
      "Market Rent": "",
      "Square Feet": "",
      "Bedrooms": "",
      "Bathrooms": "",
      "Cats Allowed": "",
      "Dogs Allowed": "",
      "Primary Tenant First Name": "",
      "Primary Tenant Last Name": "",
      "Primary Tenant Company Name": "",
      "Primary Tenant Move In": "",
      "Primary Tenant Move Out": "",
      "Lease From": "",
      "Lease To": "",
      "Unit Rent Charge": "",
      "Unit Rent Frequency": "",
      "Unit Rent Start Date": "",
      "Unit Rent End Date": "",
      "Primary Tenant Email Address": "",
      "Primary Tenant Phone Number #1": "",
      "Primary Tenant Phone Label #1": "",
      "Primary Tenant Phone Notes #1": "",
      "Tenant Tags": "",
      "Tenant Address1": "",
      "Tenant Address2": "",
      "Tenant City": "",
      "Tenant State": "",
      "Tenant Postal Code": "",
      "Roommate First #1": "",
      "Roommate Last #1": "",
      "Roommate Email #1": "",
      "Roommate #1 Phone #1": "",
      "Roommate #1 Phone Label #1": "",
      "Roommate Move In #1": "",
      "Roommate Move Out #1": "",
      "Addt Recurring GL Account #1": "",
      "Addt Recurring Start Date #1": "",
      "Addt Recurring End Date #1": "",
      "Addt Recurring Charge Amount #1": "",
      "Addt Recurring Frequency #1": "",
      "3300: Prepayment Amount": "",
      "3300: Prepayment Date": "",
      "3201: Security Deposits - Residential Amount": "",
      "3201: Security Deposits - Residential Date": "",
      "3202: Security Deposits - Pets Amount": "",
      "3202: Security Deposits - Pets Date": ""
    }
  ],
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
        max_tokens: 16000,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      throw new Error(`AI extraction failed: ${errText}`);
    }

    const aiData = await aiResp.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    let extracted: any = {};
    try {
      const cleaned = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      extracted = JSON.parse(cleaned);
    } catch {
      const match = rawContent.match(/\{[\s\S]*\}/);
      if (match) {
        extracted = JSON.parse(match[0]);
      } else {
        throw new Error("AI returned unparseable response");
      }
    }

    const rows = extracted.rows || [];

    const result = {
      property_name: extracted.property_name || "Unknown Property",
      rows,
      summary: {
        rows_found: rows.length,
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
