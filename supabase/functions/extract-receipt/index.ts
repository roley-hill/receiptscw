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

    // Convert file to base64 for AI processing (images)
    let extractedData: any = {};
    
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";

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
              content: `You are a receipt data extraction AI. Extract structured data from rent receipt images. You MUST call the extract_receipt_data function with the extracted fields.`,
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract all rent receipt data from this image. Look for: property/building name, unit number, tenant name, receipt date, rent month, amount paid, payment type (check/cash/ACH/money order), reference/check number, and any memo or remarks." },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_receipt_data",
                description: "Extract structured receipt data from image",
                parameters: {
                  type: "object",
                  properties: {
                    property: { type: "string", description: "Property or building name/address" },
                    property_confidence: { type: "number", description: "Confidence 0-1" },
                    unit: { type: "string", description: "Unit number" },
                    unit_confidence: { type: "number", description: "Confidence 0-1" },
                    tenant: { type: "string", description: "Tenant full name" },
                    tenant_confidence: { type: "number", description: "Confidence 0-1" },
                    receipt_date: { type: "string", description: "Receipt date YYYY-MM-DD" },
                    receipt_date_confidence: { type: "number", description: "Confidence 0-1" },
                    rent_month: { type: "string", description: "Rent month YYYY-MM" },
                    amount: { type: "number", description: "Amount paid" },
                    amount_confidence: { type: "number", description: "Confidence 0-1" },
                    payment_type: { type: "string", description: "Payment method" },
                    payment_type_confidence: { type: "number", description: "Confidence 0-1" },
                    reference: { type: "string", description: "Check/transaction number" },
                    memo: { type: "string", description: "Memo or remarks" },
                    extracted_text: { type: "string", description: "Full text visible in image" },
                  },
                  required: ["property", "tenant", "amount"],
                  additionalProperties: false,
                },
              },
            },
          ],
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
    } else {
      // For PDFs and other files, create a placeholder for now
      extractedData = {
        property: "",
        property_confidence: 0,
        unit: "",
        unit_confidence: 0,
        tenant: "",
        tenant_confidence: 0,
        receipt_date: "",
        receipt_date_confidence: 0,
        amount: 0,
        amount_confidence: 0,
        payment_type: "",
        payment_type_confidence: 0,
        reference: "",
        memo: "",
        extracted_text: `[PDF file: ${file.name}]`,
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
