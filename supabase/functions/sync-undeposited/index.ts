import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseAmount(s: string | null | undefined): number {
  if (!s) return 0;
  return parseFloat(String(s).replace(/[$,]/g, "")) || 0;
}

// "Last, First" → "First Last"
function normalizeName(s: string): string {
  if (!s) return "";
  const parts = s.split(",").map((p: string) => p.trim());
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : s;
}

function normRef(s: string): string {
  return (s || "").replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
}

// Generate monthly date ranges between two dates
function monthRanges(fromDate: string, toDate: string): Array<{ from: string; to: string }> {
  const ranges: Array<{ from: string; to: string }> = [];
  let current = new Date(fromDate + "T00:00:00Z");
  const end = new Date(toDate + "T00:00:00Z");
  while (current <= end) {
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth();
    const monthStart = new Date(Date.UTC(year, month, 1)).toISOString().substring(0, 10);
    const monthEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().substring(0, 10);
    ranges.push({ from: monthStart, to: monthEnd < toDate ? monthEnd : toDate });
    current = new Date(Date.UTC(year, month + 1, 1));
  }
  return ranges;
}

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

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const clientId = Deno.env.get("APPFOLIO_CLIENT_ID");
    const clientSecret = Deno.env.get("APPFOLIO_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error("AppFolio credentials not configured");

    let fromDate = "", toDate = "", dryRun = false;
    try {
      const body = await req.json();
      fromDate = body.from_date || "";
      toDate = body.to_date || "";
      dryRun = body.dry_run === true;
    } catch { /* no body */ }

    if (!fromDate) { const d = new Date(); d.setDate(d.getDate() - 90); fromDate = d.toISOString().substring(0, 10); }
    if (!toDate) toDate = new Date().toISOString().substring(0, 10);

    const appfolioBase = "https://countywidemanagement.appfolio.com";
    const basicAuth = btoa(`${clientId}:${clientSecret}`);

    // ── Step 1: Collect all deposited receipt_ids from deposit_register ─────
    // Cross-reference key: income_register.receipt_id ↔ deposit_register.TxnId
    // (receipt lines only = rows where DepositNumber is null)
    console.log(`Fetching deposit register ${fromDate} → ${toDate}...`);
    const depositedReceiptIds = new Set<number>();
    let drNextUrl: string | null =
      `${appfolioBase}/api/v0/reports/deposit_register.json?paginate_results=true&per_page=5000&from_date=${fromDate}&to_date=${toDate}`;
    while (drNextUrl) {
      const resp = await fetch(drNextUrl, {
        headers: { "Authorization": `Basic ${basicAuth}`, "Accept": "application/json" }
      });
      if (!resp.ok) { console.error(`Deposit register ${resp.status}`); break; }
      const data = await resp.json();
      const rows: any[] = data?.results || [];
      for (const row of rows) {
        if (row.DepositNumber !== null && row.DepositNumber !== undefined) continue;
        if (row.TxnId) depositedReceiptIds.add(Number(row.TxnId));
      }
      const rawNext = data?.next_page_url || "";
      drNextUrl = rawNext && rows.length >= 100 ? rawNext : null;
    }
    console.log(`Deposit register: ${depositedReceiptIds.size} deposited receipt IDs`);

    // ── Step 2: Fetch income_register monthly (POST endpoint, no pagination) ─
    // ALL GL accounts included — this is a reconciliation tool
    const ranges = monthRanges(fromDate, toDate);
    const allIncomeRows: any[] = [];

    for (const range of ranges) {
      console.log(`Fetching income_register ${range.from} → ${range.to}...`);
      const resp = await fetch(`${appfolioBase}/api/v2/reports/income_register.json`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ receipt_date_from: range.from, receipt_date_to: range.to }),
      });
      if (!resp.ok) {
        console.error(`Income register ${resp.status} for ${range.from}`);
        continue;
      }
      const data = await resp.json();
      const rows: any[] = data?.results || (Array.isArray(data) ? data : []);
      allIncomeRows.push(...rows);
      console.log(`  ${rows.length} rows`);
    }

    console.log(`Income register total: ${allIncomeRows.length} rows`);

    // ── Step 3: Group by receipt_id — one entry per receipt (not per charge line) ─
    // Multiple rows can share the same receipt_id (different charge lines paid by same receipt)
    const receiptMap = new Map<number, {
      receiptId: number;
      payer: string;
      property: string;
      unit: string;
      totalReceiptAmount: number;
      receiptDate: string | null;
      rentMonth: string | null;
      reference: string;
      paymentType: string;
      glAccounts: string[];
    }>();

    for (const row of allIncomeRows) {
      const receiptAmt = parseAmount(row.receipt_amount);
      if (receiptAmt === 0) continue; // skip $0 ledger adjustments
      if (!row.receipt_id) continue;
      const rid = Number(row.receipt_id);

      if (receiptMap.has(rid)) {
        // Already have this receipt — just track additional GL accounts
        const existing = receiptMap.get(rid)!;
        if (row.cash_gl && !existing.glAccounts.includes(row.cash_gl)) {
          existing.glAccounts.push(row.cash_gl);
        }
        // Don't double-count receipt amount (it's the same receipt)
      } else {
        // Parse rent month from receipt_description if available
        let rentMonth: string | null = row.receipt_date ? String(row.receipt_date).substring(0, 7) : null;
        const desc = String(row.receipt_description || "");
        const monthMatch = desc.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
        if (monthMatch) {
          const months: Record<string, string> = {
            january:"01",february:"02",march:"03",april:"04",may:"05",june:"06",
            july:"07",august:"08",september:"09",october:"10",november:"11",december:"12"
          };
          rentMonth = `${monthMatch[2]}-${months[monthMatch[1].toLowerCase()]}`;
        }

        receiptMap.set(rid, {
          receiptId: rid,
          payer: normalizeName(String(row.payer || "")),
          property: String(row.property_name || row.property_street || ""),
          unit: String(row.unit || ""),
          totalReceiptAmount: receiptAmt,
          receiptDate: row.receipt_date ? String(row.receipt_date) : null,
          rentMonth,
          reference: String(row.reference || ""),
          paymentType: String(row.type || ""),
          glAccounts: row.cash_gl ? [String(row.cash_gl)] : [],
        });
      }
    }

    console.log(`Income register: ${receiptMap.size} unique receipts`);

    // ── Step 4: Find receipts NOT in any deposit ─────────────────────────────
    const undepositedReceipts = [...receiptMap.values()].filter(r => !depositedReceiptIds.has(r.receiptId));
    console.log(`Undeposited: ${undepositedReceipts.length} receipts`);

    if (dryRun) {
      return new Response(JSON.stringify({
        success: true, dry_run: true,
        date_range: { from: fromDate, to: toDate },
        months_fetched: ranges.length,
        income_register_total_rows: allIncomeRows.length,
        income_register_unique_receipts: receiptMap.size,
        deposited_receipt_id_count: depositedReceiptIds.size,
        undeposited_count: undepositedReceipts.length,
        sample: undepositedReceipts.slice(0, 10).map(r => ({
          receipt_id: r.receiptId, payer: r.payer, amount: r.totalReceiptAmount,
          date: r.receiptDate, property: r.property, ref: r.reference,
          gl_accounts: r.glAccounts,
        })),
      }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Step 5: Cross-check against existing app receipts ───────────────────
    const existingRefs = new Set<string>();
    const existingKeys = new Set<string>();
    let cursor = 0;
    while (true) {
      const { data: page } = await adminClient.from("receipts")
        .select("reference, tenant, amount, receipt_date")
        .is("deleted_at", null).range(cursor, cursor + 999);
      if (!page || !page.length) break;
      for (const r of page) {
        const ref = normRef(r.reference || "");
        if (ref.length >= 4) existingRefs.add(ref);
        const k = `${(r.tenant||"").toLowerCase().replace(/[^a-z]/g,"")}:${Math.round(Number(r.amount)*100)}:${r.receipt_date||""}`;
        existingKeys.add(k);
      }
      if (page.length < 1000) break;
      cursor += 1000;
    }

    // ── Step 6: Create receipts for truly new undeposited payments ───────────
    const created: any[] = [];
    const skipped: any[] = [];

    for (const r of undepositedReceipts) {
      const ref = normRef(r.reference);
      const k = `${r.payer.toLowerCase().replace(/[^a-z]/g,"")}:${Math.round(r.totalReceiptAmount*100)}:${r.receiptDate||""}`;

      if ((ref.length >= 4 && existingRefs.has(ref)) || existingKeys.has(k)) {
        skipped.push({ payer: r.payer, amount: r.totalReceiptAmount, skip_reason: "already_in_app" });
        continue;
      }

      const { data: nr, error: ie } = await adminClient.from("receipts").insert({
        user_id: user.id,
        property: r.property,
        unit: r.unit,
        tenant: r.payer,
        amount: r.totalReceiptAmount,
        reference: r.reference,
        receipt_date: r.receiptDate,
        rent_month: r.rentMonth,
        memo: r.glAccounts.join(", "),
        payment_type: r.paymentType,
        status: "finalized",
        appfolio_recorded: true,
        appfolio_recorded_at: new Date().toISOString(),
        file_name: `appfolio_undeposited_${r.receiptId}`,
      }).select("receipt_id").single();

      if (ie) {
        skipped.push({ payer: r.payer, amount: r.totalReceiptAmount, skip_reason: `error: ${ie.message}` });
      } else {
        created.push({ receipt_id: nr?.receipt_id, payer: r.payer, amount: r.totalReceiptAmount, date: r.receiptDate, property: r.property, gl_accounts: r.glAccounts });
        if (ref.length >= 4) existingRefs.add(ref);
        existingKeys.add(k);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      date_range: { from: fromDate, to: toDate },
      months_fetched: ranges.length,
      income_register_unique_receipts: receiptMap.size,
      deposited_receipt_id_count: depositedReceiptIds.size,
      undeposited_count: undepositedReceipts.length,
      created_count: created.length,
      skipped_already_in_app: skipped.filter(s => s.skip_reason === "already_in_app").length,
      skipped_errors: skipped.filter(s => s.skip_reason !== "already_in_app").length,
      created_sample: created.slice(0, 10),
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("sync-undeposited error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
