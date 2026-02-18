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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || supabaseServiceKey;

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
    if (!clientId || !clientSecret) {
      throw new Error("AppFolio API credentials not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const appfolioBase = "https://countywidemanagement.appfolio.com";
    const basicAuth = btoa(`${clientId}:${clientSecret}`);

    async function appfolioFetch(path: string): Promise<any> {
      const url = `${appfolioBase}${path}`;
      console.log(`AppFolio fetch: ${url}`);
      const resp = await fetch(url, {
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Accept": "application/json",
        },
      });
      if (!resp.ok) {
        const err = await resp.text();
        console.error(`AppFolio ${resp.status}: ${err.substring(0, 300)}`);
        return null;
      }
      const text = await resp.text();
      console.log(`AppFolio response (${text.length} chars): ${text.substring(0, 800)}`);
      return JSON.parse(text);
    }

    // Try rent roll report endpoint
    let allCharges: any[] = [];
    let nextUrl: string | null = "/api/v2/reports/rent_roll.json?paginate_results=true&per_page=200";

    while (nextUrl) {
      const data = await appfolioFetch(nextUrl);
      if (!data) break;

      const results = data.results || data.data || (Array.isArray(data) ? data : []);
      allCharges = allCharges.concat(results);

      if (data.next_page_url) {
        nextUrl = data.next_page_url.startsWith("http")
          ? data.next_page_url.replace(appfolioBase, "")
          : data.next_page_url;
      } else {
        nextUrl = null;
      }
    }

    // Fallback: try v1
    if (allCharges.length === 0) {
      console.log("v2 rent_roll empty, trying v1...");
      const v1Data = await appfolioFetch("/api/v1/reports/rent_roll.json?paginate_results=true&per_page=200");
      if (v1Data) {
        allCharges = v1Data.results || v1Data.data || (Array.isArray(v1Data) ? v1Data : []);
      }
    }

    console.log(`Total rent roll entries fetched: ${allCharges.length}`);
    if (allCharges.length > 0) {
      console.log("Sample entry keys:", Object.keys(allCharges[0]).join(", "));
      console.log("Sample entry:", JSON.stringify(allCharges[0]).substring(0, 500));
    }

    if (allCharges.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        charges_synced: 0,
        message: "No rent roll data returned from AppFolio API. The API credentials may need the 'Rent Roll' report permission.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse and upsert charges
    const now = new Date().toISOString();
    let upserted = 0;

    // Clear existing charges before re-syncing (full refresh)
    await supabase.from("rent_roll_charges").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    for (let i = 0; i < allCharges.length; i += 50) {
      const batch = allCharges.slice(i, i + 50).map((c: any) => {
        // Parse tenant name
        let tenantName = c.tenant_name || c["Tenant Name"] || c.tenant || c.name || "";
        if (tenantName.includes(",")) {
          const parts = tenantName.split(",").map((s: string) => s.trim());
          tenantName = `${parts[1]} ${parts[0]}`; // "Last, First" -> "First Last"
        }

        const propertyAddress = c.property_address || c["Property Address"] || c.property || c.address || "";
        const unitNumber = c.unit || c.Unit || c.unit_number || c["Unit"] || "";
        
        // Monthly charges - could be various field names
        const monthlyAmount = parseFloat(
          c.monthly_charges || c.monthlyCharges || c["Monthly Charges"] ||
          c.rent || c.Rent || c.total_rent || c["Total Rent"] ||
          c.market_rent || c["Market Rent"] || "0"
        ) || 0;

        // Determine charge type from available data
        let chargeType = "rent";
        const description = c.charge_description || c.description || c["Description"] || "";
        const descLower = (description || "").toLowerCase();
        if (descLower.includes("subsidy") || descLower.includes("hap") || descLower.includes("section 8") || descLower.includes("housing")) {
          chargeType = "subsidy";
        } else if (descLower.includes("utility") || descLower.includes("water") || descLower.includes("electric")) {
          chargeType = "utility";
        } else if (descLower.includes("late") || descLower.includes("fee")) {
          chargeType = "fee";
        }

        return {
          tenant_name: tenantName,
          property_address: propertyAddress,
          unit_number: unitNumber || null,
          charge_type: chargeType,
          description: description || "",
          monthly_amount: Math.abs(monthlyAmount),
          appfolio_tenant_id: String(c.tenant_id || c.id || "") || null,
          effective_from: c.lease_from || c["Lease From"] || c.move_in_on || null,
          effective_to: c.lease_to || c["Lease To"] || c.move_out_on || null,
          synced_at: now,
        };
      });

      const { error } = await supabase.from("rent_roll_charges").insert(batch);
      if (error) {
        console.error("Insert error:", error);
        throw error;
      }
      upserted += batch.length;
    }

    console.log(`Synced ${upserted} rent roll charges`);

    return new Response(JSON.stringify({
      success: true,
      charges_synced: upserted,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-rent-roll error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
