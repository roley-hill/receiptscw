import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Normalisation helpers ──────────────────────────────────────────────────

function normName(s: string): string {
  if (!s) return "";
  // AppFolio stores names as "Last, First" — normalise to "first last"
  const parts = s.split(",").map(p => p.trim().toLowerCase());
  return (parts.length === 2 ? `${parts[1]} ${parts[0]}` : parts[0])
    .replace(/[.,'-]/g, " ").replace(/\s+/g, " ").trim();
}

function normAddr(s: string): string {
  // AppFolio PropertyName is "Address - Full Address City State Zip" — take first part
  const addr = (s || "").split(" - ")[0];
  return addr.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function normRef(s: string): string {
  return (s || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
}

function namesMatch(a: string, b: string): boolean {
  a = normName(a); b = normName(b);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // Word overlap ≥ 2
  const wa = new Set(a.split(" ").filter((w: string) => w.length > 1));
  const wb = b.split(" ").filter((w: string) => w.length > 1);
  return wb.filter((w: string) => wa.has(w)).length >= 2;
}

function parseAmount(s: string | null): number {
  if (!s) return 0;
  return Math.abs(parseFloat(String(s).replace(/[$,]/g, "")) || 0);
}

function parseDate(s: string | null): string {
  // AppFolio returns MM/DD/YYYY — convert to YYYY-MM-DD
  if (!s) return "";
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  return s;
}

// ── Actual AppFolio column names from the deposit_register report ──────────
// Header row:  DepositNumber = "82" | DepositAmount = "2,732.00" | rest = null
// Receipt row: DepositNumber = null  | ReceiptAmount = "1,705.00" | Payer, PropertyName, Reference, ReceiptDate, UnitName

interface AfLine {
  tenant: string;
  amount: number;
  reference: string;
  property: string;
  unit: string;
  memo: string;
  date: string;        // YYYY-MM-DD
  rentMonth: string;   // YYYY-MM inferred from ReceiptDescription
}

interface AfDeposit {
  depositNumber: string;
  depositDate: string;
  totalAmount: number;
  lines: AfLine[];
}

function parseDepositRegister(rows: any[]): AfDeposit[] {
  const deposits: AfDeposit[] = [];
  let current: AfDeposit | null = null;

  for (const row of rows) {
    const depNum = row["DepositNumber"];   // null on receipt lines, string on headers

    if (depNum !== null && depNum !== undefined && String(depNum).trim() !== "") {
      // ── Deposit header row ──
      if (current) deposits.push(current);
      current = {
        depositNumber: String(depNum).trim(),
        depositDate: parseDate(row["ReceiptDate"] || row["Date"] || ""),
        totalAmount: parseAmount(row["DepositAmount"]),
        lines: [],
      };
    } else if (current) {
      // ── Receipt line row ──
      const amount = parseAmount(row["ReceiptAmount"]);
      if (amount === 0) continue;

      const rawDate = parseDate(row["ReceiptDate"] || "");
      // Infer rent month from ReceiptDescription e.g. "January 2026"
      let rentMonth = "";
      const desc = row["ReceiptDescription"] || "";
      const monthMatch = desc.match(/(\w+)\s+(20\d{2})/);
      if (monthMatch) {
        const months: Record<string,string> = {january:"01",february:"02",march:"03",april:"04",may:"05",june:"06",july:"07",august:"08",september:"09",october:"10",november:"11",december:"12"};
        const mon = months[monthMatch[1].toLowerCase()];
        if (mon) rentMonth = `${monthMatch[2]}-${mon}`;
      }
      if (!rentMonth && rawDate) rentMonth = rawDate.substring(0, 7);

      current.lines.push({
        tenant: row["Payer"] || "",
        amount,
        reference: row["Reference"] || "",
        property: row["PropertyName"] || "",
        unit: row["UnitName"] || "",
        memo: desc,
        date: rawDate,
        rentMonth,
      });
    }
    // rows before the first header are ignored
  }

  if (current) deposits.push(current);
  return deposits;
}

// ── Match an app receipt to a deposit line ─────────────────────────────────

function matchLine(receipt: any, line: AfLine): boolean {
  // Amount must match exactly (to the cent)
  const rAmt = Math.round(Math.abs(Number(receipt.amount)) * 100);
  const lAmt = Math.round(line.amount * 100);
  if (rAmt === 0 || lAmt === 0 || rAmt !== lAmt) return false;

  // Tenant name match (handles "Last, First" vs "First Last")
  const tenantOk = namesMatch(receipt.tenant, line.tenant);

  // Property street number match as fallback
  const rAddr = normAddr(receipt.property);
  const lAddr = normAddr(line.property);
  const rNum = rAddr.match(/^\d+/)?.[0];
  const lNum = lAddr.match(/^\d+/)?.[0];
  const propOk = !!(rNum && lNum && rNum === lNum);

  if (!tenantOk && !propOk) return false;

  // If both have references, they must agree
  const rRef = normRef(receipt.reference);
  const lRef = normRef(line.reference);
  if (rRef.length >= 4 && lRef.length >= 4) {
    if (!rRef.includes(lRef) && !lRef.includes(rRef)) return false;
  }

  // If we have rent months on both, they must be within 1 month
  if (receipt.rent_month && line.rentMonth) {
    const [ry, rm] = receipt.rent_month.split("-").map(Number);
    const [ly, lm] = line.rentMonth.split("-").map(Number);
    const diff = Math.abs((ry * 12 + rm) - (ly * 12 + lm));
    if (diff > 1) return false;
  }

  return true;
}

// ── Edge function ──────────────────────────────────────────────────────────

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

    const adminClient = createClient(supabaseUrl, serviceKey);
    const clientId = Deno.env.get("APPFOLIO_CLIENT_ID");
    const clientSecret = Deno.env.get("APPFOLIO_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error("AppFolio credentials not configured");

    let fromDate = "", toDate = "";
    let autoCreateBatches = false;
    let createMissingReceipts = false;
    try {
      const body = await req.json();
      fromDate = body.from_date || "";
      toDate = body.to_date || "";
      autoCreateBatches = body.auto_create_batches === true;
      createMissingReceipts = body.create_missing_receipts === true;
    } catch { /* no body */ }

    if (!fromDate) { const d = new Date(); d.setDate(d.getDate() - 90); fromDate = d.toISOString().substring(0, 10); }
    if (!toDate) toDate = new Date().toISOString().substring(0, 10);

    console.log(`Deposit sync ${fromDate}→${toDate} autoCreate=${autoCreateBatches} createMissing=${createMissingReceipts}`);

    // ── Fetch deposit register ─────────────────────────────────────────────
    const appfolioBase = "https://countywidemanagement.appfolio.com";
    const basicAuth = btoa(`${clientId}:${clientSecret}`);
    const rawRows: any[] = [];
    let pg = 1, more = true;
    while (more) {
      const url = `${appfolioBase}/api/v0/reports/deposit_register.json?paginate_results=true&per_page=500&page=${pg}&from_date=${fromDate}&to_date=${toDate}`;
      const resp = await fetch(url, {
        headers: { "Authorization": `Basic ${basicAuth}`, "Accept": "application/json" },
      });
      if (!resp.ok) {
        const err = await resp.text();
        console.error(`AppFolio deposit_register ${resp.status}: ${err.substring(0, 200)}`);
        break;
      }
      const data = await resp.json();
      const results: any[] = data?.results || (Array.isArray(data) ? data : []);
      console.log(`Page ${pg}: ${results.length} rows`);
      if (!results.length) { more = false; break; }
      rawRows.push(...results);
      if (results.length < 500) more = false; else pg++;
    }
    console.log(`Fetched ${rawRows.length} raw rows from AppFolio`);

    const afDeposits = parseDepositRegister(rawRows);
    const totalLines = afDeposits.reduce((s: number, d: AfDeposit) => s + d.lines.length, 0);
    console.log(`Parsed ${afDeposits.length} deposits, ${totalLines} receipt lines`);

    // ── Load app receipts ──────────────────────────────────────────────────
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
          missingInApp.push({
            deposit_number: dep.depositNumber,
            deposit_date: dep.depositDate,
            property: line.property,
            tenant: line.tenant,
            unit: line.unit,
            amount: line.amount,
            reference: line.reference,
            rent_month: line.rentMonth,
            memo: line.memo,
          });

          if (createMissingReceipts) {
            const { data: newR } = await adminClient.from("receipts").insert({
              user_id: user.id,
              property: line.property.split(" - ")[0],
              tenant: line.tenant,
              unit: line.unit,
              amount: line.amount,
              reference: line.reference,
              receipt_date: line.date || null,
              rent_month: line.rentMonth || null,
              memo: line.memo || `AppFolio deposit #${dep.depositNumber}`,
              status: "finalized",
              appfolio_recorded: true,
              appfolio_recorded_at: new Date().toISOString(),
              payment_type: "",
              file_name: `appfolio_deposit_${dep.depositNumber}`,
            }).select().single();
            if (newR) {
              lineMatches.push({ appReceipt: newR, line, autoCreated: true });
              matchedIds.add(newR.id);
              autoCreated.push({ id: newR.id, receipt_id: newR.receipt_id, tenant: newR.tenant, amount: newR.amount });
              console.log(`Auto-created: ${line.tenant} $${line.amount} → deposit #${dep.depositNumber}`);
            }
          }
        }
      }

      // ── Create deposit batch ───────────────────────────────────────────
      let batchId: string | null = null, batchCreated = false, batchExisted = false;

      if (autoCreateBatches && lineMatches.length > 0) {
        const { data: existing } = await adminClient.from("deposit_batches")
          .select("id").eq("deposit_period", `AF-${dep.depositNumber}`).maybeSingle();

        if (existing) {
          batchId = existing.id; batchExisted = true;
        } else {
          const total = lineMatches.reduce((s: number, m: any) => s + Math.abs(Number(m.appReceipt.amount)), 0);
          const prop = lineMatches[0]?.line.property?.split(" - ")[0] || dep.depositNumber;
          const { data: nb, error: bErr } = await adminClient.from("deposit_batches").insert({
            property: prop,
            deposit_period: `AF-${dep.depositNumber}`,
            total_amount: Math.round(total * 100) / 100,
            receipt_count: lineMatches.length,
            created_by: user.id,
            status: "draft",
            notes: `Synced from AppFolio deposit #${dep.depositNumber} (${dep.depositDate})`,
          }).select().single();
          if (bErr) console.error(`Batch error ${dep.depositNumber}:`, bErr.message);
          else if (nb) { batchId = nb.id; batchCreated = true; batchesCreated.push(nb); }
        }

        if (batchId && lineMatches.length > 0) {
          const ids = lineMatches.map((m: any) => m.appReceipt.id);
          await adminClient.from("receipts").update({
            batch_id: batchId,
            appfolio_recorded: true,
            appfolio_recorded_at: new Date().toISOString(),
            status: "finalized",
          }).in("id", ids);
        }
      }

      depositResults.push({
        deposit_number: dep.depositNumber,
        deposit_date: dep.depositDate,
        appfolio_total: Math.round(dep.totalAmount * 100) / 100,
        appfolio_line_count: dep.lines.length,
        matched_count: lineMatches.length,
        auto_created_count: lineMatches.filter((m: any) => m.autoCreated).length,
        unmatched_count: unmatchedLines.length,
        batch_id: batchId,
        batch_created: batchCreated,
        batch_already_existed: batchExisted,
      });
    }

    // ── App receipts with no deposit match ─────────────────────────────────
    const missingInAppfolio = appReceipts
      .filter((r: any) => !matchedIds.has(r.id) && !r.batch_id)
      .map((r: any) => ({
        receipt_id: r.receipt_id, id: r.id, tenant: r.tenant, property: r.property,
        unit: r.unit, amount: r.amount, reference: r.reference,
        rent_month: r.rent_month, appfolio_recorded: r.appfolio_recorded, status: r.status,
      }));

    console.log(`Done: ${afDeposits.length} deposits | ${matchedIds.size} matched | ${missingInApp.length} missing in app | ${missingInAppfolio.length} missing in AppFolio`);

    return new Response(JSON.stringify({
      success: true,
      date_range: { from: fromDate, to: toDate },
      appfolio_deposits_found: afDeposits.length,
      appfolio_total_lines: totalLines,
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
