import ExcelJS from "exceljs";
import * as pdfjsLib from "pdfjs-dist";
import { PDFDocument, rgb } from "pdf-lib";

// ── Helpers ──────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractLastName(fullName: string): string {
  const name = normalizeName(fullName);
  if (name.includes(",")) return name.split(",")[0].trim();
  const parts = name.split(" ");
  return parts[parts.length - 1] || name;
}

function parseAmount(val: unknown): number | null {
  if (val == null) return null;
  let s = String(val).trim();
  const negative = s.includes("(");
  s = s.replace(/[$(),]/g, "").trim();
  if (!s) return null;
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return negative ? -n : n;
}

function parseDateFromCell(val: unknown): Date | null {
  if (val instanceof Date) return val;
  if (val == null) return null;
  const s = String(val).trim();
  // Try MM/DD/YYYY, MM/DD/YY, YYYY-MM-DD
  for (const fmt of [
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/,
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
  ]) {
    const m = s.match(fmt);
    if (m) {
      if (fmt === /^(\d{4})-(\d{1,2})-(\d{1,2})$/) {
        return new Date(+m[1], +m[2] - 1, +m[3]);
      }
      let yr = +m[3];
      if (yr < 100) yr += 2000;
      return new Date(yr, +m[1] - 1, +m[2]);
    }
  }
  // Try Date.parse as fallback
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86400000));
}

// ── Receipt matching types ───────────────────────────────────

export interface BatchReceipt {
  tenant: string;
  unit: string;
  amount: number;
  receipt_date: string | null;
  reference: string | null;
  receipt_id: string;
}

// ── Excel Highlighting ───────────────────────────────────────

/**
 * Reads an Excel file blob, highlights rows matching batch receipts
 * with a yellow background fill, and returns the modified file as a Uint8Array.
 */
export async function highlightExcelRows(
  fileBlob: Blob,
  receipts: BatchReceipt[]
): Promise<Uint8Array> {
  const buffer = await fileBlob.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = wb.worksheets[0];
  if (!ws) {
    return new Uint8Array(buffer);
  }

  // Find header columns
  const headerRow = ws.getRow(1);
  let tenantCol = -1;
  let amountCol = -1;
  let dateCol = -1;
  let checkCol = -1;
  let notesCol = -1;

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const h = String(cell.value ?? "").toLowerCase().trim();
    if (tenantCol === -1 && (h.includes("tenant name") || h === "name" || (h.includes("tenant") && !h.includes("code")))) {
      tenantCol = colNumber;
    }
    if (amountCol === -1 && h.includes("amount")) {
      amountCol = colNumber;
    }
    if (dateCol === -1 && (h.includes("date") || h.includes("check date"))) {
      dateCol = colNumber;
    }
    if (checkCol === -1 && (h.includes("eft") || h.includes("check#") || h.includes("check #") || h === "reference")) {
      checkCol = colNumber;
    }
    if (notesCol === -1 && (h.includes("note") || h.includes("memo") || h.includes("description"))) {
      notesCol = colNumber;
    }
  });

  if (tenantCol === -1 || amountCol === -1) {
    // Can't identify columns, return unchanged
    const out = await wb.xlsx.writeBuffer();
    return new Uint8Array(out as ArrayBuffer);
  }

  // Score-based matching: each receipt finds its best matching row
  const usedRows = new Set<number>();
  const rowsToHighlight = new Set<number>();

  for (const receipt of receipts) {
    const rLast = extractLastName(receipt.tenant);
    const rAmt = receipt.amount;
    const rDate = receipt.receipt_date ? new Date(receipt.receipt_date) : null;
    const rRef = receipt.reference || "";

    let bestRow = -1;
    let bestScore = -1;

    for (let rowIdx = 2; rowIdx <= ws.rowCount; rowIdx++) {
      if (usedRows.has(rowIdx)) continue;

      const tenantVal = ws.getCell(rowIdx, tenantCol).value;
      if (!tenantVal) continue;

      const xlName = normalizeName(String(tenantVal));
      if (!xlName.includes(rLast)) continue;

      const xlAmt = parseAmount(ws.getCell(rowIdx, amountCol).value);
      if (xlAmt === null || Math.abs(xlAmt - rAmt) > 0.01) continue;

      let score = 0;

      // Reference match (strong signal)
      if (rRef && rRef !== "—" && checkCol > 0) {
        const checkVal = String(ws.getCell(rowIdx, checkCol).value ?? "");
        if (checkVal && (rRef.includes(checkVal) || checkVal.includes(rRef))) {
          score += 100;
        }
      }

      // Date proximity
      if (dateCol > 0 && rDate) {
        const xlDate = parseDateFromCell(ws.getCell(rowIdx, dateCol).value);
        if (xlDate) {
          const diff = daysBetween(rDate, xlDate);
          if (diff <= 5) score += 50;
          else if (diff <= 15) score += 20;
          else if (diff <= 35) score += 5;
          else continue; // too far
        }
      }

      // Notes matching receipt period
      if (notesCol > 0 && rDate) {
        const notesStr = String(ws.getCell(rowIdx, notesCol).value ?? "").toLowerCase();
        const month = String(rDate.getMonth() + 1).padStart(2, "0");
        const yearShort = String(rDate.getFullYear()).slice(-2);
        if (notesStr.includes(`${month}/${yearShort}`)) {
          score += 30;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestRow = rowIdx;
      }
    }

    if (bestRow > 0) {
      usedRows.add(bestRow);
      rowsToHighlight.add(bestRow);
    }
  }

  // Apply yellow highlight fill
  const yellowFill: ExcelJS.FillPattern = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFFF00" },
  };

  for (const rowIdx of rowsToHighlight) {
    const row = ws.getRow(rowIdx);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = yellowFill;
    });
    // Also fill any cells in the column range that eachCell might skip
    for (let c = 1; c <= ws.columnCount; c++) {
      ws.getCell(rowIdx, c).fill = yellowFill;
    }
  }

  const outBuffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(outBuffer as ArrayBuffer);
}

