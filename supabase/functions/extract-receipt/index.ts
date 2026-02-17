import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const { error: uploadError } = await supabase.storage
      .from("receipts")
      .upload(filePath, fileBytes, { contentType: file.type });

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    // Shared tool definition for AI extraction
    const extractReceiptTool = {
      type: "function" as const,
      function: {
        name: "extract_receipt_data",
        description: "Extract structured rent payment/receipt data from a document",
        parameters: {
          type: "object",
          properties: {
            property: { type: "string", description: "The physical street address of the rental property (e.g. '9034 Orion Ave'). Do NOT put owner entity names or LP names here. If only an owner LP name is visible, leave this empty." },
            property_confidence: { type: "number", description: "Confidence 0-1" },
            unit: { type: "string", description: "Unit or apartment number (e.g. '#11', 'Apt 3B'). Extract just the unit identifier." },
            unit_confidence: { type: "number", description: "Confidence 0-1" },
            tenant: { type: "string", description: "The individual person's name who is the tenant/resident (e.g. 'Maria Rodriguez'). Do NOT put organization names, agency names, or owner LP names here. If no individual tenant name is found, use empty string." },
            tenant_confidence: { type: "number", description: "Confidence 0-1" },
            payer: { type: "string", description: "The organization or person who made the payment (e.g. 'People Assisting the Homeless', 'Shine BC-LA', 'The Salvation Army'). This may differ from the tenant." },
            receipt_date: { type: "string", description: "Date the payment was made or receipt issued, format YYYY-MM-DD" },
            receipt_date_confidence: { type: "number", description: "Confidence 0-1" },
            rent_month: { type: "string", description: "The month the rent payment covers, format YYYY-MM (e.g. '2026-02')" },
            amount: { type: "number", description: "The actual payment amount in dollars. Be careful with formatting — do NOT combine multiple numbers. Look for the specific payment amount, not account numbers or reference IDs." },
            amount_confidence: { type: "number", description: "Confidence 0-1" },
            payment_type: { type: "string", description: "Payment method: 'ACH', 'EFT', 'Check', 'Cash', 'Money Order', 'Wire', or other" },
            payment_type_confidence: { type: "number", description: "Confidence 0-1" },
            reference: { type: "string", description: "Check number, transaction ID, or EFT reference number" },
            memo: { type: "string", description: "Any memo, remarks, or notes about the payment" },
            extracted_text: { type: "string", description: "Key text excerpts from the document (first 500 chars)" },
          },
          required: ["property", "tenant", "amount"],
          additionalProperties: false,
        },
      },
    };

    let extractedData: any = {};
    
    const isImage = file.type.startsWith("image/");
    const fileExt = file.name.split(".").pop()?.toLowerCase();
    const isXlsx = fileExt === "xlsx" || fileExt === "xls" || file.type.includes("spreadsheet") || file.type.includes("excel");
    const isEml = fileExt === "eml" || file.type === "message/rfc822";

    if (isImage) {
      const base64 = btoa(String.fromCharCode(...fileBytes));
      const dataUrl = `data:${file.type};base64,${base64}`;

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You are a rent payment data extraction AI for a property management company. Extract structured data from rent receipt/payment images.

CRITICAL RULES:
- "property" must be a STREET ADDRESS (e.g. "9034 Orion Ave"), never an owner entity or LP name like "9010 Tobias Owner LP"
- "tenant" must be an INDIVIDUAL PERSON's name (e.g. "Maria Rodriguez"), never an organization, agency, or LP name
- "payer" is the organization or person who sent the payment (may differ from tenant)
- "amount" is the PAYMENT AMOUNT in dollars — do NOT concatenate digits from different fields. Look for dollar signs, "amount", "total", or "payment" labels
- If a unit number appears as part of "Apt 3B" or "#11" or similar, extract just the unit part
- If you cannot identify a field with confidence, leave it empty rather than guessing

You MUST call the extract_receipt_data function with the extracted fields.`,
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract rent payment data from this image. Carefully distinguish between: the property street address, the tenant's personal name, the paying organization/agency, the payment amount, and the payment method." },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          tools: [extractReceiptTool],
          tool_choice: { type: "function", function: { name: "extract_receipt_data" } },
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error("AI error:", aiResponse.status, errText);
        if (aiResponse.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (aiResponse.status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw new Error("AI extraction failed");
      }

      const aiData = await aiResponse.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall) {
        extractedData = JSON.parse(toolCall.function.arguments);
      }
    } else if (isXlsx || isEml) {
      // For XLSX and EML: decode as text where possible, send to AI for extraction
      let textContent = "";

      if (isEml) {
        // EML files are text-based (RFC 822)
        const decoder = new TextDecoder("utf-8");
        textContent = decoder.decode(fileBytes);
        // Truncate to avoid token limits
        if (textContent.length > 30000) textContent = textContent.substring(0, 30000);
      } else {
        // XLSX: extract what we can as CSV-like text using basic parsing
        // Send the raw base64 to AI with instruction to parse
        const base64 = btoa(String.fromCharCode(...fileBytes));
        textContent = `[XLSX file base64 - first 20000 chars]: ${base64.substring(0, 20000)}`;
      }

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You are a rent payment data extraction AI for a property management company. Extract structured rent payment data from ${isEml ? "email (EML)" : "spreadsheet (XLSX)"} content.

CRITICAL RULES:
- "property" must be a STREET ADDRESS (e.g. "14654 Blythe St"), never an owner entity or LP name
- "tenant" must be an INDIVIDUAL PERSON's name, never an organization or agency name. Look for names in memo lines, reference codes, or payment descriptions that follow patterns like "F.RODRIGUEZ" or "H.AREVALO"
- "payer" is the organization or person who sent the payment (e.g. "People Assisting the Homeless", "The Salvation Army", "Shine BC-LA")
- "amount" is the PAYMENT AMOUNT — look for dollar amounts, not account numbers or reference IDs. Be very careful not to concatenate unrelated numbers
- For EML emails: payment notifications often have the amount in the subject or body. The "To" address is usually the property owner, NOT the tenant
- For spreadsheets: extract the first/primary receipt row

You MUST call the extract_receipt_data function.`,
            },
            {
              role: "user",
              content: `Extract rent payment data from this ${isEml ? "email" : "spreadsheet"} content. Carefully identify: the property street address (not owner LP name), the individual tenant name (not the paying organization), the exact payment amount, and payment method.\n\n${textContent}`,
            },
          ],
          tools: [extractReceiptTool],
          tool_choice: { type: "function", function: { name: "extract_receipt_data" } },
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error("AI error:", aiResponse.status, errText);
        if (aiResponse.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw new Error("AI extraction failed");
      }

      const aiData = await aiResponse.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall) {
        extractedData = JSON.parse(toolCall.function.arguments);
      }
      extractedData.extracted_text = isEml ? textContent.substring(0, 5000) : `[XLSX file: ${file.name}]`;
    } else {
      // For PDFs and other files, create a placeholder
      extractedData = {
        property: "",
        property_confidence: 0,
        tenant: "",
        tenant_confidence: 0,
        amount: 0,
        amount_confidence: 0,
        extracted_text: `[${fileExt?.toUpperCase() || "Unknown"} file: ${file.name}]`,
      };
    }

    // Determine status based on confidence
    const confidences = [
      extractedData.property_confidence || 0,
      extractedData.unit_confidence || 0,
      extractedData.tenant_confidence || 0,
      extractedData.amount_confidence || 0,
      extractedData.receipt_date_confidence || 0,
    ];
    const avgConfidence = confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length;
    const hasMissingRequired = !extractedData.property || !extractedData.tenant || !extractedData.amount;
    const status = hasMissingRequired ? "exception" : avgConfidence < 0.7 ? "exception" : "needs_review";

    // Insert receipt record
    const { data: receipt, error: insertError } = await supabase
      .from("receipts")
      .insert({
        user_id: userId,
        property: extractedData.property || "",
        unit: extractedData.unit || "",
        tenant: extractedData.tenant || "",
        receipt_date: extractedData.receipt_date || null,
        rent_month: extractedData.rent_month || null,
        amount: extractedData.amount || 0,
        payment_type: extractedData.payment_type || "",
        reference: extractedData.reference || "",
        memo: extractedData.memo || "",
        confidence_scores: {
          property: extractedData.property_confidence || 0,
          unit: extractedData.unit_confidence || 0,
          tenant: extractedData.tenant_confidence || 0,
          amount: extractedData.amount_confidence || 0,
          receiptDate: extractedData.receipt_date_confidence || 0,
          paymentType: extractedData.payment_type_confidence || 0,
        },
        status,
        file_path: filePath,
        file_name: file.name,
        original_text: extractedData.extracted_text || "",
      })
      .select()
      .single();

    if (insertError) throw new Error(`Insert failed: ${insertError.message}`);

    // Audit log
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "receipt_uploaded",
      entity_type: "receipt",
      entity_id: receipt.receipt_id,
      details: { file_name: file.name, status, confidence: avgConfidence },
    });

    return new Response(JSON.stringify({ receipt, extractedData }), {
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
