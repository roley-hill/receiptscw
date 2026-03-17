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
    
    // Authenticate user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role for DB operations
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Parse the multipart form
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

    // Use Lovable AI to extract structured data from the PDF
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

    // Fetch all active receipts for matching
    const allReceipts: any[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data: page } = await adminClient
        .from("receipts")
        .select("id, tenant, unit, property, amount, receipt_date, batch_id, status")
        .is("deleted_at", null)
        .range(from, from + PAGE - 1);
      if (!page || page.length === 0) break;
      allReceipts.push(...page);
      if (page.length < PAGE) break;
      from += PAGE;
    }

    // Match each line item to a receipt
    const matched: { receiptId: string; lineItem: any }[] = [];
    const unmatched: any[] = [];
    const usedReceiptIds = new Set<string>();

    for (const item of deposit.line_items) {
      const match = findBestMatch(item, allReceipts, usedReceiptIds);
      if (match) {
        matched.push({ receiptId: match.id, lineItem: item });
        usedReceiptIds.add(match.id);
      } else {
        unmatched.push(item);
      }
    }

    // Look up property for ownership entity
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

    // Create the deposit batch with AppFolio deposit number
    const totalMatched = matched.reduce((s, m) => s + Number(m.lineItem.amount), 0);

    // Use raw SQL via service role to set batch_id directly
    const { data: newBatch, error: batchErr } = await adminClient
      .from("deposit_batches")
      .insert({
        batch_id: batchLabel,
        property: matched.length > 0
          ? allReceipts.find(r => r.id === matched[0].receiptId)?.property || "Unknown"
          : "Unknown",
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

    // Unlink matched receipts from any existing batch and assign to new one
    for (const m of matched) {
      await adminClient
        .from("receipts")
        .update({ batch_id: newBatch.id })
        .eq("id", m.receiptId);
    }

    // Recalculate any source batches that lost receipts
    const affectedBatchIds = new Set<string>();
    for (const m of matched) {
      const orig = allReceipts.find(r => r.id === m.receiptId);
      if (orig?.batch_id && orig.batch_id !== newBatch.id) {
        affectedBatchIds.add(orig.batch_id);
      }
    }
    for (const bId of affectedBatchIds) {
      const { data: remaining } = await adminClient
        .from("receipts")
        .select("id, amount")
        .eq("batch_id", bId)
        .is("deleted_at", null);
      const remTotal = remaining?.reduce((s, r) => s + Number(r.amount), 0) || 0;
      const remCount = remaining?.length || 0;
      if (remCount === 0) {
        await adminClient.from("deposit_batches").update({
          total_amount: 0, receipt_count: 0, status: "reversed",
        }).eq("id", bId);
      } else {
        await adminClient.from("deposit_batches").update({
          total_amount: remTotal, receipt_count: remCount,
        }).eq("id", bId);
      }
    }

    return new Response(JSON.stringify({
      status: "success",
      batch_id: batchLabel,
      deposit_number: depNum,
      deposit_date: deposit.deposit_date,
      total_amount: deposit.total_amount,
      matched_count: matched.length,
      unmatched_count: unmatched.length,
      unmatched_items: unmatched,
      affected_batches: Array.from(affectedBatchIds).length,
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

/**
 * Match a deposit line item to a receipt in the DB.
 * Priority: exact amount + fuzzy tenant name + fuzzy property/unit
 */
function findBestMatch(item: any, receipts: any[], used: Set<string>): any | null {
  const itemAmount = Number(item.amount);
  const itemTenant = normalizeName(item.tenant_name);
  const { streetNum, unitNum } = parsePropertyUnit(item.property);

  // Score each candidate
  let bestScore = 0;
  let bestReceipt: any = null;

  for (const r of receipts) {
    if (used.has(r.id)) continue;

    // Amount must match within $0.01
    if (Math.abs(Number(r.amount) - itemAmount) > 0.01) continue;

    let score = 1; // base score for amount match

    // Tenant name match
    const rTenant = normalizeName(r.tenant);
    if (rTenant === itemTenant) {
      score += 5;
    } else if (lastNameMatch(itemTenant, rTenant)) {
      score += 3;
    } else if (fuzzyNameMatch(itemTenant, rTenant)) {
      score += 2;
    } else {
      continue; // skip if no name match at all
    }

    // Property/unit match
    const rStreetNum = extractStreetNumber(r.property);
    const rUnit = extractUnitNumber(r.unit);
    if (streetNum && rStreetNum === streetNum) score += 2;
    if (unitNum && rUnit === unitNum) score += 3;

    if (score > bestScore) {
      bestScore = score;
      bestReceipt = r;
    }
  }

  return bestScore >= 4 ? bestReceipt : null; // require at least amount + some name match
}

function normalizeName(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\b(jr|sr|sir|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lastNameMatch(a: string, b: string): boolean {
  const aWords = a.split(" ");
  const bWords = b.split(" ");
  const aLast = aWords[aWords.length - 1];
  const bLast = bWords[bWords.length - 1];
  return aLast === bLast && aLast.length > 2;
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
  // "14732 Blythe St. - 8" → streetNum=14732, unitNum=8
  const streetMatch = prop.match(/^(\d+)/);
  const unitMatch = prop.match(/[-–]\s*(\d+)\s*$/);
  return {
    streetNum: streetMatch?.[1] || "",
    unitNum: unitMatch?.[1] || "",
  };
}

function extractStreetNumber(address: string): string {
  if (!address) return "";
  const m = address.match(/^(\d+)/);
  return m?.[1] || "";
}

function extractUnitNumber(unit: string): string {
  if (!unit) return "";
  // "14732-8" → "8", "9010-154" → "154", "8" → "8"
  const m = unit.match(/(?:^|\D)(\d+)$/);
  return m?.[1] || unit.replace(/\D/g, "");
}
