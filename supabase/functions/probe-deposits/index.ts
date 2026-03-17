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

    async function probe(path: string): Promise<{ status: number; sample: string; keys: string[] }> {
      const url = `${appfolioBase}${path}`;
      console.log(`Probing: ${url}`);
      const resp = await fetch(url, {
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Accept": "application/json",
        },
      });
      const text = await resp.text();
      let keys: string[] = [];
      try {
        const json = JSON.parse(text);
        keys = Object.keys(json);
        // If there's a results array, get keys of first item
        const arr = json.results || json.data || (Array.isArray(json) ? json : null);
        if (arr && arr.length > 0) {
          keys.push(`--- first_item_keys: ${Object.keys(arr[0]).join(", ")}`);
          keys.push(`--- first_item_sample: ${JSON.stringify(arr[0]).substring(0, 500)}`);
          keys.push(`--- total_results: ${arr.length}`);
        }
      } catch { /* not json */ }
      return { status: resp.status, sample: text.substring(0, 300), keys };
    }

    const params = "?paginate_results=true&per_page=5&from_date=2026-01-01&to_date=2026-03-17";
    
    const results: Record<string, any> = {};

    // Try all plausible deposit-related endpoints
    const endpoints = [
      `/api/v0/reports/deposit_detail.json${params}`,
      `/api/v0/reports/deposit_register.json${params}`,
      `/api/v0/reports/bank_deposit.json${params}`,
      `/api/v0/reports/receipt_detail.json${params}`,
      `/api/v0/reports/receipt_register.json${params}`,
      `/api/v2/bank_deposits.json?per_page=5&from_date=2026-01-01`,
      `/api/v2/deposits.json?per_page=5&from_date=2026-01-01`,
      `/api/v2/receipts.json?per_page=5&from_date=2026-01-01`,
      `/api/v1/reports/deposit_detail.json${params}`,
      `/api/v1/reports/receipt_detail.json${params}`,
      // General Ledger filtered to see if deposit refs are there
      `/api/v0/reports/general_ledger_detail.json?paginate_results=true&per_page=5&from_date=2026-01-01&to_date=2026-03-17`,
      // Try tenant ledgers to see receipt/deposit refs
      `/api/v0/reports/tenant_receivables_detail.json${params}`,
    ];

    for (const ep of endpoints) {
      try {
        results[ep] = await probe(ep);
      } catch (e) {
        results[ep] = { status: -1, sample: String(e), keys: [] };
      }
    }

    return new Response(JSON.stringify({ results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("probe error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
