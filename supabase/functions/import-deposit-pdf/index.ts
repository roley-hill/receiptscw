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

    const adminClient = createClient(supabaseUrl, serviceKey);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Convert PDF to base64 for AI vision
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const base64 = btoa(String.fromCharCode(...fileBytes));

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:application/pdf;base64,${base64}` },
              },
              {
                type: "text",
                text: `Extract all data from this Bank Deposit document. Return structured JSON using the extract_deposit tool.`,
              },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_deposit",
              description: "Extract bank deposit data from a PDF",
              parameters: {
                type: "object",
                properties: {
                  deposit_number: { type: "string", description: "The Deposit Number from the header" },
                  deposit_date: { type: "string", description: "Deposit Date in YYYY-MM-DD format" },
                  bank_name: { type: "string" },
                  description: { type: "string", description: "The Description field (often a reference number)" },
                  total_amount: { type: "number", description: "The total deposit amount" },
                  line_items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        check_number: { type: "string" },
                        date: { type: "string", description: "Check date in YYYY-MM-DD format" },
                        property: { type: "string", description: "Full property text e.g. '14732 Blythe St. - 8'" },
                        tenant_name: { type: "string", description: "The From field - tenant full name" },
                        description: { type: "string", description: "e.g. 'January rent'" },
                        amount: { type: "number" },
                      },
                      required: ["check_number", "date", "property", "tenant_name", "amount"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["deposit_number", "deposit_date", "total_amount", "line_items"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_deposit" } },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI error:", aiResp.status, errText);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI extraction failed: ${aiResp.status}`);
    }

    const aiData = await aiResp.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("AI did not return structured data");

    const deposit = JSON.parse(toolCall.function.arguments);
    console.log("Extracted deposit:", deposit.deposit_number, "with", deposit.line_items.length, "items");

    // Check if deposit already exists
    const depNum = deposit.deposit_number;
    const batchLabel = `DEP-${depNum}`;
    const { data: existingBatch } = await adminClient
      .from("deposit_batches")
      .select("id, batch_id")
      .eq("batch_id", batchLabel)
      .maybeSingle();

    if (existingBatch) {
      return new Response(JSON.stringify({
        status: "skipped",
        message: `Deposit ${batchLabel} already exists`,
        batch_id: existingBatch.batch_id,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all active receipts for matching (including already-batched for info, but won't re-batch)
    const allReceipts: any[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data: page } = await adminClient
        .from("receipts")
        .select("id, tenant, unit, property, amount, receipt_date, rent_month, batch_id, status, reference")
        .is("deleted_at", null)
        .range(from, from + PAGE - 1);
      if (!page || page.length === 0) break;
      allReceipts.push(...page);
      if (page.length < PAGE) break;
      from += PAGE;
    }

    const depositDate = deposit.deposit_date ? new Date(deposit.deposit_date) : new Date();
    const depositMonth = deposit.deposit_date ? deposit.deposit_date.substring(0, 7) : null;

    // Match each line item to a receipt
    const matched: { receiptId: string; lineItem: any; score: number }[] = [];
    const unmatched: any[] = [];
    const nearMatches: any[] = []; // close but not confident enough
    const usedReceiptIds = new Set<string>();

    for (const item of deposit.line_items) {
      const result = findBestMatch(item, allReceipts, usedReceiptIds, depositDate, depositMonth);
      if (result.match) {
        matched.push({ receiptId: result.match.id, lineItem: item, score: result.score });
        usedReceiptIds.add(result.match.id);
      } else {
        unmatched.push({
          tenant_name: item.tenant_name,
          amount: item.amount,
          property: item.property,
          check_number: item.check_number,
          date: item.date,
          description: item.description,
        });
        // Include near-matches for preview UI
        if (result.nearMatch) {
          nearMatches.push({
            deposit_line: {
              tenant_name: item.tenant_name,
              amount: item.amount,
              property: item.property,
              check_number: item.check_number,
              date: item.date,
              description: item.description,
            },
            receipt: {
              id: result.nearMatch.id,
              tenant: result.nearMatch.tenant,
              property: result.nearMatch.property,
              amount: result.nearMatch.amount,
              rent_month: result.nearMatch.rent_month,
              reference: result.nearMatch.reference,
              unit: result.nearMatch.unit,
              receipt_date: result.nearMatch.receipt_date,
            },
            score: result.nearScore,
            reasons: result.nearReasons,
          });
        }
      }
    }

    const totalItems = deposit.line_items.length;
    const matchedCount = matched.length;
    const unmatchedCount = unmatched.length;

    let matchCategory: "complete" | "partial" | "unrelated";
    if (matchedCount === 0) {
      matchCategory = "unrelated";
    } else if (unmatchedCount === 0) {
      matchCategory = "complete";
    } else {
      matchCategory = "partial";
    }

    // ALWAYS create the batch (even partial), assign matched receipts
    let ownershipEntityId: string | null = null;
    if (matched.length > 0) {
      const firstReceipt = allReceipts.find(r => r.id === matched[0].receiptId);
      if (firstReceipt?.property) {
        const { data: prop } = await adminClient
          .from("properties")
          .select("ownership_entity_id")
          .eq("address", firstReceipt.property)
          .maybeSingle();
        if (prop?.ownership_entity_id) ownershipEntityId = prop.ownership_entity_id;
      }
    }

    const totalMatched = matched.reduce((s, m) => s + Number(m.lineItem.amount), 0);

    // Only create batch if we have at least one match
    let batchRecord: any = null;
    if (matchedCount > 0) {
      const { data: newBatch, error: batchErr } = await adminClient
        .from("deposit_batches")
        .insert({
          batch_id: batchLabel,
          property: allReceipts.find(r => r.id === matched[0].receiptId)?.property || "Unknown",
          deposit_period: deposit.deposit_date,
          total_amount: totalMatched,
          receipt_count: matched.length,
          created_by: user.id,
          status: "ready",
          ownership_entity_id: ownershipEntityId,
          external_reference: deposit.description || null,
          notes: `Imported from AppFolio Bank Deposit #${depNum}`,
        })
        .select()
        .single();

      if (batchErr) {
        console.error("Batch creation error:", batchErr);
        throw new Error(`Failed to create batch: ${batchErr.message}`);
      }

      batchRecord = newBatch;

      // Assign matched receipts (skip any already batched)
      const receiptIdsToAssign = matched
        .filter(m => {
          const r = allReceipts.find(x => x.id === m.receiptId);
          return r && !r.batch_id;
        })
        .map(m => m.receiptId);

      if (receiptIdsToAssign.length > 0) {
        for (let i = 0; i < receiptIdsToAssign.length; i += 100) {
          const batch = receiptIdsToAssign.slice(i, i + 100);
          await adminClient
            .from("receipts")
            .update({ batch_id: newBatch.id })
            .in("id", batch);
        }
      }
    }

    return new Response(JSON.stringify({
      status: matchCategory,
      batch_id: batchLabel,
      batch_uuid: batchRecord?.id || null,
      deposit_number: depNum,
      deposit_date: deposit.deposit_date,
      total_amount: deposit.total_amount,
      matched_count: matchedCount,
      unmatched_count: unmatchedCount,
      matched_items: matched.map(m => ({
        tenant: m.lineItem.tenant_name,
        amount: m.lineItem.amount,
        receiptId: m.receiptId,
        score: m.score,
      })),
      unmatched_items: unmatched,
      near_matches: nearMatches,
      message: matchCategory === "complete"
        ? `All ${matchedCount} receipts matched — batch ${batchLabel} created`
        : matchCategory === "partial"
        ? `${matchedCount}/${totalItems} matched — batch ${batchLabel} created with matched receipts`
        : `No matching receipts found`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("import-deposit-pdf error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

interface MatchResult {
  match: any | null;
  score: number;
  nearMatch: any | null;
  nearScore: number;
  nearReasons: string[];
}

function findBestMatch(item: any, receipts: any[], used: Set<string>, depositDate: Date, depositMonth: string | null): MatchResult {
  const itemAmount = Number(item.amount);
  const itemTenant = normalizeName(item.tenant_name);
  const itemRef = extractNumericRef(item.check_number);
  const { streetNum, unitNum } = parsePropertyUnit(item.property);

  let bestScore = 0;
  let bestReceipt: any = null;
  let bestReasons: string[] = [];

  let nearScore = 0;
  let nearReceipt: any = null;
  let nearReasons: string[] = [];

  for (const r of receipts) {
    if (used.has(r.id)) continue;
    // DUPLICATE GUARD: never add a receipt that already has a batch_id
    if (r.batch_id) continue;

    let score = 0;
    const reasons: string[] = [];

    // Amount must match within $0.01
    if (Math.abs(Number(r.amount) - itemAmount) > 0.01) continue;
    score += 1;
    reasons.push("amount");

    // 1. PRIMARY: Reference match
    const rRef = extractNumericRef(r.reference);
    if (itemRef && rRef) {
      if (itemRef === rRef) {
        score += 10;
        reasons.push("ref_exact");
      } else if (rRef.includes(itemRef) || itemRef.includes(rRef)) {
        score += 7;
        reasons.push("ref_partial");
      }
    }

    // 2. SECONDARY: Tenant name match
    const rTenant = normalizeName(r.tenant);
    if (rTenant === itemTenant) {
      score += 5;
      reasons.push("tenant_exact");
    } else if (lastNameMatch(itemTenant, rTenant)) {
      score += 3;
      reasons.push("tenant_lastname");
    } else if (fuzzyNameMatch(itemTenant, rTenant)) {
      score += 2;
      reasons.push("tenant_fuzzy");
    } else if (score < 10) {
      // Only allow no tenant match if we have a strong reference match
      // Track as near-match candidate
      if (score > nearScore) {
        nearScore = score;
        nearReceipt = r;
        nearReasons = [...reasons, "tenant_mismatch"];
      }
      continue;
    }

    // 3. Property/unit match
    const rStreetNum = extractStreetNumber(r.property);
    const rUnit = extractUnitNumber(r.unit);
    if (streetNum && rStreetNum === streetNum) {
      score += 2;
      reasons.push("property");
    }
    if (unitNum && rUnit === unitNum) {
      score += 3;
      reasons.push("unit");
    }

    // 4. DATE FLEXIBILITY: Use rent_month, allow ±1 month of deposit date
    if (r.rent_month && depositMonth) {
      const [ry, rm] = r.rent_month.split("-").map(Number);
      const [dy, dm] = depositMonth.split("-").map(Number);
      const diffMonths = Math.abs((ry * 12 + rm) - (dy * 12 + dm));
      if (diffMonths <= 1) {
        score += 2;
        reasons.push("month_match");
      }
      // Never reject based on date — just don't add bonus
    }

    if (score > bestScore) {
      bestScore = score;
      bestReceipt = r;
      bestReasons = reasons;
    }

    // Track near-match
    if (score > nearScore) {
      nearScore = score;
      nearReceipt = r;
      nearReasons = reasons;
    }
  }

  // Require minimum score of 5
  if (bestScore >= 5) {
    return { match: bestReceipt, score: bestScore, nearMatch: null, nearScore: 0, nearReasons: [] };
  }

  return {
    match: null,
    score: 0,
    nearMatch: nearReceipt,
    nearScore,
    nearReasons,
  };
}

function extractNumericRef(ref: string): string {
  if (!ref) return "";
  return ref.replace(/[^0-9]/g, "");
}

function normalizeName(name: string): string {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\b(jr|sr|sir|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
}

function lastNameMatch(a: string, b: string): boolean {
  const aWords = a.split(" ");
  const bWords = b.split(" ");
  return aWords[aWords.length - 1] === bWords[bWords.length - 1] && aWords[aWords.length - 1].length > 2;
}

function fuzzyNameMatch(a: string, b: string): boolean {
  const aWords = new Set(a.split(" ").filter(w => w.length > 2));
  const bWords = new Set(b.split(" ").filter(w => w.length > 2));
  let overlap = 0;
  for (const w of aWords) if (bWords.has(w)) overlap++;
  return overlap >= 1 && overlap >= Math.min(aWords.size, bWords.size) * 0.5;
}

function parsePropertyUnit(prop: string): { streetNum: string; unitNum: string } {
  if (!prop) return { streetNum: "", unitNum: "" };
  return {
    streetNum: prop.match(/^(\d+)/)?.[1] || "",
    unitNum: prop.match(/[-–]\s*(\d+)\s*$/)?.[1] || "",
  };
}

function extractStreetNumber(address: string): string {
  if (!address) return "";
  return address.match(/^(\d+)/)?.[1] || "";
}

function extractUnitNumber(unit: string): string {
  if (!unit) return "";
  return unit.match(/(?:^|\D)(\d+)$/)?.[1] || unit.replace(/\D/g, "");
}
