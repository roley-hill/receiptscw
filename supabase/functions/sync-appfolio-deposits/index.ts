import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normName(s: string): string {
  return (s || "").toLowerCase().replace(/[.,'-]/g, " ").replace(/\s+/g, " ").trim();
}
function normAddr(s: string): string {
  return (s || "").toLowerCase()
    .replace(/\bstreet\b/g, "st").replace(/\bavenue\b/g, "ave")
    .replace(/\bboulevard\b/g, "blvd").replace(/\bdrive\b/g, "dr")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function normRef(s: string): string {
  return (s || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
}
function namesMatch(a: string, b: string): boolean {
  a = normName(a); b = normName(b);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const wa = new Set(a.split(" ").filter((w: string) => w.length > 1));
  const wb = b.split(" ").filter((w: string) => w.length > 1);
  return wb.filter((w: string) => wa.has(w)).length >= 2;
}

interface AfLine {
  tenant: string; amount: number; reference: string;
  property: string; memo: string; date: string;
}
interface AfDeposit {
  depositNumber: string; depositDate: string; property: string;
  bankAccount: string; totalAmount: number; lines: AfLine[];
}

// Sequential header parse — deposit number column is only populated on the header row
function parseDepositRegister(rows: any[]): AfDeposit[] {
  const deposits: AfDeposit[] = [];
  let current: AfDeposit | null = null;

  for (const row of rows) {
    const depNum = (
      row["Deposit Number"] || row["DepositNumber"] || row["deposit_number"] ||
      row["Deposit #"] || row["Batch Number"] || row["BatchNumber"] || ""
    ).trim();

    if (depNum !== "") {
      // Header row — start a new deposit
      if (current) deposits.push(current);
      const rawDate = row["Date"] || row["Deposit Date"] || row["DepositDate"] || row["date"] || "";
      const rawTotal = (row["Total"] || row["Amount"] || row["Deposit Amount"] || row["amount"] || "0").replace(/[$,]/g, "");
      const rawProp = row["Property"] || row["property"] || row["Bank Account"] || "";
      const rawBank = row["Bank"] || row["Bank Account"] || row["BankAccount"] || "";
      current = {
        depositNumber: depNum,
        depositDate: rawDate.trim(),
        property: rawProp.trim(),
        bankAccount: rawBank.trim(),
        totalAmount: Math.abs(parseFloat(rawTotal) || 0),
        lines: [],
      };
    } else if (current) {
      // Receipt line under the current deposit header
      const rawAmount = (row["Amount"] || row["Payment Amount"] || row["amount"] || "0").replace(/[$,]/g, "");
      const amount = Math.abs(parseFloat(rawAmount) || 0);
      if (amount === 0) continue;
      const tenant = (row["Tenant"] || row["Payee"] || row["Payer"] || row["Name"] || row["tenant"] || "").trim();
      const reference = (row["Reference"] || row["Check #"] || row["Check Number"] || row["Transaction ID"] || row["Ref"] || row["reference"] || "").trim();
      const property = (row["Property"] || row["Building"] || row["property"] || current.property).trim();
      const memo = (row["Memo"] || row["Description"] || row["memo"] || "").trim();
      current.lines.push({ tenant, amount, reference, property, memo, date: current.depositDate });
    }
  }
  if (current) deposits.push(current);
  return deposits;
}

function matchLine(receipt: any, line: AfLine): boolean {
  const rAmt = Math.round(Math.abs(Number(receipt.amount)) * 100);
  const lAmt = Math.round(line.amount * 100);
  if (rAmt === 0 || lAmt === 0 || rAmt !== lAmt) return false;

  const tenantOk = namesMatch(receipt.tenant, line.tenant);
  const a1 = normAddr(receipt.property); const a2 = normAddr(line.property);
  const propOk = a1 && a2 && (a1.split(" ")[0] === a2.split(" ")[0]);
  if (!tenantOk && !propOk) return false;

  // Tighten with reference if available
  const rRef = normRef(receipt.reference); const lRef = normRef(line.reference);
  if (rRef.length >= 4 && lRef.length >= 4) {
    if (!rRef.includes(lRef) && !lRef.includes(rRef)) return false;
  }
  return true;
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

    let fromDate = "", toDate = "", autoCreateBatches = false, createMissingReceipts = false;
    try {
      const body = await req.json();
      fromDate = body.from_date || ""; toDate = body.to_date || "";
      autoCreateBatches = body.auto_create_batches === true;
      createMissingReceipts = body.create_missing_receipts === true;
    } catch { /* no body */ }

    if (!fromDate) { const d = new Date(); d.setDate(d.getDate() - 90); fromDate = d.toISOString().substring(0, 10); }
    if (!toDate) toDate = new Date().toISOString().substring(0, 10);

    // ── Fetch deposit register ─────────────────────────────────────────────
    const appfolioBase = "https://countywidemanagement.appfolio.com";
    const basicAuth = btoa(`${clientId}:${clientSecret}`);
    const rawRows: any[] = [];
    let pg = 1, more = true;
    while (more) {
      const url = `${appfolioBase}/api/v0/reports/deposit_register.json?paginate_results=true&per_page=500&page=${pg}&from_date=${fromDate}&to_date=${toDate}`;
      const resp = await fetch(url, { headers: { "Authorization": `Basic ${basicAuth}`, "Accept": "application/json" } });
      if (!resp.ok) { console.error(`AppFolio ${resp.status}`); break; }
      const data = await resp.json();
      const results = data?.results || (Array.isArray(data) ? data : []);
      if (!results.length) { more = false; break; }
      rawRows.push(...results);
      if (results.length < 500) more = false; else pg++;
    }
    console.log(`Fetched ${rawRows.length} raw rows`);

    const afDeposits = parseDepositRegister(rawRows);
    const totalAfLines = afDeposits.reduce((s: number, d: AfDeposit) => s + d.lines.length, 0);
    console.log(`Parsed ${afDeposits.length} deposits, ${totalAfLines} receipt lines`);

    // ── Load all app receipts ──────────────────────────────────────────────
    const appReceipts: any[] = [];
    let cur = 0;
    while (true) {
      const { data: p } = await adminClient.from("receipts")
        .select("id, receipt_id, tenant, property, unit, amount, reference, rent_month, receipt_date, appfolio_recorded, batch_id, status")
        .is("deleted_at", null).range(cur, cur + 999);
      if (!p || !p.length) break;
      appReceipts.push(...p);
      if (p.length < 1000) break; cur += 1000;
    }
    console.log(`Loaded ${appReceipts.length} app receipts`);

    const matchedIds = new Set<string>();
    const depositResults: any[] = [];
    const batchesCreated: any[] = [];
    const missingInApp: any[] = [];
    const autoCreated: any[] = [];

    for (const dep of afDeposits) {
      const lineMatches: Array<{ appReceipt: any; line: AfLine; autoCreated?: boolean }> = [];
      const unmatchedLines: AfLine[] = [];

      for (const line of dep.lines) {
        const match = appReceipts.find((r: any) => !matchedIds.has(r.id) && matchLine(r, line));
        if (match) {
          lineMatches.push({ appReceipt: match, line });
          matchedIds.add(match.id);
        } else {
          unmatchedLines.push(line);
          missingInApp.push({ deposit_number: dep.depositNumber, deposit_date: dep.depositDate, property: dep.property || line.property, tenant: line.tenant, amount: line.amount, reference: line.reference });

          if (createMissingReceipts) {
            const { data: newR } = await adminClient.from("receipts").insert({
              user_id: user.id,
              property: line.property || dep.property,
              tenant: line.tenant, amount: line.amount, reference: line.reference,
              receipt_date: dep.depositDate || null,
              rent_month: dep.depositDate ? dep.depositDate.substring(0, 7) : null,
              memo: `Auto-created from AppFolio deposit #${dep.depositNumber}`,
              status: "finalized", appfolio_recorded: true,
              appfolio_recorded_at: new Date().toISOString(),
              payment_type: "", file_name: `appfolio_deposit_${dep.depositNumber}`,
            }).select().single();
            if (newR) {
              lineMatches.push({ appReceipt: newR, line, autoCreated: true });
              matchedIds.add(newR.id);
              autoCreated.push(newR);
            }
          }
        }
      }

      let batchId: string | null = null, batchCreated = false, batchExisted = false;

      if (autoCreateBatches && lineMatches.length > 0) {
        const { data: existing } = await adminClient.from("deposit_batches")
          .select("id").eq("deposit_period", `AF-${dep.depositNumber}`).maybeSingle();

        if (existing) {
          batchId = existing.id; batchExisted = true;
        } else {
          const total = lineMatches.reduce((s: number, m: any) => s + Math.abs(Number(m.appReceipt.amount)), 0);
          const prop = dep.property || lineMatches[0]?.line.property || "AppFolio Deposit";
          const { data: nb } = await adminClient.from("deposit_batches").insert({
            property: prop, deposit_period: `AF-${dep.depositNumber}`,
            total_amount: Math.round(total * 100) / 100,
            receipt_count: lineMatches.length, created_by: user.id, status: "draft",
            notes: `Synced from AppFolio deposit #${dep.depositNumber} (${dep.depositDate})`,
          }).select().single();
          if (nb) { batchId = nb.id; batchCreated = true; batchesCreated.push(nb); }
        }

        if (batchId) {
          const ids = lineMatches.map((m: any) => m.appReceipt.id);
          if (ids.length) await adminClient.from("receipts").update({
            batch_id: batchId, appfolio_recorded: true,
            appfolio_recorded_at: new Date().toISOString(), status: "finalized",
          }).in("id", ids);
        }
      }

      depositResults.push({
        deposit_number: dep.depositNumber, deposit_date: dep.depositDate,
        property: dep.property, appfolio_line_count: dep.lines.length,
        appfolio_total: Math.round(dep.totalAmount * 100) / 100,
        matched_count: lineMatches.length,
        auto_created_count: lineMatches.filter((m: any) => m.autoCreated).length,
        unmatched_count: unmatchedLines.length,
        batch_id: batchId, batch_created: batchCreated, batch_already_existed: batchExisted,
      });
    }

    const missingInAppfolio = appReceipts
      .filter((r: any) => !matchedIds.has(r.id) && !r.batch_id)
      .map((r: any) => ({
        receipt_id: r.receipt_id, id: r.id, tenant: r.tenant, property: r.property,
        amount: r.amount, reference: r.reference, rent_month: r.rent_month,
        appfolio_recorded: r.appfolio_recorded, status: r.status,
      }));

    return new Response(JSON.stringify({
      success: true,
      date_range: { from: fromDate, to: toDate },
      appfolio_deposits_found: afDeposits.length,
      appfolio_total_lines: totalAfLines,
      app_receipts_total: appReceipts.length,
      matched_receipts: matchedIds.size,
      batches_created: batchesCreated.length,
      auto_created_receipts: autoCreated.length,
      missing_in_app_count: missingInApp.length,
      missing_in_appfolio_count: missingInAppfolio.length,
      missing_in_app: missingInApp,
      missing_in_appfolio: missingInAppfolio,
      deposits: depositResults,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("sync-appfolio-deposits error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
