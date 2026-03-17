import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientId = Deno.env.get("APPFOLIO_CLIENT_ID");
    const clientSecret = Deno.env.get("APPFOLIO_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error("AppFolio credentials not configured");

    const appfolioBase = "https://countywidemanagement.appfolio.com";
    const basicAuth = btoa(`${clientId}:${clientSecret}`);

    // Pull first 200 rows to analyze deposit grouping structure
    const url = `${appfolioBase}/api/v0/reports/deposit_register.json?paginate_results=true&per_page=200&from_date=2026-01-01&to_date=2026-03-17`;
    const resp = await fetch(url, {
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Accept": "application/json",
      },
    });
    const data = await resp.json();
    const rows = data.results || [];

    // Analyze: group by DepositNumber to understand the structure
    const deposits: Record<string, any[]> = {};
    for (const row of rows) {
      const depNum = row.DepositNumber || "unknown";
      if (!deposits[depNum]) deposits[depNum] = [];
      deposits[depNum].push(row);
    }

    // Show first 3 deposits with all their rows
    const sampleDeposits: Record<string, any> = {};
    let count = 0;
    for (const [depNum, depRows] of Object.entries(deposits)) {
      if (count >= 5) break;
      sampleDeposits[depNum] = {
        row_count: depRows.length,
        rows: depRows.slice(0, 20), // first 20 rows of each deposit
      };
      count++;
    }

    // Also get unique deposit numbers across all data
    const uniqueDepositNumbers = Object.keys(deposits);

    return new Response(JSON.stringify({
      total_rows_in_page: rows.length,
      has_next_page: !!data.next_page_url,
      unique_deposits_in_page: uniqueDepositNumbers.length,
      deposit_numbers: uniqueDepositNumbers,
      sample_deposits: sampleDeposits,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