// ── PDF Highlighting ─────────────────────────────────────────

/**
 * Reads a PDF blob, finds lines matching batch receipts by name+amount,
 * and adds yellow highlight annotations. Returns modified PDF as Uint8Array.
 */
export async function highlightPdfLines(
  fileBlob: Blob,
  receipts: BatchReceipt[]
): Promise<Uint8Array> {
  const buffer = await fileBlob.arrayBuffer();
  const uint8 = new Uint8Array(buffer);

  // Use pdfjs-dist to extract text with positions
  const loadingTask = pdfjsLib.getDocument({ data: uint8 });
  const pdfDoc = await loadingTask.promise;

  // Use pdf-lib to add annotations
  const pdfLibDoc = await PDFDocument.load(uint8, { ignoreEncryption: true });

  for (let pageIdx = 0; pageIdx < pdfDoc.numPages; pageIdx++) {
    const page = await pdfDoc.getPage(pageIdx + 1);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const pageHeight = viewport.height;
    const pageWidth = viewport.width;

    // Group text items by approximate y-position (line grouping)
    const lines: { y: number; text: string; minX: number; maxX: number; height: number }[] = [];

    for (const item of textContent.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const tx = item.transform;
      const y = tx[5]; // y position in PDF coords (bottom-up)
      const x = tx[4];
      const w = item.width || 0;
      const h = item.height || 10;

      // Find or create a line at this y
      let line = lines.find((l) => Math.abs(l.y - y) < 5);
      if (!line) {
        line = { y, text: "", minX: x, maxX: x + w, height: h };
        lines.push(line);
      }
      line.text += " " + item.str;
      line.minX = Math.min(line.minX, x);
      line.maxX = Math.max(line.maxX, x + w);
      line.height = Math.max(line.height, h);
    }

    // Check each line for receipt matches
    const pdfLibPage = pdfLibDoc.getPage(pageIdx);
    const { height: pdfLibHeight, width: pdfLibWidth } = pdfLibPage.getSize();

    // Scale factor between pdfjs viewport and pdf-lib page
    const scaleY = pdfLibHeight / pageHeight;
    const scaleX = pdfLibWidth / pageWidth;

    const highlightedYs = new Set<number>();

    for (const receipt of receipts) {
      const amtStr = Math.abs(receipt.amount).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      // Check each line for name + amount match
      for (const line of lines) {
        const roundedY = Math.round(line.y);
        if (highlightedYs.has(roundedY)) continue;

        const lineText = line.text.toLowerCase();
        const nameParts = normalizeName(receipt.tenant).split(" ");
        const nameFound = nameParts.some((p) => p.length >= 3 && lineText.includes(p));
        const amountFound = line.text.includes(amtStr);

        if (nameFound && amountFound) {
          highlightedYs.add(roundedY);

          // Draw a yellow highlight rectangle behind the line
          const rectY = line.y * scaleY - 2;
          const rectH = line.height * scaleY + 4;

          pdfLibPage.drawRectangle({
            x: 10,
            y: rectY,
            width: pdfLibWidth - 20,
            height: rectH,
            color: rgb(1, 1, 0),
            opacity: 0.3,
          });
          break; // one highlight per receipt per page
        }
      }
    }
  }

  const modifiedBytes = await pdfLibDoc.save();
  return modifiedBytes;
}

/**
 * Check if a PDF source document is relevant to the batch receipts.
 * Returns true if at least one receipt's name+amount appears in the PDF text.
 */
export async function pdfIsRelevant(
  fileBlob: Blob,
  receipts: BatchReceipt[]
): Promise<boolean> {
  try {
    const buffer = await fileBlob.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdfDoc = await loadingTask.promise;

    let allText = "";
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      allText += content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
    }

    const textLower = allText.toLowerCase();

    for (const receipt of receipts) {
      const amtStr = Math.abs(receipt.amount).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      if (!allText.includes(amtStr)) continue;

      const nameParts = normalizeName(receipt.tenant).split(" ");
      const nameFound = nameParts.some((p) => p.length >= 3 && textLower.includes(p));
      if (nameFound) return true;
    }
    return false;
  } catch {
    return true; // benefit of doubt on error
  }
}
