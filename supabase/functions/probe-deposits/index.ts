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

    // Pull ALL rows
    const url = `${appfolioBase}/api/v0/reports/deposit_register.json?paginate_results=true&per_page=5000&from_date=2026-01-01&to_date=2026-03-17`;
    const resp = await fetch(url, {
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Accept": "application/json",
      },
    });
    const data = await resp.json();
    const rows = data.results || [];

    // Group by DepositNumber
    const deposits: Record<string, any[]> = {};
    for (const row of rows) {
      const depNum = row.DepositNumber || "unknown";
      if (!deposits[depNum]) deposits[depNum] = [];
      deposits[depNum].push(row);
    }

    // Find deposits with the most rows (likely have receipt breakdowns)
    const depositSizes = Object.entries(deposits)
      .map(([num, rows]) => ({ num, count: rows.length }))
      .sort((a, b) => b.count - a.count);

    // Show top 5 largest deposits with full data
    const largestDeposits: Record<string, any> = {};
    for (const { num } of depositSizes.slice(0, 5)) {
      const depRows = deposits[num];
      largestDeposits[num] = {
        row_count: depRows.length,
        rows: depRows.slice(0, 15),
      };
    }

    // Also show deposits 62-69 specifically (the ones user referenced)
    const bankDeposits62_69: Record<string, any> = {};
    for (let i = 62; i <= 69; i++) {
      const key = String(i);
      if (deposits[key]) {
        bankDeposits62_69[key] = {
          row_count: deposits[key].length,
          rows: deposits[key].slice(0, 10),
        };
      }
    }

    return new Response(JSON.stringify({
      total_rows: rows.length,
      total_deposits: Object.keys(deposits).length,
      deposit_sizes: depositSizes,
      largest_deposits: largestDeposits,
      bank_deposits_62_69: bankDeposits62_69,
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
