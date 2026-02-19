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

    // Parse optional date range from request body
    let fromDate: string | null = null;
    let toDate: string | null = null;
    try {
      const body = await req.json();
      fromDate = body.from_date || null;
      toDate = body.to_date || null;
    } catch { /* no body or not JSON */ }

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
        console.error(`AppFolio ${resp.status}: ${err.substring(0, 500)}`);
        return null;
      }
      const text = await resp.text();
      console.log(`AppFolio response (${text.length} chars): ${text.substring(0, 800)}`);
      return JSON.parse(text);
    }

    // Build query params for the charges/general_ledger_details endpoint
    // Try multiple endpoints: charges, general_ledger_details, tenant_ledgers
    let allCharges: any[] = [];

    // Strategy 1: Try /api/v2/charges.json (paginated)
    let params = "?paginate_results=true&per_page=200";
    if (fromDate) params += `&from_date=${fromDate}`;
    if (toDate) params += `&to_date=${toDate}`;

    let nextUrl: string | null = `/api/v2/charges.json${params}`;
    while (nextUrl) {
      const data = await appfolioFetch(nextUrl);
      if (!data) break;
      const results = data.results || data.charges || data.data || (Array.isArray(data) ? data : []);
      allCharges = allCharges.concat(results);
      if (data.next_page_url) {
        nextUrl = data.next_page_url.startsWith("http")
          ? data.next_page_url.replace(appfolioBase, "")
          : data.next_page_url;
      } else {
        nextUrl = null;
      }
    }

    // Strategy 2: Try general_ledger_details if charges empty
    if (allCharges.length === 0) {
      console.log("Charges endpoint empty, trying general_ledger_details...");
      nextUrl = `/api/v2/general_ledger_details.json${params}`;
      while (nextUrl) {
        const data = await appfolioFetch(nextUrl);
        if (!data) break;
        const results = data.results || data.details || data.data || (Array.isArray(data) ? data : []);
        allCharges = allCharges.concat(results);
        if (data.next_page_url) {
          nextUrl = data.next_page_url.startsWith("http")
            ? data.next_page_url.replace(appfolioBase, "")
            : data.next_page_url;
        } else {
          nextUrl = null;
        }
      }
    }

    // Strategy 3: Try tenant_ledgers
    if (allCharges.length === 0) {
      console.log("GL details empty, trying tenant_ledgers...");
      nextUrl = `/api/v2/tenant_ledgers.json${params}`;
      while (nextUrl) {
        const data = await appfolioFetch(nextUrl);
        if (!data) break;
        const results = data.results || data.ledger_entries || data.data || (Array.isArray(data) ? data : []);
        allCharges = allCharges.concat(results);
        if (data.next_page_url) {
          nextUrl = data.next_page_url.startsWith("http")
            ? data.next_page_url.replace(appfolioBase, "")
            : data.next_page_url;
        } else {
          nextUrl = null;
        }
      }
    }

    // Strategy 4: Try v1 fallback
    if (allCharges.length === 0) {
      console.log("v2 endpoints empty, trying v1 charge_detail report...");
      const v1Data = await appfolioFetch(`/api/v1/reports/charge_detail.json${params}`);
      if (v1Data) {
        allCharges = v1Data.results || v1Data.data || (Array.isArray(v1Data) ? v1Data : []);
      }
    }

    console.log(`Total charge entries fetched: ${allCharges.length}`);
    if (allCharges.length > 0) {
      console.log("Sample entry keys:", Object.keys(allCharges[0]).join(", "));
      console.log("Sample entry:", JSON.stringify(allCharges[0]).substring(0, 800));
    }

    if (allCharges.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        charges_synced: 0,
        message: "No charge detail data returned from AppFolio API. The API credentials may need the 'Charges' or 'General Ledger Details' permission.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clear existing charge_details before re-syncing (full refresh)
    await supabase.from("charge_details").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const now = new Date().toISOString();
    let upserted = 0;

    for (let i = 0; i < allCharges.length; i += 50) {
      const batch = allCharges.slice(i, i + 50).map((c: any) => {
        const accountName = c.account_name || c.AccountName || c["Account Name"] || c.gl_account_name || "";
        const accountNumber = String(c.account_number || c.AccountNumber || c["Account Number"] || c.gl_account || "");
        
        // Parse tenant name (AppFolio uses "Last, First" format)
        let chargedTo = c.charged_to || c.ChargedTo || c["Charged to"] || c.tenant_name || c.tenant || c.name || "";
        
        const chargeAmount = parseFloat(
          String(c.charge_amount || c.ChargeAmount || c["Charge Amount"] || c.amount || c.debit || "0").replace(/,/g, "")
        ) || 0;
        const paidAmount = parseFloat(
          String(c.paid_amount || c.PaidAmount || c["Paid Amount"] || c.credit || "0").replace(/,/g, "")
        ) || 0;

        const chargeDate = c.charge_date || c.ChargeDate || c["Charge Date"] || c.date || c.occurred_on || null;
        const unit = c.unit || c.Unit || c.unit_number || c["Unit"] || null;
        const propertyAddress = c.property || c.Property || c.property_address || c["Property"] || "";
        const reference = c.reference || c.Reference || c.receipt_reference || null;
        const receiptDate = c.receipt_date || c.ReceiptDate || c["Receipt Date"] || null;
        const tenantId = c.tenant_id || c.TenantId || null;

        // Detect subsidy from account name
        const accountNameLower = accountName.toLowerCase();
        const isSubsidy = accountNameLower.includes("subsidy");
        let subsidyProvider: string | null = null;
        if (isSubsidy) {
          // Extract provider name from "Subsidy Rent - HACLA" pattern
          const match = accountName.match(/subsidy\s+rent\s*[-–—]\s*(.+)/i);
          if (match) {
            subsidyProvider = match[1].trim();
          } else {
            subsidyProvider = accountName.replace(/subsidy\s+rent\s*/i, "").trim() || accountName;
          }
        }

        return {
          charge_date: chargeDate,
          account_number: accountNumber,
          account_name: accountName,
          charged_to: chargedTo,
          charge_amount: chargeAmount,
          paid_amount: paidAmount,
          unit,
          property_address: propertyAddress,
          reference,
          receipt_date: receiptDate,
          appfolio_tenant_id: tenantId ? String(tenantId) : null,
          is_subsidy: isSubsidy,
          subsidy_provider: subsidyProvider,
          synced_at: now,
        };
      });

      const { error } = await supabase.from("charge_details").insert(batch);
      if (error) {
        console.error("Insert error:", error);
        throw error;
      }
      upserted += batch.length;
    }

    console.log(`Synced ${upserted} charge details`);

    // ---- AUTO-TAG SUBSIDY PROVIDERS ON EXISTING RECEIPTS ----
    // Strategy A: Use charge_details if we got any subsidy charges from AppFolio
    const { data: subsidyCharges } = await supabase
      .from("charge_details")
      .select("charged_to, unit, property_address, charge_amount, subsidy_provider")
      .eq("is_subsidy", true)
      .not("subsidy_provider", "is", null);

    let receiptsUpdated = 0;
    if (subsidyCharges && subsidyCharges.length > 0) {
      const { data: receipts } = await supabase
        .from("receipts")
        .select("id, tenant, unit, property, amount, subsidy_provider")
        .is("subsidy_provider", null);

      if (receipts && receipts.length > 0) {
        for (const receipt of receipts) {
          const receiptAmount = Math.abs(Number(receipt.amount));
          const receiptTenant = (receipt.tenant || "").toLowerCase().trim();
          const receiptUnit = (receipt.unit || "").replace(/^#/, "").trim().toLowerCase();

          const match = subsidyCharges.find(sc => {
            const scTenant = (sc.charged_to || "").toLowerCase().trim();
            const scUnit = (sc.unit || "").replace(/^#/, "").trim().toLowerCase();
            const scAmount = Math.abs(sc.charge_amount);
            const tenantMatch = scTenant && receiptTenant && (
              scTenant === receiptTenant || scTenant.includes(receiptTenant) || receiptTenant.includes(scTenant)
            );
            const unitMatch = scUnit && receiptUnit && (
              scUnit === receiptUnit || scUnit.endsWith("-" + receiptUnit) || receiptUnit.endsWith("-" + scUnit)
            );
            const amountMatch = Math.abs(scAmount - receiptAmount) < 0.01;
            return amountMatch && (tenantMatch || unitMatch);
          });

          if (match && match.subsidy_provider) {
            await supabase.from("receipts").update({ subsidy_provider: match.subsidy_provider }).eq("id", receipt.id);
            receiptsUpdated++;
          }
        }
      }
    }

    // Strategy B: Detect subsidy from receipt memo/reference patterns (works even without AppFolio charges API)
    // Tag HAP (Housing Assistance Payment / Section 8) from memo
    const { data: hapReceipts } = await supabase
      .from("receipts")
      .select("id")
      .is("subsidy_provider", null)
      .ilike("memo", "%HAP%");

    if (hapReceipts && hapReceipts.length > 0) {
      for (const r of hapReceipts) {
        await supabase.from("receipts").update({ subsidy_provider: "Section 8 HAP" }).eq("id", r.id);
        receiptsUpdated++;
      }
    }

    // Tag FHSP from reference
    const { data: fhspReceipts } = await supabase
      .from("receipts")
      .select("id")
      .is("subsidy_provider", null)
      .ilike("reference", "%FHSP%");

    if (fhspReceipts && fhspReceipts.length > 0) {
      for (const r of fhspReceipts) {
        await supabase.from("receipts").update({ subsidy_provider: "FHSP" }).eq("id", r.id);
        receiptsUpdated++;
      }
    }

    console.log(`Subsidy tagging: ${receiptsUpdated} receipts updated`);

    return new Response(JSON.stringify({
      success: true,
      charges_synced: upserted,
      receipts_tagged: receiptsUpdated,
      subsidy_charges_found: subsidyCharges?.length || 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-charges error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
