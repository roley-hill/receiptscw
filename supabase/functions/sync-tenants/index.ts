import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Authenticate the caller
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

    // Helper to call AppFolio API
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

    // Try v2 API first
    let allTenants: any[] = [];
    let nextUrl: string | null = "/api/v2/tenants.json?per_page=200";

    while (nextUrl) {
      const data = await appfolioFetch(nextUrl);
      if (!data) break;

      const results = data.results || data.tenants || data.data || (Array.isArray(data) ? data : []);
      allTenants = allTenants.concat(results);

      // Handle pagination via next_page_url
      if (data.next_page_url) {
        nextUrl = data.next_page_url.startsWith("http")
          ? data.next_page_url.replace(appfolioBase, "")
          : data.next_page_url;
      } else {
        nextUrl = null;
      }
    }

    // Fallback: try v2 tenant_directory report
    if (allTenants.length === 0) {
      console.log("v2 tenants empty, trying v2 tenant_directory report...");
      const reportData = await appfolioFetch("/api/v2/reports/tenant_directory.json?paginate_results=true&per_page=200");
      if (reportData) {
        allTenants = reportData.results || reportData.tenants || reportData.data || (Array.isArray(reportData) ? reportData : []);
      }
    }

    // Fallback: try v1 as last resort
    if (allTenants.length === 0) {
      console.log("v2 endpoints empty, falling back to v1...");
      const v1Data = await appfolioFetch("/api/v1/reports/tenant_directory.json?paginate_results=true&per_page=200");
      if (v1Data) {
        allTenants = v1Data.results || v1Data.tenants || v1Data.data || (Array.isArray(v1Data) ? v1Data : []);
      }
    }

    console.log(`Total tenants fetched: ${allTenants.length}`);

    if (allTenants.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        tenants_synced: 0,
        message: "No tenants returned from AppFolio API. The API credentials may need the 'Tenant Directory' report permission, or there may be no active tenants.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upsert tenants into DB
    const now = new Date().toISOString();
    let upserted = 0;

    for (let i = 0; i < allTenants.length; i += 50) {
      const batch = allTenants.slice(i, i + 50).map((t: any, idx: number) => {
        // Parse tenant name - handle multiple field formats
        let firstName = t.first_name || t.FirstName || t["First Name"] || "";
        let lastName = t.last_name || t.LastName || t["Last Name"] || "";

        // If no separate first/last, try "Tenant Name" or "name" field
        if (!firstName && !lastName) {
          const fullName = t.tenant_name || t["Tenant Name"] || t.name || t.Name || "";
          if (fullName) {
            const commaParts = fullName.split(",").map((s: string) => s.trim());
            if (commaParts.length >= 2) {
              lastName = commaParts[0];
              firstName = commaParts[1];
            } else {
              const spaceParts = fullName.split(" ");
              firstName = spaceParts[0] || "";
              lastName = spaceParts.slice(1).join(" ") || "";
            }
          }
        }

        const appfolioId = String(t.id || t.Id || t.tenant_id || `tenant-${i + idx}`);

        return {
          appfolio_id: appfolioId,
          first_name: firstName,
          last_name: lastName,
          property_id: String(t.property_id || t.PropertyId || "") || null,
          unit_id: String(t.unit_id || t.UnitId || "") || null,
          property_address: t.property_address || t.PropertyAddress || t["Property Address"] || t.address || t.Address || null,
          unit_number: t.unit || t.Unit || t.unit_number || t.UnitNumber || t["Unit"] || null,
          status: (t.status || t.Status || t["Status"] || "active").toLowerCase(),
          email: t.email || t.Email || t["Email"] || null,
          phone: t.phone_number || t.PhoneNumber || t["Phone"] || null,
          move_in_on: t.move_in_on || t.MoveInOn || t["Lease From"] || null,
          move_out_on: t.move_out_on || t.MoveOutOn || t["Lease To"] || null,
          company_name: t.company_name || t.CompanyName || null,
          primary_tenant: t.primary_tenant ?? t.PrimaryTenant ?? false,
          synced_at: now,
        };
      });

      const { error } = await supabase
        .from("appfolio_tenants")
        .upsert(batch, { onConflict: "appfolio_id" });

      if (error) {
        console.error("Upsert error:", error);
        throw error;
      }
      upserted += batch.length;
    }

    console.log(`Upserted ${upserted} tenants`);

    return new Response(JSON.stringify({
      success: true,
      tenants_synced: upserted,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-tenants error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
