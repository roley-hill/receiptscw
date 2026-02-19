import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
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

    // ---- FETCH KNOWN TENANTS FOR AI MATCHING ----
    let knownTenantsList = "";
    let tenantLookup: { full_name: string; property_address: string; unit_number: string; status: string }[] = [];
    try {
      const { data: tenants } = await supabase
        .from("appfolio_tenants")
        .select("full_name, property_address, unit_number, status")
        .order("full_name");
      if (tenants && tenants.length > 0) {
        tenantLookup = tenants
          .filter((t: any) => (t.full_name || "").trim().length > 0)
          .map((t: any) => ({
            full_name: t.full_name || "",
            property_address: t.property_address || "",
            unit_number: t.unit_number || "",
            status: t.status || "unknown",
          }));
        knownTenantsList = tenants.map((t: any) => {
          const parts = [t.full_name];
          if (t.property_address) parts.push(`@ ${t.property_address}`);
          if (t.unit_number) parts.push(`Unit ${t.unit_number}`);
          return parts.join(" ");
        }).join("\n");
        console.log(`Loaded ${tenants.length} known tenants for AI matching`);
      }
    } catch (e) {
      console.warn("Could not load tenants for matching:", e);
    }

    // ---- READ FILE & COMPUTE CONTENT HASH ----
    const arrayBuffer = await file.arrayBuffer();
    const fileBytes = new Uint8Array(arrayBuffer);
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const fileContentHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    // ---- FILE-LEVEL DUPLICATE CHECK (by name) ----
    const { data: existingFileReceipts, error: fileCheckError } = await supabase
      .from("receipts")
      .select("id, receipt_id, status")
      .eq("file_name", file.name)
      .limit(1);

    if (!fileCheckError && existingFileReceipts && existingFileReceipts.length > 0) {
      const { count: totalExisting } = await supabase
        .from("receipts")
        .select("id", { count: "exact", head: true })
        .eq("file_name", file.name);

      return new Response(JSON.stringify({
        error: `File "${file.name}" has already been processed (${totalExisting ?? 1} receipt(s) exist). Delete existing records first if you want to re-extract.`,
        already_processed: true,
        existing_count: totalExisting ?? 1,
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- DUPLICATE CONTENT CHECK (same content, different file name) ----
    let duplicateContentFile: string | null = null;
    let duplicateContentCount = 0;
    const { data: existingHashReceipts } = await supabase
      .from("receipts")
      .select("file_name")
      .eq("file_content_hash", fileContentHash)
      .limit(1);

    if (existingHashReceipts && existingHashReceipts.length > 0) {
      duplicateContentFile = existingHashReceipts[0].file_name;
      const { count } = await supabase
        .from("receipts")
        .select("id", { count: "exact", head: true })
        .eq("file_content_hash", fileContentHash);
      duplicateContentCount = count ?? 0;
    }

    // Build storage path
    const filePath = `uploads/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

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

You MUST call the extract_receipts function.${knownTenantsList ? `

KNOWN TENANTS LIST (from property management system):
When you extract a tenant name, try to match it to one of these known tenants. Use the EXACT name from this list when there's a match (even partial — e.g. "M. Valencia" should match "Maria Valencia"). If no match is found, use the name as extracted from the document.

${knownTenantsList}` : ""}`;

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
            const parts = splitByBoundary(eml, boundary);
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
              const nestedParts = splitByBoundary(part, nestedBoundary[1]);
              for (const np of nestedParts) {
                if (!typeRegex.test(np)) continue;
                const decoded = decodePart(np);
                if (decoded) return decoded;
              }
              // Try 3rd level nesting
              for (const np of nestedParts) {
                const nb3 = np.match(/boundary="?([^\s";\r\n]+)"?/i);
                if (!nb3) continue;
                const parts3 = splitByBoundary(np, nb3[1]);
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

        // --- Extract PDF attachment from EML ---
        // Helper: strip leading dashes from boundary values to normalize
        function normalizeBoundary(b: string): string {
          // Some headers include leading -- in the boundary value; strip them for consistency
          return b.replace(/^-+/, "");
        }

        // Helper: split EML by boundary, handling both raw and --prefixed boundaries
        function splitByBoundary(text: string, boundary: string): string[] {
          // Try with -- prefix first (standard MIME)
          const norm = normalizeBoundary(boundary);
          let parts = text.split("--" + norm);
          if (parts.length > 1) return parts;
          // Fallback: try the raw boundary value
          parts = text.split(boundary);
          return parts;
        }

        // Universal attachment extractor: finds any substantial binary attachment
        function extractAnyAttachment(eml: string): { bytes: Uint8Array; mimeType: string; fileName: string } | null {
          const boundaryMatches = [...eml.matchAll(/boundary="?([^\s";\r\n]+)"?/gi)];
          if (boundaryMatches.length === 0) {
            console.log("No MIME boundaries found in EML");
            return null;
          }
          console.log(`Found ${boundaryMatches.length} boundaries: ${boundaryMatches.map(m => m[1].substring(0, 40)).join(", ")}`);

          const seenBoundaries = new Set<string>();

          function tryDecodePart(part: string): { bytes: Uint8Array; mimeType: string; fileName: string } | null {
            const ctMatch = part.match(/content-type:\s*([^\r\n;]+)/i);
            const ct = ctMatch ? ctMatch[1].trim().toLowerCase() : "";
            const fnMatch = part.match(/(?:file)?name="?([^"\r\n;]+)"?/i);
            const fileName = fnMatch ? fnMatch[1].trim() : "";
            const isAttachment = /content-disposition:\s*attachment/i.test(part);
            const hasTransferEncoding = /content-transfer-encoding:\s*base64/i.test(part);

            // Log every part's details
            if (ct) {
              console.log(`  Part: ct=${ct}, fn=${fileName}, attachment=${isAttachment}, base64=${hasTransferEncoding}, len=${part.length}`);
            }

            // Skip text parts and multipart containers
            if (ct.startsWith("text/") || ct.startsWith("multipart/") || !ct) return null;

            // This is a binary attachment - try to decode it
            const bl = part.indexOf("\r\n\r\n");
            const bl2 = part.indexOf("\n\n");
            const bs = bl > 0 ? bl + 4 : (bl2 > 0 ? bl2 + 2 : -1);
            if (bs < 0) return null;
            let b64 = part.substring(bs).trim();
            const trailingBoundary = b64.indexOf("\r\n--");
            if (trailingBoundary > 0) b64 = b64.substring(0, trailingBoundary);
            // Also trim trailing boundary without \r\n
            const trailingBoundary2 = b64.indexOf("\n--");
            if (trailingBoundary2 > 0) b64 = b64.substring(0, trailingBoundary2);
            b64 = b64.replace(/\s/g, "");
            
            console.log(`  Base64 payload: ${b64.length} chars`);
            if (b64.length < 100) return null;

            try {
              const binary = atob(b64);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

              // Detect actual type by magic bytes
              let detectedType = ct;
              if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
                detectedType = "application/pdf";
                console.log(`  Detected PDF by magic bytes (${bytes.length} bytes)`);
              } else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
                detectedType = "image/png";
                console.log(`  Detected PNG by magic bytes (${bytes.length} bytes)`);
              } else if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
                detectedType = "image/jpeg";
                console.log(`  Detected JPEG by magic bytes (${bytes.length} bytes)`);
              } else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
                detectedType = "image/gif";
                console.log(`  Detected GIF by magic bytes (${bytes.length} bytes)`);
              } else {
                console.log(`  Unknown magic bytes: ${bytes[0].toString(16)} ${bytes[1].toString(16)} ${bytes[2].toString(16)} ${bytes[3].toString(16)} (${bytes.length} bytes)`);
              }

              // Skip tiny images (likely inline icons) - but keep PDFs regardless
              if (detectedType.startsWith("image/") && bytes.length < 5000) {
                console.log(`  Skipping tiny image (${bytes.length} bytes)`);
                return null;
              }

              return { bytes, mimeType: detectedType, fileName };
            } catch (e) {
              console.log(`  Base64 decode failed: ${e}`);
              return null;
            }
          }

          function findInParts(parts: string[], depth: number): { bytes: Uint8Array; mimeType: string; fileName: string } | null {
            if (depth > 4) return null;
            console.log(`  Scanning ${parts.length} parts at depth ${depth}`);
            for (const part of parts) {
              const result = tryDecodePart(part);
              if (result) return result;

              // Check for nested boundaries
              const nested = part.match(/boundary="?([^\s";\r\n]+)"?/i);
              if (nested && !seenBoundaries.has(normalizeBoundary(nested[1]))) {
                const norm = normalizeBoundary(nested[1]);
                seenBoundaries.add(norm);
                console.log(`  Descending into nested boundary: ${norm.substring(0, 40)}`);
                const sub = splitByBoundary(part, nested[1]);
                const result2 = findInParts(sub, depth + 1);
                if (result2) return result2;
              }
            }
            return null;
          }

          for (const match of boundaryMatches) {
            const boundary = match[1];
            const norm = normalizeBoundary(boundary);
            if (seenBoundaries.has(norm)) continue;
            seenBoundaries.add(norm);
            console.log(`Trying top-level boundary: ${norm.substring(0, 50)}`);
            const parts = splitByBoundary(eml, boundary);
            const result = findInParts(parts, 0);
            if (result) return result;
          }
          return null;
        }

        // Use the unified attachment extractor
        const anyAttachment = extractAnyAttachment(rawEml);
        const pdfBytes = anyAttachment?.mimeType === "application/pdf" ? anyAttachment.bytes : null;
        const imageAttachment = anyAttachment && anyAttachment.mimeType !== "application/pdf" ? anyAttachment : null;
        console.log("EML attachment found:", !!anyAttachment, anyAttachment ? `(${anyAttachment.bytes.length} bytes, ${anyAttachment.mimeType}, fn=${anyAttachment.fileName})` : "none");

        // Try HTML first, then plain text
        const htmlBody = extractMimePartByType(rawEml, "text/html");
        const plainBody = !htmlBody ? extractMimePartByType(rawEml, "text/plain") : null;
        console.log("EML extraction result - HTML:", !!htmlBody, "Plain:", !!plainBody);

        // If PDF attachment exists, use the PDF image path for AI extraction (much more accurate)
        if (pdfBytes) {
          const pdfBase64 = uint8ToBase64(pdfBytes);
          const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;
          console.log("Using PDF attachment for AI extraction instead of raw EML text");

          const pdfAiResponse = await fetchAIWithRetry("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
                  content: [
                    { type: "text", text: "Extract ALL rent payment line items from this PDF document attached to an email. If it is a remittance detail with multiple tenants/units, extract EACH line item separately. Carefully distinguish between: the property street address, each tenant's personal name, the paying organization/agency, the payment amount per tenant, and the payment method." },
                    { type: "image_url", image_url: { url: pdfDataUrl } },
                  ],
                },
              ],
              tools: [extractMultiReceiptTool],
              tool_choice: { type: "function", function: { name: "extract_receipts" } },
            }),
          }, corsHeaders);

          if (!pdfAiResponse.ok) return pdfAiResponse;

          const pdfAiData = await pdfAiResponse.json();
          const pdfToolCall = pdfAiData.choices?.[0]?.message?.tool_calls?.[0];
          if (pdfToolCall) {
            const parsed = JSON.parse(pdfToolCall.function.arguments);
            extractedItems = parsed.items || [];
          }

          // Upload the PDF for preview and set extractedText
          const pdfPath = `uploads/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}_attachment.pdf`;
          const { error: pdfUploadError } = await supabase.storage
            .from("receipts")
            .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
          if (!pdfUploadError) {
            extractedText = `PDF_ATTACHMENT:${pdfPath}`;
            console.log("Stored PDF attachment at:", pdfPath);
          } else {
            console.error("PDF attachment upload error:", pdfUploadError);
          }

          // Skip the text-based AI extraction below since we already extracted from PDF
          // Jump directly to insert logic by setting textContent to empty
          textContent = "__PDF_EXTRACTED__";
        } else if (imageAttachment) {
          // Check if the "image" is actually a PDF (detected by magic bytes)
          const isActuallyPdf = imageAttachment.mimeType === "application/pdf";
          const attachmentBase64 = uint8ToBase64(imageAttachment.bytes);
          const attachmentDataUrl = `data:${isActuallyPdf ? "application/pdf" : imageAttachment.mimeType};base64,${attachmentBase64}`;
          console.log(`Using ${isActuallyPdf ? "PDF (from image search)" : "image"} attachment for AI extraction`);

          const imgAiResponse = await fetchAIWithRetry("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
                  content: [
                    { type: "text", text: `Extract ALL rent payment line items from this ${isActuallyPdf ? "PDF document" : "image"} attached to an email. If it is a remittance detail with multiple tenants/units, extract EACH line item separately. Carefully distinguish between: the property street address, each tenant's personal name, the paying organization/agency, the payment amount per tenant, and the payment method.` },
                    { type: "image_url", image_url: { url: attachmentDataUrl } },
                  ],
                },
              ],
              tools: [extractMultiReceiptTool],
              tool_choice: { type: "function", function: { name: "extract_receipts" } },
            }),
          }, corsHeaders);

          if (!imgAiResponse.ok) return imgAiResponse;

          const imgAiData = await imgAiResponse.json();
          const imgToolCall = imgAiData.choices?.[0]?.message?.tool_calls?.[0];
          if (imgToolCall) {
            const parsed = JSON.parse(imgToolCall.function.arguments);
            extractedItems = parsed.items || [];
          }

          // Upload the attachment for preview
          if (isActuallyPdf) {
            const pdfPath = `uploads/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}_attachment.pdf`;
            const { error: uploadErr } = await supabase.storage
              .from("receipts")
              .upload(pdfPath, imageAttachment.bytes, { contentType: "application/pdf", upsert: true });
            if (!uploadErr) {
              extractedText = `PDF_ATTACHMENT:${pdfPath}`;
              console.log("Stored PDF (from image search) at:", pdfPath);
            } else {
              console.error("PDF attachment upload error:", uploadErr);
            }
            textContent = "__PDF_EXTRACTED__";
          } else {
            const ext = imageAttachment.mimeType.split("/")[1] || "png";
            const imgPath = `uploads/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}_attachment.${ext}`;
            const { error: imgUploadError } = await supabase.storage
              .from("receipts")
              .upload(imgPath, imageAttachment.bytes, { contentType: imageAttachment.mimeType, upsert: true });
            if (!imgUploadError) {
              extractedText = `IMAGE_ATTACHMENT:${imgPath}`;
              console.log("Stored image attachment at:", imgPath);
            } else {
              console.error("Image attachment upload error:", imgUploadError);
            }
            textContent = "__IMAGE_EXTRACTED__";
          }
        } else {
          // No PDF or image attachment — use clean HTML/text body for AI
          if (htmlBody) {
            textContent = htmlBody.replace(/<style[\s\S]*?<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/&nbsp;/g, " ")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/\s+/g, " ")
              .trim();
          } else if (plainBody) {
            textContent = plainBody;
          } else {
            console.warn("No HTML or plain text body found in EML, using raw EML");
            textContent = rawEml;
          }
          if (textContent.length > 30000) textContent = textContent.substring(0, 30000);
          console.log("EML text content for AI (first 500 chars):", textContent.substring(0, 500));
        }

        // If no PDF/image attachment, handle preview from HTML/text
        if (!extractedText.startsWith("PDF_ATTACHMENT:") && !extractedText.startsWith("IMAGE_ATTACHMENT:")) {
          if (htmlBody) {
            extractedText = htmlBody.substring(0, 80000);
          } else if (plainBody) {
            extractedText = `<html><body><pre style="font-family:Arial,sans-serif;white-space:pre-wrap;padding:20px;">${plainBody.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`;
          } else {
            const headerEnd = rawEml.search(/\r?\n\r?\n/);
            const bodyText = headerEnd > 0 ? rawEml.substring(headerEnd + 2) : rawEml;
            extractedText = `<html><body><pre style="font-family:Arial,sans-serif;white-space:pre-wrap;padding:20px;">${bodyText.substring(0, 50000).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`;
          }
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

      // Only run text-based AI extraction if we haven't already extracted from a PDF attachment
      if (textContent !== "__PDF_EXTRACTED__" && textContent !== "__IMAGE_EXTRACTED__") {
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

    // ---- POST-EXTRACTION TENANT MATCHING (fuzzy safety net) ----
    // When a match is found, ALWAYS use the database values (source of truth)
    // for tenant name, property address, and unit number.

    /** Normalize: lowercase, strip periods, collapse whitespace */
    function norm(s: string): string {
      return s.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
    }

    /** Strip middle names/initials → [first, last] */
    function stripMiddle(name: string): string[] {
      const parts = norm(name).split(" ");
      if (parts.length <= 2) return parts;
      return [parts[0], parts[parts.length - 1]];
    }

    /** Levenshtein distance for typo tolerance */
    function levenshtein(a: string, b: string): number {
      const m = a.length, n = b.length;
      const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
          dp[i][j] = a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      return dp[m][n];
    }

    /** Check if unit numbers match (handles "14646-11" vs "11", "#18" vs "18") */
    function unitsMatch(receiptUnit: string, dbUnit: string): boolean {
      const r = receiptUnit.replace(/^#/, "").trim().toLowerCase();
      const d = dbUnit.replace(/^#/, "").trim().toLowerCase();
      if (r === d) return true;
      if (d.endsWith("-" + r) || d.endsWith(" " + r)) return true;
      if (r.endsWith("-" + d) || r.endsWith(" " + d)) return true;
      const rNum = r.replace(/^0+/, "") || "0";
      const dNum = d.replace(/^0+/, "").replace(/.*[-\s]0*/, "") || "0";
      if (rNum === dNum) return true;
      return false;
    }

    /** Robust fuzzy name matching: middle initials, multi-word surnames, typos */
    function namesMatchFuzzy(extracted: string, known: string): boolean {
      const e = norm(extracted);
      const k = norm(known);
      if (e === k) return true;

      // Substring containment
      if (k.includes(e) || e.includes(k)) return true;

      const eParts = e.split(" ");
      const kParts = k.split(" ");
      const eLast = eParts[eParts.length - 1];
      const kLast = kParts[kParts.length - 1];

      // Last name check with multi-word surname handling ("La Costa" vs "LaCosta")
      const lastDist = levenshtein(eLast, kLast);
      const lastMatch = eLast === kLast || (eLast.length >= 4 && lastDist <= 1);
      const eLastJoined = eParts.length >= 2 ? eParts.slice(-2).join("") : eLast;
      const kLastJoined = kParts.length >= 2 ? kParts.slice(-2).join("") : kLast;
      const lastNameOk = lastMatch || eLastJoined === kLast || eLast === kLastJoined || eLastJoined === kLastJoined;

      if (!lastNameOk) return false;

      // First name check
      const eFirst = eParts[0];
      const kFirst = kParts[0];
      if (eFirst === kFirst) return true;
      // Initial match: "M" matches "Maria"
      if (eFirst.length === 1 && kFirst.startsWith(eFirst)) return true;
      if (kFirst.length === 1 && eFirst.startsWith(kFirst)) return true;
      // Typo tolerance on first name
      if (eFirst.length >= 4 && levenshtein(eFirst, kFirst) <= 2) return true;

      // Compare with middles stripped: "John Smith" vs "John M Smith"
      const ef = stripMiddle(extracted);
      const kf = stripMiddle(known);
      if (ef.length >= 2 && kf.length >= 2 && ef[0] === kf[0]) return true;
      if (ef.length >= 2 && kf.length >= 2 && levenshtein(ef[0], kf[0]) <= 2 && ef[0].length >= 4) return true;

      return false;
    }

    if (tenantLookup.length > 0) {
      for (const item of extractedItems) {
        let match: typeof tenantLookup[0] | undefined;

        // 1. Try matching by tenant name if present
        if (item.tenant) {
          const extracted = item.tenant.toLowerCase().trim();
          // Exact match first
          match = tenantLookup.find(t => t.full_name.toLowerCase() === extracted);
          if (!match) {
            // Fuzzy match: handles middle initials, multi-word surnames, abbreviations, typos
            match = tenantLookup.find(t => namesMatchFuzzy(item.tenant, t.full_name));
          }
        }

        // 2. If no name match, try matching by unit + property
        if (!match && item.unit) {
          const unitMatches = tenantLookup.filter(t =>
            t.unit_number && unitsMatch(item.unit, t.unit_number)
          );
          if (unitMatches.length === 1) {
            match = unitMatches[0];
          } else if (unitMatches.length > 1 && item.property) {
            const propLower = item.property.toLowerCase();
            // Narrow by property — also try first 3 words for partial match
            const propWords = propLower.split(" ").slice(0, 3).join(" ");
            const propMatch = unitMatches.find(t => {
              const dbProp = (t.property_address || "").toLowerCase();
              return dbProp.includes(propLower) || propLower.includes(dbProp) ||
                     dbProp.includes(propWords);
            });
            if (propMatch) match = propMatch;
          }
          // If we matched by unit but name is very different, only accept if name is also fuzzy-similar
          if (match && item.tenant && !namesMatchFuzzy(item.tenant, match.full_name)) {
            // Names are too different — don't auto-fill, let suggestion banner handle it
            console.log(`Unit matched but name mismatch: "${item.tenant}" vs "${match.full_name}" — skipping auto-fill`);
            match = undefined;
          }
        }

        // 3. Apply database values as source of truth when matched
        if (match) {
          console.log(`Tenant matched: "${item.tenant || "(no name)"}" + unit "${item.unit || ""}" -> "${match.full_name}" @ ${match.property_address} Unit ${match.unit_number} [${match.status}]`);
          item.tenant = match.full_name;
          item.tenant_confidence = Math.max(item.tenant_confidence || 0, 0.95);
          item.tenant_status = match.status; // Store AppFolio status for UI display
          item.tenant_verified = true; // Verified against tenant directory
          if (match.property_address) {
            item.property = match.property_address;
            item.property_confidence = Math.max(item.property_confidence || 0, 0.95);
            item.property_verified = true;
          }
          if (match.unit_number) {
            item.unit = match.unit_number;
            item.unit_confidence = Math.max(item.unit_confidence || 0, 0.95);
          }
        } else {
          // No match in tenant directory — use receipt data but flag as unverified
          console.log(`Tenant NOT matched in directory: "${item.tenant || "(no name)"}" — using receipt data, flagging as unverified`);
          item.tenant_verified = false;
          item.property_verified = false;
          // Cap confidence for unverified tenant/property data from receipts
          if ((item.tenant_confidence || 0) > 0.70) item.tenant_confidence = 0.70;
          if ((item.property_confidence || 0) > 0.70) item.property_confidence = 0.70;
        }
      }
    }

    // ---- RENT ROLL CHARGE MATCHING ----
    // Fetch rent roll charges to cross-reference amounts and determine charge types
    let rentRollCharges: { tenant_name: string; property_address: string; unit_number: string | null; charge_type: string; monthly_amount: number; description: string }[] = [];
    try {
      const { data: charges } = await supabase
        .from("rent_roll_charges")
        .select("tenant_name, property_address, unit_number, charge_type, monthly_amount, description");
      if (charges && charges.length > 0) {
        rentRollCharges = charges;
        console.log(`Loaded ${charges.length} rent roll charges for amount cross-referencing`);
      }
    } catch (e) {
      console.warn("Could not load rent roll charges:", e);
    }

    // Cross-reference each extracted item's amount against rent roll
    if (rentRollCharges.length > 0) {
      for (const item of extractedItems) {
        if (!item.amount || item.amount === 0) continue;

        const itemAmount = Math.abs(item.amount);
        const tenantLower = (item.tenant || "").toLowerCase().trim();
        const unitLower = (item.unit || "").replace(/^#|^apt\s*/i, "").trim().toLowerCase();

        // Find matching charges for this tenant/unit
        const matchingCharges = rentRollCharges.filter(c => {
          const cTenant = c.tenant_name.toLowerCase().trim();
          const cUnit = (c.unit_number || "").replace(/^#|^apt\s*/i, "").trim().toLowerCase();

          // Match by tenant name or unit
          const tenantMatch = tenantLower && (cTenant === tenantLower || cTenant.includes(tenantLower) || tenantLower.includes(cTenant));
          const unitMatch = unitLower && cUnit && cUnit === unitLower;

          return tenantMatch || unitMatch;
        });

        if (matchingCharges.length > 0) {
          // Check if amount matches any single charge (tenant charge, subsidy, etc.)
          const exactMatch = matchingCharges.find(c => Math.abs(c.monthly_amount - itemAmount) < 0.01);
          
          // Check if amount matches combined total of multiple charges
          const totalCharges = matchingCharges.reduce((sum, c) => sum + c.monthly_amount, 0);
          const isCombined = Math.abs(totalCharges - itemAmount) < 0.01 && matchingCharges.length > 1;

          // Check if it's a partial match (subsidy portion, tenant portion, etc.)
          const chargeTypes = [...new Set(matchingCharges.map(c => c.charge_type))];

          if (exactMatch) {
            item.charge_type = exactMatch.charge_type === "rent" ? "Tenant Charge" :
              exactMatch.charge_type === "subsidy" ? "Subsidy" :
              exactMatch.charge_type === "utility" ? "Utility" :
              exactMatch.charge_type === "fee" ? "Fee" : "Tenant Charge";
            item.amount_confidence = Math.max(item.amount_confidence || 0, 0.95);
            console.log(`Amount matched rent roll: $${itemAmount} = ${item.charge_type} for "${item.tenant}"`);
          } else if (isCombined) {
            item.charge_type = "Combined";
            item.amount_confidence = Math.max(item.amount_confidence || 0, 0.95);
            console.log(`Amount matched combined rent roll: $${itemAmount} = Combined (${matchingCharges.length} charges) for "${item.tenant}"`);
          } else {
            // Amount doesn't exactly match - might be partial or different period
            // Still tag based on available charge types but don't boost confidence as much
            if (chargeTypes.includes("subsidy") && chargeTypes.includes("rent")) {
              item.charge_type = "Partial";
            } else if (chargeTypes.length === 1) {
              const ct = chargeTypes[0];
              item.charge_type = ct === "rent" ? "Tenant Charge" :
                ct === "subsidy" ? "Subsidy" : ct === "utility" ? "Utility" : "Other";
            }
            // Moderate confidence boost for partial matches
            item.amount_confidence = Math.max(item.amount_confidence || 0, 0.80);
            console.log(`Amount partial match rent roll: $${itemAmount} vs expected charges for "${item.tenant}" (types: ${chargeTypes.join(", ")})`);
          }
          item.amount_verified = true; // Had rent roll data to compare against
        } else {
          // No matching charges in rent roll — use receipt amount but flag as unverified
          console.log(`Amount NOT matched in rent roll for "${item.tenant}" ($${itemAmount}) — using receipt data, flagging as unverified`);
          item.amount_verified = false;
          // Cap confidence for unverified amounts
          if ((item.amount_confidence || 0) > 0.70) item.amount_confidence = 0.70;
        }
      }
    }

    // ---- DUPLICATE DETECTION & INSERT ----
    const insertedReceipts: any[] = [];
    const duplicates: any[] = [];

    for (const item of extractedItems) {
      // Check for duplicates: same tenant + amount + receipt_date + property + unit + rent_month
      if (item.tenant && item.amount && item.receipt_date) {
        let dupQuery = supabase
          .from("receipts")
          .select("id, receipt_id")
          .eq("tenant", item.tenant)
          .eq("amount", item.amount)
          .eq("receipt_date", item.receipt_date)
          .eq("property", item.property || "")
          .eq("unit", item.unit || "");

        // Only match rent_month: if both have a value they must be equal, 
        // if the new item has a rent_month we filter by it
        if (item.rent_month) {
          dupQuery = dupQuery.eq("rent_month", item.rent_month);
        } else {
          dupQuery = dupQuery.is("rent_month", null);
        }

        const { data: existing } = await dupQuery.limit(1);

        if (existing && existing.length > 0) {
          duplicates.push({
            tenant: item.tenant,
            amount: item.amount,
            receipt_date: item.receipt_date,
            existing_receipt_id: existing[0].receipt_id,
          });
          // Store in skipped_duplicates for user review
          await supabase.from("skipped_duplicates").insert({
            user_id: userId,
            tenant: item.tenant || "",
            property: item.property || "",
            unit: item.unit || "",
            amount: item.amount || 0,
            receipt_date: item.receipt_date || null,
            rent_month: item.rent_month || null,
            payment_type: item.payment_type || "",
            reference: item.reference || "",
            memo: item.memo || "",
            file_name: file.name,
            file_path: filePath,
            existing_receipt_id: existing[0].receipt_id,
            existing_receipt_uuid: existing[0].id,
            confidence_scores: {
              property: item.property_confidence || 0,
              unit: item.unit_confidence || 0,
              tenant: item.tenant_confidence || 0,
              amount: item.amount_confidence || 0,
              receiptDate: item.receipt_date_confidence || 0,
              paymentType: item.payment_type_confidence || 0,
            },
          });
          continue; // skip duplicate
        }
      }

      // Also check by file_name + all key fields to catch re-uploads
      if (item.tenant && item.amount && item.receipt_date) {
        let reuploadQuery = supabase
          .from("receipts")
          .select("id, receipt_id")
          .eq("file_name", file.name)
          .eq("tenant", item.tenant)
          .eq("amount", item.amount)
          .eq("receipt_date", item.receipt_date)
          .eq("property", item.property || "")
          .eq("unit", item.unit || "");

        if (item.rent_month) {
          reuploadQuery = reuploadQuery.eq("rent_month", item.rent_month);
        } else {
          reuploadQuery = reuploadQuery.is("rent_month", null);
        }

        const query = reuploadQuery.limit(1);

        const { data: fileExisting } = await query;

        if (fileExisting && fileExisting.length > 0) {
          duplicates.push({
            tenant: item.tenant,
            amount: item.amount,
            receipt_date: item.receipt_date,
            existing_receipt_id: fileExisting[0].receipt_id,
            reason: "same_file_reupload",
          });
          // Store in skipped_duplicates for user review
          await supabase.from("skipped_duplicates").insert({
            user_id: userId,
            tenant: item.tenant || "",
            property: item.property || "",
            unit: item.unit || "",
            amount: item.amount || 0,
            receipt_date: item.receipt_date || null,
            rent_month: item.rent_month || null,
            payment_type: item.payment_type || "",
            reference: item.reference || "",
            memo: item.memo || "",
            file_name: file.name,
            file_path: filePath,
            existing_receipt_id: fileExisting[0].receipt_id,
            existing_receipt_uuid: fileExisting[0].id,
            confidence_scores: {
              property: item.property_confidence || 0,
              unit: item.unit_confidence || 0,
              tenant: item.tenant_confidence || 0,
              amount: item.amount_confidence || 0,
              receiptDate: item.receipt_date_confidence || 0,
              paymentType: item.payment_type_confidence || 0,
            },
          });
          continue;
        }
      }

      // Infer payment_type from reference if not already set or generic
      if (item.reference && (!item.payment_type || item.payment_type === "" || item.payment_type === "other")) {
        const ref = item.reference.toUpperCase();
        if (ref.startsWith("ACH")) item.payment_type = "ACH";
        else if (ref.startsWith("EFT")) item.payment_type = "EFT";
        else if (ref.startsWith("CHK") || ref.startsWith("CHECK")) item.payment_type = "Check";
        else if (ref.startsWith("WIRE")) item.payment_type = "Wire";
        else if (ref.startsWith("MO-") || ref.startsWith("MO ")) item.payment_type = "Money Order";
        else if (ref.startsWith("CASH")) item.payment_type = "Cash";
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
            tenantStatus: item.tenant_status || null,
            chargeType: item.charge_type || null,
            tenantVerified: item.tenant_verified ?? null,
            propertyVerified: item.property_verified ?? null,
            amountVerified: item.amount_verified ?? null,
          },
          status,
          file_path: extractedText.startsWith("PDF_ATTACHMENT:") ? extractedText.replace("PDF_ATTACHMENT:", "") : filePath,
          file_name: file.name,
          file_content_hash: fileContentHash,
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
      ...(duplicateContentFile ? {
        duplicate_content_warning: true,
        duplicate_content_file: duplicateContentFile,
        duplicate_content_count: duplicateContentCount,
        file_content_hash: fileContentHash,
      } : {}),
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
