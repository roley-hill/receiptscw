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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
    if (!clientId || !clientSecret) throw new Error("AppFolio API credentials not configured");

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Fetch all unrecorded, active receipts
    const allReceipts: any[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data: page } = await adminClient
        .from("receipts")
        .select("id, tenant, property, amount, reference, rent_month, receipt_date")
        .eq("appfolio_recorded", false)
        .is("deleted_at", null)
        .range(from, from + PAGE - 1);
      if (!page || page.length === 0) break;
      allReceipts.push(...page);
      if (page.length < PAGE) break;
      from += PAGE;
    }

    if (allReceipts.length === 0) {
      return new Response(JSON.stringify({ verified: 0, not_found: 0, errors: [], message: "No unrecorded receipts to check" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Checking ${allReceipts.length} unrecorded receipts against AppFolio`);

    // Determine date range for AppFolio query
    const rentMonths = allReceipts.map(r => r.rent_month).filter(Boolean).sort();
    const receiptDates = allReceipts.map(r => r.receipt_date).filter(Boolean).sort();
    
    let fromDate: string;
    let toDate: string;
    
    if (rentMonths.length > 0) {
      fromDate = rentMonths[0] + "-01";
      const lastMonth = rentMonths[rentMonths.length - 1];
      const [y, m] = lastMonth.split("-").map(Number);
      const endDate = new Date(y, m, 0); // last day of month
      toDate = endDate.toISOString().substring(0, 10);
    } else if (receiptDates.length > 0) {
      fromDate = receiptDates[0];
      toDate = receiptDates[receiptDates.length - 1];
    } else {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      fromDate = sixMonthsAgo.toISOString().substring(0, 10);
      toDate = new Date().toISOString().substring(0, 10);
    }

    // Extend range by 1 month on each side for safety
    const fromD = new Date(fromDate);
    fromD.setMonth(fromD.getMonth() - 1);
    fromDate = fromD.toISOString().substring(0, 10);
    const toD = new Date(toDate);
    toD.setMonth(toD.getMonth() + 1);
    toDate = toD.toISOString().substring(0, 10);

    const appfolioBase = "https://countywidemanagement.appfolio.com";
    const basicAuth = btoa(`${clientId}:${clientSecret}`);

    // Fetch charge details from AppFolio
    const afCharges: any[] = [];
    let pageNum = 1;
    let hasMore = true;

    while (hasMore) {
      const params = `?paginate_results=true&per_page=200&page=${pageNum}&from_date=${fromDate}&to_date=${toDate}`;
      const url = `${appfolioBase}/api/v0/reports/charge_detail.json${params}`;
      console.log(`Fetching AppFolio page ${pageNum}: ${url}`);
      
      const resp = await fetch(url, {
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Accept": "application/json",
        },
      });

      if (!resp.ok) {
        console.error(`AppFolio API error: ${resp.status}`);
        break;
      }

      const data = await resp.json();
      const results = data?.results || data?.charge_details || data || [];
      
      if (Array.isArray(results) && results.length > 0) {
        afCharges.push(...results);
        pageNum++;
        if (results.length < 200) hasMore = false;
      } else if (Array.isArray(data) && data.length > 0) {
        afCharges.push(...data);
        pageNum++;
        if (data.length < 200) hasMore = false;
      } else {
        hasMore = false;
      }
    }

    console.log(`Fetched ${afCharges.length} AppFolio charge records`);

    // Match receipts against AppFolio charges
    let verified = 0;
    let notFound = 0;
    const errors: string[] = [];
    const idsToMark: string[] = [];

    for (const receipt of allReceipts) {
      try {
        const matched = findAppfolioMatch(receipt, afCharges);
        if (matched) {
          idsToMark.push(receipt.id);
          verified++;
        } else {
          notFound++;
        }
      } catch (e) {
        errors.push(`Receipt ${receipt.id}: ${String(e)}`);
      }
    }

    // Bulk update matched receipts — only set true, never false
    if (idsToMark.length > 0) {
      // Process in batches of 100
      for (let i = 0; i < idsToMark.length; i += 100) {
        const batch = idsToMark.slice(i, i + 100);
        const { error: updateErr } = await adminClient
          .from("receipts")
          .update({
            appfolio_recorded: true,
            appfolio_recorded_at: new Date().toISOString(),
          })
          .in("id", batch);
        if (updateErr) {
          errors.push(`Batch update error: ${updateErr.message}`);
        }
      }
    }

    return new Response(JSON.stringify({
      verified,
      not_found: notFound,
      errors,
      total_checked: allReceipts.length,
      appfolio_records_fetched: afCharges.length,
      message: `${verified} receipts confirmed recorded, ${notFound} not found in AppFolio`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("verify-appfolio-receipts error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function findAppfolioMatch(receipt: any, afCharges: any[]): boolean {
  const rAmount = Number(receipt.amount);
  const rTenant = normalizeName(receipt.tenant);
  const rProperty = normalizeAddress(receipt.property);
  const rRef = extractNumericRef(receipt.reference);
  const rRentMonth = receipt.rent_month; // YYYY-MM

  for (const charge of afCharges) {
    // 1. Amount exact match
    const cAmount = Number(charge.Amount || charge.amount || charge.charge_amount || charge.paid_amount || 0);
    if (Math.abs(cAmount - rAmount) > 0.01) continue;

    // 2. Tenant name match (case-insensitive partial)
    const cTenant = normalizeName(charge.ChargedTo || charge.charged_to || charge.tenant_name || charge.Tenant || "");
    if (!partialNameMatch(rTenant, cTenant)) continue;

    // 3. Property address partial match
    const cProperty = normalizeAddress(charge.PropertyAddress || charge.property_address || charge.Property || "");
    if (cProperty && rProperty && !partialAddressMatch(rProperty, cProperty)) continue;

    // 4. Reference match
    const cRef = extractNumericRef(charge.Reference || charge.reference || charge.CheckNumber || charge.check_number || "");
    if (rRef && cRef) {
      if (!cRef.includes(rRef) && !rRef.includes(cRef)) continue;
    }

    // 5. Charge month match (rent_month vs charge period)
    if (rRentMonth) {
      const chargeDate = charge.ChargeDate || charge.charge_date || charge.Date || charge.date || "";
      if (chargeDate) {
        const chargeMonth = chargeDate.substring(0, 7); // YYYY-MM
        if (chargeMonth && chargeMonth !== rRentMonth) {
          // Allow ±1 month flexibility
          const [ry, rm] = rRentMonth.split("-").map(Number);
          const [cy, cm] = chargeMonth.split("-").map(Number);
          const diffMonths = Math.abs((ry * 12 + rm) - (cy * 12 + cm));
          if (diffMonths > 1) continue;
        }
      }
    }

    // All criteria passed
    return true;
  }

  return false;
}

function normalizeName(name: string): string {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\b(jr|sr|sir|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
}

function normalizeAddress(addr: string): string {
  if (!addr) return "";
  return addr.toLowerCase().replace(/[.,#]/g, "").replace(/\s+/g, " ").trim();
}

function extractNumericRef(ref: string): string {
  if (!ref) return "";
  const nums = ref.replace(/[^0-9]/g, "");
  return nums;
}

function partialNameMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // Check last name match
  const aWords = a.split(" ");
  const bWords = b.split(" ");
  const aLast = aWords[aWords.length - 1];
  const bLast = bWords[bWords.length - 1];
  if (aLast === bLast && aLast.length > 2) return true;
  // Check word overlap
  const overlap = aWords.filter(w => w.length > 2 && bWords.includes(w));
  return overlap.length >= 1;
}

function partialAddressMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  // Extract street number
  const aNum = a.match(/^(\d+)/)?.[1];
  const bNum = b.match(/^(\d+)/)?.[1];
  return !!aNum && aNum === bNum;
}
