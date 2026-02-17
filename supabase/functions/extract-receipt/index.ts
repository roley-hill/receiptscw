import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Retry helper for transient AI gateway errors (503, 500)
async function fetchAIWithRetry(url: string, options: RequestInit, corsHdrs: Record<string, string>, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const resp = await fetch(url, options);
    if (resp.ok) return resp;
    const errText = await resp.text();
    console.error(`AI attempt ${attempt + 1}/${maxRetries} failed:`, resp.status, errText);
    if (resp.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
        status: 402, headers: { ...corsHdrs, "Content-Type": "application/json" },
      });
    }
    if (resp.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
        status: 429, headers: { ...corsHdrs, "Content-Type": "application/json" },
      });
    }
    if (resp.status >= 500 && attempt < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`AI extraction failed (HTTP ${resp.status})`);
  }
  throw new Error("AI extraction failed after retries");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) throw new Error("No file provided");

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header
    let userId: string | null = null;
    if (authHeader) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || supabaseKey;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      userId = user?.id ?? null;
    }

    // Upload file to storage
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `uploads/${timestamp}_${safeName}`;
    
    const arrayBuffer = await file.arrayBuffer();
    const fileBytes = new Uint8Array(arrayBuffer);

    // Helper: encode Uint8Array to base64 without stack overflow
    function uint8ToBase64(bytes: Uint8Array): string {
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode(...chunk);
      }
      return btoa(binary);
    }

    const { error: uploadError } = await supabase.storage
      .from("receipts")
      .upload(filePath, fileBytes, { contentType: file.type, upsert: true });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    // Tool definition for MULTI-receipt extraction
    const extractMultiReceiptTool = {
      type: "function" as const,
      function: {
        name: "extract_receipts",
        description: "Extract one or more structured rent payment/receipt records from a document. Each line item on a remittance detail, spreadsheet row, or individual receipt should be its own entry in the items array.",
        parameters: {
          type: "object",
          properties: {
            items: {
              type: "array",
              description: "Array of receipt line items. One entry per tenant/unit payment.",
              items: {
                type: "object",
                properties: {
                  property: { type: "string", description: "Street address of the rental property (e.g. '9034 Orion Ave'). Never an owner entity or LP name." },
                  property_confidence: { type: "number", description: "Confidence 0-1" },
                  unit: { type: "string", description: "Unit or apartment number (e.g. '#11', 'Apt 3B')." },
                  unit_confidence: { type: "number", description: "Confidence 0-1" },
                  tenant: { type: "string", description: "Individual person's name who is the tenant/resident. Never an organization." },
                  tenant_confidence: { type: "number", description: "Confidence 0-1" },
                  payer: { type: "string", description: "Organization or person who made the payment." },
                  receipt_date: { type: "string", description: "Date of payment, format YYYY-MM-DD" },
                  receipt_date_confidence: { type: "number", description: "Confidence 0-1" },
                  rent_month: { type: "string", description: "Month the rent covers, format YYYY-MM" },
                  amount: { type: "number", description: "Payment amount in dollars." },
                  amount_confidence: { type: "number", description: "Confidence 0-1" },
                  payment_type: { type: "string", description: "Payment method: 'ACH', 'EFT', 'Check', 'Cash', 'Money Order', 'Wire', or other" },
                  payment_type_confidence: { type: "number", description: "Confidence 0-1" },
                  reference: { type: "string", description: "Check number, transaction ID, or EFT reference" },
                  memo: { type: "string", description: "Any memo or notes about the payment" },
                },
                required: ["property", "tenant", "amount"],
                additionalProperties: false,
              },
            },
            extracted_text: { type: "string", description: "Key text excerpts from the document (first 2000 chars)" },
          },
          required: ["items"],
          additionalProperties: false,
        },
      },
    };

    const systemPrompt = `You are a rent payment data extraction AI for a property management company.

CRITICAL RULES:
- "property" must be a STREET ADDRESS (e.g. "9034 Orion Ave"), never an owner entity or LP name like "9010 Tobias Owner LP"
- "tenant" must be an INDIVIDUAL PERSON's name (e.g. "Maria Rodriguez"), never an organization, agency, or LP name
- "tenant" must NEVER include invoice codes, descriptions, rent periods, or unit numbers. Extract ONLY the person's name.
  - BAD: "CIS-SS8-FEB'26-M.VALENCIA#363" (this is an invoice description, not a tenant name)
  - GOOD: "M. Valencia" (just the person's name extracted from the description)
- When parsing invoice descriptions like "CIS-SS8-FEB'26-M.VALENCIA#363", separate out:
  - The tenant name (e.g. "M. Valencia")
  - The unit number (e.g. "#363")
  - The rent month (e.g. "2026-02" from "FEB'26")
  - The memo/reference info (e.g. "CIS-SS8")
- "payer" is the organization or person who sent the payment (may differ from tenant)
- "amount" MUST be a single numeric dollar value for that line item's payment (e.g. 1250.00). Do NOT concatenate digits from unrelated columns. Do NOT include reference numbers, check numbers, or dates in the amount.
- "memo" is ONLY for notes, comments, or remarks — NOT for amounts, dates, or reference numbers
- "receipt_date" should be the PAY DATE or payment date, not the invoice date

COLUMN MAPPING FOR SPREADSHEETS:
- Look at the column HEADERS to determine what each column contains
- The column labeled "Amount", "Payment", "Rent", "Total", or similar numeric payment column → "amount"
- The column labeled "Check", "Check #", "Ref", "Reference", "Transaction ID" → "reference"
- The column labeled "Notes", "Memo", "Comments", "Remarks" → "memo"
- Do NOT put dollar amounts into the memo field
- Do NOT put partial amounts or concatenated values into any field

EMAIL REMITTANCE RULES:
- For payment notification emails, look for PAYEE information, invoice tables, and voucher details
- The "Vou#" or "Voucher Number" is the "reference"
- Parse invoice description fields carefully to separate tenant name, unit, and rent period
- "ID#" fields are internal references, not receipt references

MULTI-LINE ITEM RULES:
- If this is a REMITTANCE DETAIL or ACH payment covering MULTIPLE tenants/units, extract EACH line item as a separate entry in the items array
- If this is a SPREADSHEET/LEDGER with multiple rows, each row is a separate receipt — extract ALL of them
- If this is a single receipt for one tenant, return an array with one item
- NEVER combine multiple line items into one — each tenant payment must be its own item
- Make sure every line item on the remittance or spreadsheet is accounted for

You MUST call the extract_receipts function.`;

    let extractedItems: any[] = [];
    let extractedText = "";
    
    const isImage = file.type.startsWith("image/");
    const fileExt = file.name.split(".").pop()?.toLowerCase();
    const isXlsx = fileExt === "xlsx" || fileExt === "xls" || file.type.includes("spreadsheet") || file.type.includes("excel");
    const isEml = fileExt === "eml" || file.type === "message/rfc822";
    const isPdf = fileExt === "pdf" || file.type === "application/pdf";

    if (isImage || isPdf) {
      const base64 = uint8ToBase64(fileBytes);
      const dataUrl = `data:${file.type};base64,${base64}`;

      const messages: any[] = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract ALL rent payment line items from this document. If it is a remittance detail with multiple tenants/units, extract EACH line item separately. Carefully distinguish between: the property street address, each tenant's personal name, the paying organization/agency, the payment amount per tenant, and the payment method." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ];

      const aiRequestBody = JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        tools: [extractMultiReceiptTool],
        tool_choice: { type: "function", function: { name: "extract_receipts" } },
      });

      const aiResponse = await fetchAIWithRetry("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: aiRequestBody,
      }, corsHeaders);

      // If retry helper returned a non-OK response (402/429), pass it through
      if (!aiResponse.ok) return aiResponse;

      const aiData = await aiResponse.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall) {
        const parsed = JSON.parse(toolCall.function.arguments);
        extractedItems = parsed.items || [];
        extractedText = parsed.extracted_text || "";
      }
    } else if (isXlsx || isEml) {
      let textContent = "";

      if (isEml) {
        const decoder = new TextDecoder("utf-8");
        const rawEml = decoder.decode(fileBytes);

        // --- Robust MIME HTML extraction ---
        function extractMimePartByType(eml: string, mimeType: string): string | null {
          // 1. Try to find MIME boundary from Content-Type header
          const boundaryMatch = eml.match(/boundary="?([^\s";\r\n]+)"?/i);
          console.log("EML boundary found:", boundaryMatch?.[1] || "NONE");
          
          function decodePart(part: string): string | null {
            const encodingMatch = part.match(/content-transfer-encoding:\s*(\S+)/i);
            const encoding = encodingMatch?.[1]?.toLowerCase() || "7bit";
            const blankLine = part.indexOf("\r\n\r\n");
            const blankLine2 = part.indexOf("\n\n");
            const bodyStart = blankLine > 0 ? blankLine + 4 : (blankLine2 > 0 ? blankLine2 + 2 : -1);
            if (bodyStart < 0) return null;
            let body = part.substring(bodyStart).trim();
            // Remove trailing boundary markers
            const nextBoundary = body.indexOf("\r\n--");
            if (nextBoundary > 0) body = body.substring(0, nextBoundary).trim();
            if (encoding === "base64") {
              try { body = atob(body.replace(/\s/g, "")); } catch { return null; }
            } else if (encoding === "quoted-printable") {
              body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
            }
            return body.length > 20 ? body : null;
          }

          const typeRegex = new RegExp(`content-type:\\s*${mimeType.replace("/", "\\/")}`, "i");

          if (boundaryMatch) {
            const boundary = boundaryMatch[1];
            const parts = eml.split("--" + boundary);
            console.log(`EML split into ${parts.length} parts for type ${mimeType}`);
            for (const part of parts) {
              if (!typeRegex.test(part)) continue;
              const decoded = decodePart(part);
              if (decoded) return decoded;
            }
            // Try nested boundaries
            for (const part of parts) {
              const nestedBoundary = part.match(/boundary="?([^\s";\r\n]+)"?/i);
              if (!nestedBoundary) continue;
              console.log("Trying nested boundary:", nestedBoundary[1]);
              const nestedParts = part.split("--" + nestedBoundary[1]);
              for (const np of nestedParts) {
                if (!typeRegex.test(np)) continue;
                const decoded = decodePart(np);
                if (decoded) return decoded;
              }
              // Try 3rd level nesting
              for (const np of nestedParts) {
                const nb3 = np.match(/boundary="?([^\s";\r\n]+)"?/i);
                if (!nb3) continue;
                const parts3 = np.split("--" + nb3[1]);
                for (const p3 of parts3) {
                  if (!typeRegex.test(p3)) continue;
                  const decoded = decodePart(p3);
                  if (decoded) return decoded;
                }
              }
            }
          }

          // 2. Fallback: split by any boundary-like pattern
          const parts2 = eml.split(/--[\w\-\.=\/+]+/);
          for (const part of parts2) {
            if (!typeRegex.test(part)) continue;
            const decoded = decodePart(part);
            if (decoded) return decoded;
          }

          // 3. Last resort for HTML: extract <html>...</html> directly
          if (mimeType === "text/html") {
            const htmlMatch = eml.match(/<html[\s\S]*<\/html>/i);
            if (htmlMatch) return htmlMatch[0];
          }
          return null;
        }

        // Try HTML first, then plain text
        const htmlBody = extractMimePartByType(rawEml, "text/html");
        const plainBody = !htmlBody ? extractMimePartByType(rawEml, "text/plain") : null;
        console.log("EML extraction result - HTML:", !!htmlBody, "Plain:", !!plainBody);

        // For AI: send the raw EML (headers help with extraction context)
        textContent = rawEml;
        if (textContent.length > 30000) textContent = textContent.substring(0, 30000);

        // Store for preview: prefer HTML, then wrap plain text in basic HTML
        if (htmlBody) {
          extractedText = htmlBody.substring(0, 80000);
        } else if (plainBody) {
          extractedText = `<html><body><pre style="font-family:Arial,sans-serif;white-space:pre-wrap;padding:20px;">${plainBody.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`;
        } else {
          // Last fallback: skip all headers, show body text
          // Find the end of the top-level headers
          const headerEnd = rawEml.search(/\r?\n\r?\n/);
          const bodyText = headerEnd > 0 ? rawEml.substring(headerEnd + 2) : rawEml;
          extractedText = `<html><body><pre style="font-family:Arial,sans-serif;white-space:pre-wrap;padding:20px;">${bodyText.substring(0, 50000).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`;
        }
      } else {
        // Parse XLSX properly into CSV text so the AI can read actual cell values
        try {
          const workbook = XLSX.read(fileBytes, { type: "array" });
          const csvParts: string[] = [];
          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet);
            csvParts.push(`=== Sheet: ${sheetName} ===\n${csv}`);
          }
          textContent = csvParts.join("\n\n");
          if (textContent.length > 30000) textContent = textContent.substring(0, 30000);
          console.log("Parsed XLSX to CSV, length:", textContent.length);
        } catch (xlsxErr) {
          console.error("XLSX parse error, falling back to raw text:", xlsxErr);
          const decoder = new TextDecoder("utf-8", { fatal: false });
          textContent = decoder.decode(fileBytes).substring(0, 20000);
        }
      }

      const aiResponse = await fetchAIWithRetry("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Extract ALL rent payment line items from this ${isEml ? "email" : "spreadsheet"}. EVERY row/line item in the ${isEml ? "remittance detail" : "spreadsheet"} represents a separate receipt for a different tenant — extract ALL of them as separate items.\n\n${textContent}`,
            },
          ],
          tools: [extractMultiReceiptTool],
          tool_choice: { type: "function", function: { name: "extract_receipts" } },
        }),
      }, corsHeaders);

      if (!aiResponse.ok) return aiResponse;

      const aiData = await aiResponse.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall) {
        const parsed = JSON.parse(toolCall.function.arguments);
        extractedItems = parsed.items || [];
        // For EML, keep the HTML body we already extracted; for XLSX keep the CSV
        if (!extractedText) {
          extractedText = parsed.extracted_text || textContent.substring(0, 5000);
        }
      }
    } else {
      // Unknown file type — placeholder single item
      extractedItems = [{
        property: "",
        property_confidence: 0,
        tenant: "",
        tenant_confidence: 0,
        amount: 0,
        amount_confidence: 0,
      }];
      extractedText = `[${fileExt?.toUpperCase() || "Unknown"} file: ${file.name}]`;
    }

    // Fallback if AI returned empty
    if (extractedItems.length === 0) {
      extractedItems = [{
        property: "",
        property_confidence: 0,
        tenant: "",
        tenant_confidence: 0,
        amount: 0,
        amount_confidence: 0,
      }];
    }

    // ---- DUPLICATE DETECTION & INSERT ----
    const insertedReceipts: any[] = [];
    const duplicates: any[] = [];

    for (const item of extractedItems) {
      // Check for duplicates: same tenant + amount + receipt_date + property
      if (item.tenant && item.amount && item.receipt_date) {
        const { data: existing } = await supabase
          .from("receipts")
          .select("id, receipt_id")
          .eq("tenant", item.tenant)
          .eq("amount", item.amount)
          .eq("receipt_date", item.receipt_date)
          .eq("property", item.property || "")
          .limit(1);

        if (existing && existing.length > 0) {
          duplicates.push({
            tenant: item.tenant,
            amount: item.amount,
            receipt_date: item.receipt_date,
            existing_receipt_id: existing[0].receipt_id,
          });
          continue; // skip duplicate
        }
      }

      // Also check by file_name + all key fields to catch re-uploads
      if (item.tenant && item.amount && item.receipt_date) {
        const query = supabase
          .from("receipts")
          .select("id, receipt_id")
          .eq("file_name", file.name)
          .eq("tenant", item.tenant)
          .eq("amount", item.amount)
          .eq("receipt_date", item.receipt_date)
          .eq("property", item.property || "")
          .eq("unit", item.unit || "")
          .limit(1);

        const { data: fileExisting } = await query;

        if (fileExisting && fileExisting.length > 0) {
          duplicates.push({
            tenant: item.tenant,
            amount: item.amount,
            receipt_date: item.receipt_date,
            existing_receipt_id: fileExisting[0].receipt_id,
            reason: "same_file_reupload",
          });
          continue;
        }
      }

      // Determine status based on confidence
      const confidences = [
        item.property_confidence || 0,
        item.unit_confidence || 0,
        item.tenant_confidence || 0,
        item.amount_confidence || 0,
        item.receipt_date_confidence || 0,
      ];
      const avgConfidence = confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length;
      const hasMissingRequired = !item.property || !item.tenant || !item.amount;
      const status = hasMissingRequired ? "exception" : avgConfidence < 0.7 ? "exception" : "needs_review";

      const { data: receipt, error: insertError } = await supabase
        .from("receipts")
        .insert({
          user_id: userId,
          property: item.property || "",
          unit: item.unit || "",
          tenant: item.tenant || "",
          receipt_date: item.receipt_date || null,
          rent_month: item.rent_month || null,
          amount: item.amount || 0,
          payment_type: item.payment_type || "",
          reference: item.reference || "",
          memo: item.memo || "",
          confidence_scores: {
            property: item.property_confidence || 0,
            unit: item.unit_confidence || 0,
            tenant: item.tenant_confidence || 0,
            amount: item.amount_confidence || 0,
            receiptDate: item.receipt_date_confidence || 0,
            paymentType: item.payment_type_confidence || 0,
          },
          status,
          file_path: filePath,
          file_name: file.name,
          original_text: extractedText,
        })
        .select()
        .single();

      if (insertError) {
        console.error("Insert error for item:", item.tenant, insertError.message);
        continue;
      }

      insertedReceipts.push(receipt);

      // Audit log
      await supabase.from("audit_logs").insert({
        user_id: userId,
        action: "receipt_uploaded",
        entity_type: "receipt",
        entity_id: receipt.receipt_id,
        details: { file_name: file.name, status, confidence: avgConfidence, line_item: true },
      });
    }

    return new Response(JSON.stringify({
      receipts: insertedReceipts,
      duplicates,
      total_line_items: extractedItems.length,
      inserted_count: insertedReceipts.length,
      duplicate_count: duplicates.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-receipt error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
