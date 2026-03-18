import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Normalisation ──────────────────────────────────────────────────────────

function normName(s: string): string {
  if (!s) return "";
  // AppFolio stores "Last, First" — normalise to "first last"
  const parts = s.split(",").map((p: string) => p.trim());
  const reordered = parts.length === 2 ? `${parts[1]} ${parts[0]}` : s;
  return reordered.toLowerCase().replace(/[.,'-]/g, " ").replace(/\s+/g, " ").trim();
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

// Extract just the street number + street name from a full property string
// "13412 Vanowen Street - 13412 Vanowen Street Van Nuys, CA 91405" → "13412 vanowen"
function shortAddr(s: string): string {
  const a = normAddr(s.split(" - ")[0] || s);
  const parts = a.split(" ").slice(0, 3);
  return parts.join(" ");
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

function parseAmount(s: string | null | undefined): number {
  if (!s) return 0;
  return Math.abs(parseFloat(String(s).replace(/[$,]/g, "")) || 0);
}

// ── AppFolio deposit register structure ────────────────────────────────────
//
// The deposit_register report returns rows where:
//   DepositNumber = null  → individual receipt/payment line (the actual transactions)
//   DepositNumber = value → deposit header/summary row (groups the lines below)
//
// Receipt lines have: Payer, PropertyName, UnitName, ReceiptAmount, Reference,
//                     ReceiptDate, ReceiptDescription, Type, TxnId
// Header rows have:   DepositNumber, DepositAmount, Date
//
// The grouping is sequential: header row → all null-DepositNumber rows until next header

interface AfLine {
  payer: string;
  amount: number;
  reference: string;
  property: string;
  propertyFull: string;
  unit: string;
  date: string;
  description: string;
  type: string;
  txnId: number;
}

interface AfDeposit {
  depositNumber: string;
  depositDate: string;
  depositAmount: number;
  lines: AfLine[];
}

function parseDepositRegister(rows: any[]): AfDeposit[] {
  const deposits: AfDeposit[] = [];
  let current: AfDeposit | null = null;

  for (const row of rows) {
    const depNum = row["DepositNumber"];

    if (depNum !== null && depNum !== undefined && String(depNum).trim() !== "") {
      // Deposit header row
      if (current && current.lines.length > 0) deposits.push(current);
      // If current has no lines, discard it (empty header)
      else if (current) { /* discard empty */ }

      current = {
        depositNumber: String(depNum).trim(),
        depositDate: (row["ReceiptDate"] || row["Date"] || "").trim(),
        depositAmount: parseAmount(row["DepositAmount"] || row["Amount"]),
        lines: [],
      };
    } else if (current) {
      // Receipt line belonging to current deposit
      const amount = parseAmount(row["ReceiptAmount"] || row["Amount"]);
      if (amount === 0) continue;

      const propertyFull = String(row["PropertyName"] || "");
      current.lines.push({
        payer: String(row["Payer"] || "").trim(),
        amount,
        reference: String(row["Reference"] || "").trim(),
        property: shortAddr(propertyFull),
        propertyFull,
        unit: String(row["UnitName"] || "").trim(),
        date: String(row["ReceiptDate"] || current.depositDate || "").trim(),
        description: String(row["ReceiptDescription"] || row["Description"] || "").trim(),
        type: String(row["Type"] || "").trim(),
        txnId: Number(row["TxnId"] || 0),
      });
    } else {
      // Receipt line BEFORE any deposit header — create an "undeposited" bucket
      const amount = parseAmount(row["ReceiptAmount"] || row["Amount"]);
      if (amount === 0) continue;
      if (!current) {
        current = { depositNumber: "UNDEPOSITED", depositDate: "", depositAmount: 0, lines: [] };
      }
      const propertyFull = String(row["PropertyName"] || "");
      current.lines.push({
        payer: String(row["Payer"] || "").trim(),
        amount,
        reference: String(row["Reference"] || "").trim(),
        property: shortAddr(propertyFull),
        propertyFull,
        unit: String(row["UnitName"] || "").trim(),
        date: String(row["ReceiptDate"] || "").trim(),
        description: String(row["ReceiptDescription"] || "").trim(),
        type: String(row["Type"] || "").trim(),
        txnId: Number(row["TxnId"] || 0),
      });
    }
  }
  if (current && current.lines.length > 0) deposits.push(current);
  return deposits;
}

// ── Match app receipt to deposit line ──────────────────────────────────────

function matchLine(receipt: any, line: AfLine): boolean {
  const rAmt = Math.round(Math.abs(Number(receipt.amount)) * 100);
  const lAmt = Math.round(line.amount * 100);
  if (rAmt === 0 || lAmt === 0 || rAmt !== lAmt) return false;

  // Payer (AppFolio) vs tenant (app) — also try property match
  const tenantOk = namesMatch(receipt.tenant, line.payer);
  const propOk = line.property && receipt.property &&
    shortAddr(receipt.property).split(" ")[0] === line.property.split(" ")[0];

  if (!tenantOk && !propOk) return false;

  // Reference match tightens — if both have refs, they must agree
  const rRef = normRef(receipt.reference);
  const lRef = normRef(line.reference);
  if (rRef.length >= 4 && lRef.length >= 4) {
    if (!rRef.includes(lRef) && !lRef.includes(rRef)) return false;
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
      fromDate = body.from_date || "";
      toDate = body.to_date || "";
      autoCreateBatches = body.auto_create_batches === true;
      createMissingReceipts = body.create_missing_receipts === true;
    } catch { /* no body */ }

    if (!fromDate) { const d = new Date(); d.setDate(d.getDate() - 90); fromDate = d.toISOString().substring(0, 10); }
    if (!toDate) toDate = new Date().toISOString().substring(0, 10);

    console.log(`Deposit sync ${fromDate}→${toDate} autoCreate=${autoCreateBatches} createMissing=${createMissingReceipts}`);

    // ── Fetch deposit register ─────────────────────────────────────────────
    // NOTE: AppFolio deposit_register does NOT support &page=N parameter.
    // Pagination is handled via next_page_url in the response.
    const appfolioBase = "https://countywidemanagement.appfolio.com";
    const basicAuth = btoa(`${clientId}:${clientSecret}`);
    const rawRows: any[] = [];
    let nextUrl: string | null = `${appfolioBase}/api/v0/reports/deposit_register.json?paginate_results=true&per_page=5000&from_date=${fromDate}&to_date=${toDate}`;

    while (nextUrl) {
      const resp = await fetch(nextUrl, { headers: { "Authorization": `Basic ${basicAuth}`, "Accept": "application/json" } });
      if (!resp.ok) { console.error(`AppFolio ${resp.status}: ${await resp.text().then(t=>t.substring(0,200))}`); break; }
      const data = await resp.json();
      const results: any[] = data?.results || (Array.isArray(data) ? data : []);
      console.log(`Fetched page: ${results.length} rows`);
      rawRows.push(...results);
      // Follow next_page_url if present and results were full page
      const rawNext: string = data?.next_page_url || "";
      nextUrl = rawNext && results.length >= 100 ? rawNext : null;
    }
    console.log(`Fetched ${rawRows.length} total raw rows`);

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
          if (dep.depositNumber !== "UNDEPOSITED") {
            missingInApp.push({
              deposit_number: dep.depositNumber,
              deposit_date: dep.depositDate,
              property: line.propertyFull,
              unit: line.unit,
              tenant: line.payer,
              amount: line.amount,
              reference: line.reference,
              description: line.description,
              type: line.type,
            });
          }

          if (createMissingReceipts && dep.depositNumber !== "UNDEPOSITED") {
            // Parse date from MM/DD/YYYY to YYYY-MM-DD
            let receiptDate: string | null = null;
            let rentMonth: string | null = null;
            if (line.date) {
              const parts = line.date.split("/");
              if (parts.length === 3) {
                receiptDate = `${parts[2]}-${parts[0].padStart(2,"0")}-${parts[1].padStart(2,"0")}`;
                rentMonth = `${parts[2]}-${parts[0].padStart(2,"0")}`;
              }
            }
            const { data: newR } = await adminClient.from("receipts").insert({
              user_id: user.id,
              property: line.propertyFull.split(" - ")[0] || line.propertyFull,
              tenant: line.payer,
              unit: line.unit,
              amount: line.amount,
              reference: line.reference,
              receipt_date: receiptDate,
              rent_month: rentMonth,
              memo: line.description || `Auto-created from AppFolio deposit #${dep.depositNumber}`,
              status: "finalized",
              appfolio_recorded: true,
              appfolio_recorded_at: new Date().toISOString(),
              payment_type: line.type || "",
              file_name: `appfolio_deposit_${dep.depositNumber}`,
            }).select().single();
            if (newR) {
              lineMatches.push({ appReceipt: newR, line, autoCreated: true });
              matchedIds.add(newR.id);
              autoCreated.push(newR);
              console.log(`Auto-created: ${line.payer} $${line.amount} deposit #${dep.depositNumber}`);
            }
          }
        }
      }

      // Create batch if requested and deposit has real lines
      let batchId: string | null = null, batchCreated = false, batchExisted = false;
      if (autoCreateBatches && lineMatches.length > 0 && dep.depositNumber !== "UNDEPOSITED") {
        const { data: existing } = await adminClient.from("deposit_batches")
          .select("id").eq("deposit_period", `AF-${dep.depositNumber}`).maybeSingle();

        if (existing) {
          batchId = existing.id; batchExisted = true;
        } else {
          const total = lineMatches.reduce((s: number, m: any) => s + Math.abs(Number(m.appReceipt.amount)), 0);
          // Use most common property name among matched receipts
          const propCounts: Record<string,number> = {};
          lineMatches.forEach((m: any) => { const p = m.appReceipt.property || ""; propCounts[p] = (propCounts[p]||0)+1; });
          const batchProp = Object.entries(propCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || dep.depositNumber;

          const { data: nb } = await adminClient.from("deposit_batches").insert({
            property: batchProp,
            deposit_period: `AF-${dep.depositNumber}`,
            total_amount: Math.round(total * 100) / 100,
            receipt_count: lineMatches.length,
            created_by: user.id,
            status: "draft",
            notes: `Synced from AppFolio deposit #${dep.depositNumber} (${dep.depositDate})`,
          }).select().single();
          if (nb) { batchId = nb.id; batchCreated = true; batchesCreated.push(nb); }
        }

        if (batchId) {
          const ids = lineMatches.map((m: any) => m.appReceipt.id);
          if (ids.length) {
            await adminClient.from("receipts").update({
              batch_id: batchId,
              appfolio_recorded: true,
              appfolio_recorded_at: new Date().toISOString(),
              status: "finalized",
            }).in("id", ids);
          }
        }
      }

      depositResults.push({
        deposit_number: dep.depositNumber,
        deposit_date: dep.depositDate,
        appfolio_line_count: dep.lines.length,
        appfolio_total: Math.round(dep.depositAmount * 100) / 100,
        matched_count: lineMatches.length,
        auto_created_count: lineMatches.filter((m: any) => m.autoCreated).length,
        unmatched_count: unmatchedLines.length,
        batch_id: batchId,
        batch_created: batchCreated,
        batch_already_existed: batchExisted,
      });
    }

    // App receipts with no AppFolio deposit match
    const missingInAppfolio = appReceipts
      .filter((r: any) => !matchedIds.has(r.id) && !r.batch_id)
      .map((r: any) => ({
        receipt_id: r.receipt_id, id: r.id, tenant: r.tenant,
        property: r.property, amount: r.amount, reference: r.reference,
        rent_month: r.rent_month, appfolio_recorded: r.appfolio_recorded, status: r.status,
      }));

    return new Response(JSON.stringify({
      success: true,
      date_range: { from: fromDate, to: toDate },
      appfolio_deposits_found: afDeposits.filter((d: AfDeposit) => d.depositNumber !== "UNDEPOSITED").length,
      appfolio_undeposited_receipts: afDeposits.find((d: AfDeposit) => d.depositNumber === "UNDEPOSITED")?.lines.length || 0,
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
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("sync-appfolio-deposits error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
