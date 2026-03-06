import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { toast } from "@/hooks/use-toast";
import { getSignedUrlForFile } from "@/lib/api";
import { highlightExcelRows, highlightPdfLines, type BatchReceipt } from "@/lib/batchHighlighting";


/**
 * Generate enhanced deposit batch PDF report.
 * Includes: building address, gross/net totals, deduction breakdown,
 * subsidy provider info, all receipt detail data.
 */
export function generateBatchPDF(batch: any, receipts: any[]): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  const grossTotal = receipts.filter((r) => Number(r.amount) >= 0).reduce((s, r) => s + Number(r.amount), 0);
  const deductions = receipts.filter((r) => Number(r.amount) < 0).reduce((s, r) => s + Number(r.amount), 0);
  const netTotal = grossTotal + deductions;
  const hasDeductions = deductions < 0;

  // Subsidy breakdown
  const subsidyReceipts = receipts.filter((r) => r.subsidy_provider);
  const subsidyByProvider: Record<string, number> = {};
  for (const r of subsidyReceipts) {
    const provider = r.subsidy_provider || "Unknown";
    subsidyByProvider[provider] = (subsidyByProvider[provider] || 0) + Number(r.amount);
  }

  // ---- HEADER ----
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("Deposit Batch Report", 14, 22);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120);
  doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, 14, 30);

  // ---- PROPERTY / BATCH INFO ----
  doc.setDrawColor(200);
  doc.line(14, 34, pageWidth - 14, 34);

  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  doc.text(`Property: ${batch.property}`, 14, 44);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(60);
  doc.text(`Batch ID: ${batch.batch_id}`, 14, 52);
  doc.text(`Period: ${batch.deposit_period || "—"}`, pageWidth / 2, 52);
  doc.text(`Status: ${batch.status.toUpperCase()}`, 14, 59);
  doc.text(`Receipt Count: ${batch.receipt_count}`, pageWidth / 2, 59);
  doc.text(`Created: ${new Date(batch.created_at).toLocaleDateString()}`, 14, 66);

  if (batch.transferred_at) {
    doc.text(`Transferred: ${new Date(batch.transferred_at).toLocaleDateString()}`, pageWidth / 2, 66);
  }

  // ---- DEPOSIT SUMMARY BOX ----
  let summaryY = 76;
  doc.setFillColor(245, 247, 250);
  doc.roundedRect(14, summaryY - 4, pageWidth - 28, hasDeductions ? 40 : 22, 3, 3, "F");

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);

  if (hasDeductions) {
    doc.text("DEPOSIT TO OPERATING ACCOUNT", 20, summaryY + 4);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Gross Total (Payments):`, 20, summaryY + 14);
    doc.setFont("helvetica", "bold");
    doc.text(`$${grossTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, pageWidth / 2, summaryY + 14);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(180, 40, 40);
    doc.text(`Deductions:`, 20, summaryY + 22);
    doc.setFont("helvetica", "bold");
    doc.text(`$${deductions.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, pageWidth / 2, summaryY + 22);

    doc.setTextColor(0);
    doc.setFontSize(12);
    doc.text(`Net Deposit Amount:`, 20, summaryY + 32);
    doc.text(`$${netTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, pageWidth / 2, summaryY + 32);
    summaryY += 44;
  } else {
    doc.text("DEPOSIT TO OPERATING ACCOUNT", 20, summaryY + 4);
    doc.setFontSize(12);
    doc.text(`$${grossTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, pageWidth / 2, summaryY + 4);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    doc.text("(No deductions — gross equals net)", 20, summaryY + 14);
    summaryY += 26;
  }

  // ---- SUBSIDY PROVIDERS ----
  if (Object.keys(subsidyByProvider).length > 0) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text("Subsidy Providers", 14, summaryY + 4);
    summaryY += 10;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    for (const [provider, amount] of Object.entries(subsidyByProvider)) {
      doc.text(`${provider}: $${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, 20, summaryY + 2);
      summaryY += 7;
    }
    summaryY += 4;
  }

  // ---- TRANSFER INFO ----
  if (batch.transferred_at) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80);
    if (batch.transfer_method) doc.text(`Transfer Method: ${batch.transfer_method}`, 14, summaryY + 2);
    if (batch.external_reference) doc.text(`External Reference: ${batch.external_reference}`, pageWidth / 2, summaryY + 2);
    summaryY += 8;
  }
  if (batch.notes) {
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text(`Notes: ${batch.notes}`, 14, summaryY + 2);
    summaryY += 8;
  }

  // ---- RECEIPT DETAIL TABLE ----
  const tableStartY = summaryY + 6;
  autoTable(doc, {
    startY: tableStartY,
    head: [["Tenant", "Unit", "Amount", "Type", "Subsidy Provider", "Receipt Date", "Reference", "Payment Type", "Receipt ID"]],
    body: receipts.map((r) => [
      r.tenant,
      r.unit,
      `$${Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      Number(r.amount) < 0 ? "DEDUCTION" : "Payment",
      r.subsidy_provider || "—",
      r.receipt_date || "—",
      r.reference || "—",
      r.payment_type || "—",
      r.receipt_id,
    ]),
    foot: [
      ["", "", `Gross: $${grossTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, "", "", "", "", "", ""],
      ...(hasDeductions ? [
        ["", "", `Deductions: $${deductions.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, "", "", "", "", "", ""],
        ["", "", `Net: $${netTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, "", "", "", "", "", `${receipts.length} receipts`],
      ] : [
        ["", "", "", "", "", "", "", "", `${receipts.length} receipts`],
      ]),
    ],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 50, 65] },
    footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: "bold" },
    didParseCell: (data: any) => {
      if (data.section === "body" && data.column.index === 2) {
        const val = data.cell.raw as string;
        if (val.includes("-")) {
          data.cell.styles.textColor = [200, 50, 50];
        }
      }
    },
  });

  // ---- TRANSFER INSTRUCTIONS ----
  const finalY = (doc as any).lastAutoTable?.finalY || tableStartY + 50;
  if (finalY + 30 < doc.internal.pageSize.getHeight()) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text("Transfer Instructions", 14, finalY + 12);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80);
    const depositLabel = hasDeductions
      ? `Please transfer $${netTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })} (net after deductions) to Countywide AppFolio First Century Account for "${batch.property}".`
      : `Please transfer $${grossTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })} to Countywide AppFolio First Century Account for "${batch.property}".`;
    doc.text(depositLabel, 14, finalY + 20);
    if (batch.external_reference) doc.text(`Reference: ${batch.external_reference}`, 14, finalY + 28);
  }

  return doc;
}

/**
 * Generate a GROUPED OWNER PDF report.
 * Shows: owner name header, per-building sections with receipt tables and subtotals,
 * grand total across all buildings, and transfer instructions referencing the entity name.
 */
export function generateGroupedOwnerPDF(
  entityName: string,
  buildingBatches: { batch: any; receipts: any[] }[],
): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  // Grand totals
  const allReceipts = buildingBatches.flatMap(b => b.receipts);
  const grandGross = allReceipts.filter(r => Number(r.amount) >= 0).reduce((s, r) => s + Number(r.amount), 0);
  const grandDeductions = allReceipts.filter(r => Number(r.amount) < 0).reduce((s, r) => s + Number(r.amount), 0);
  const grandNet = grandGross + grandDeductions;
  const hasDeductions = grandDeductions < 0;

  // ---- COVER / HEADER ----
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  doc.text("Grouped Deposit Report", 14, 22);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120);
  doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, 14, 30);

  doc.setDrawColor(200);
  doc.line(14, 34, pageWidth - 14, 34);

  // ---- ENTITY INFO ----
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  doc.text(entityName, 14, 46);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(60);
  doc.text(`${buildingBatches.length} ${buildingBatches.length === 1 ? "property" : "properties"} · ${allReceipts.length} receipts`, 14, 54);

  // ---- GRAND TOTAL SUMMARY BOX ----
  let y = 62;
  doc.setFillColor(235, 240, 248);
  doc.roundedRect(14, y, pageWidth - 28, hasDeductions ? 40 : 24, 3, 3, "F");

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  doc.text("GRAND TOTAL — ALL PROPERTIES", 20, y + 10);

  if (hasDeductions) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Gross:", 20, y + 20);
    doc.setFont("helvetica", "bold");
    doc.text(fmtMoney(grandGross), pageWidth / 2, y + 20);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(180, 40, 40);
    doc.text("Deductions:", 20, y + 28);
    doc.setFont("helvetica", "bold");
    doc.text(fmtMoney(grandDeductions), pageWidth / 2, y + 28);

    doc.setTextColor(0);
    doc.setFontSize(12);
    doc.text("Net Deposit:", 20, y + 36);
    doc.text(fmtMoney(grandNet), pageWidth / 2, y + 36);
    y += 48;
  } else {
    doc.setFontSize(13);
    doc.text(fmtMoney(grandGross), pageWidth / 2, y + 10);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    doc.text("(No deductions)", 20, y + 20);
    y += 30;
  }

  // ---- PER-BUILDING SECTIONS ----
  const sortedBuildings = [...buildingBatches].sort((a, b) => a.batch.property.localeCompare(b.batch.property));

  for (let bi = 0; bi < sortedBuildings.length; bi++) {
    const { batch, receipts } = sortedBuildings[bi];
    const propGross = receipts.filter(r => Number(r.amount) >= 0).reduce((s, r) => s + Number(r.amount), 0);
    const propDeductions = receipts.filter(r => Number(r.amount) < 0).reduce((s, r) => s + Number(r.amount), 0);
    const propNet = propGross + propDeductions;
    const propHasDeductions = propDeductions < 0;

    // Subsidy breakdown for this property
    const subsidyByProvider: Record<string, number> = {};
    for (const r of receipts) {
      if (r.subsidy_provider) {
        subsidyByProvider[r.subsidy_provider] = (subsidyByProvider[r.subsidy_provider] || 0) + Number(r.amount);
      }
    }

    // Check if we need a new page
    if (y + 60 > pageHeight) {
      doc.addPage();
      y = 20;
    }

    // Building header
    doc.setDrawColor(180);
    doc.line(14, y, pageWidth - 14, y);
    y += 8;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text(`${bi + 1}. ${batch.property}`, 14, y);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80);
    const meta = [
      `Batch: ${batch.batch_id}`,
      batch.deposit_period ? `Period: ${batch.deposit_period}` : null,
      `${receipts.length} receipts`,
    ].filter(Boolean).join(" · ");
    doc.text(meta, 14, y + 7);
    y += 12;

    // Property subtotal box
    doc.setFillColor(248, 248, 248);
    doc.roundedRect(14, y, pageWidth - 28, propHasDeductions ? 28 : 16, 2, 2, "F");

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);

    if (propHasDeductions) {
      doc.text(`Gross: ${fmtMoney(propGross)}`, 20, y + 8);
      doc.setTextColor(180, 40, 40);
      doc.text(`Deductions: ${fmtMoney(propDeductions)}`, pageWidth / 2 - 10, y + 8);
      doc.setTextColor(0);
      doc.setFontSize(11);
      doc.text(`Net: ${fmtMoney(propNet)}`, 20, y + 20);
      y += 34;
    } else {
      doc.text(`Subtotal: ${fmtMoney(propGross)}`, 20, y + 10);
      y += 22;
    }

    // Subsidy provider summary
    if (Object.keys(subsidyByProvider).length > 0) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(60);
      doc.text("Subsidy Providers:", 14, y + 2);
      doc.setFont("helvetica", "normal");
      let sx = 80;
      for (const [provider, amount] of Object.entries(subsidyByProvider)) {
        const text = `${provider}: ${fmtMoney(amount)}`;
        doc.text(text, sx, y + 2);
        sx += doc.getTextWidth(text) + 12;
        if (sx > pageWidth - 30) { sx = 20; y += 6; }
      }
      y += 8;
    }

    // Receipt table
    autoTable(doc, {
      startY: y,
      head: [["Tenant", "Unit", "Amount", "Type", "Subsidy", "Date", "Reference", "Receipt ID"]],
      body: receipts.map(r => [
        r.tenant,
        r.unit,
        fmtMoney(Number(r.amount)),
        Number(r.amount) < 0 ? "DEDUCTION" : "Payment",
        r.subsidy_provider || "—",
        r.receipt_date || "—",
        r.reference || "—",
        r.receipt_id,
      ]),
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: [55, 65, 81], fontSize: 7.5 },
      margin: { left: 14, right: 14 },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.column.index === 2) {
          const val = data.cell.raw as string;
          if (val.includes("-")) data.cell.styles.textColor = [200, 50, 50];
        }
      },
    });

    y = (doc as any).lastAutoTable?.finalY || y + 30;
    y += 10;
  }

  // ---- TRANSFER INSTRUCTIONS ----
  if (y + 40 > pageHeight) {
    doc.addPage();
    y = 20;
  }

  doc.setDrawColor(0);
  doc.line(14, y, pageWidth - 14, y);
  y += 10;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  doc.text("Transfer Instructions", 14, y);
  y += 10;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(60);

  const transferAmt = hasDeductions ? grandNet : grandGross;
  const transferLabel = hasDeductions ? "(net after deductions)" : "(total)";

  const lines = doc.splitTextToSize(
    `Please transfer ${fmtMoney(transferAmt)} ${transferLabel} to Countywide AppFolio First Century Account for "${entityName}".`,
    pageWidth - 28,
  );
  doc.text(lines, 14, y);
  y += lines.length * 5 + 6;

  // Per-building breakdown in transfer instructions
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text("Breakdown by property:", 14, y);
  y += 6;

  for (const { batch, receipts } of sortedBuildings) {
    if (y + 6 > pageHeight - 20) { doc.addPage(); y = 20; }
    const propTotal = receipts.reduce((s, r) => s + Number(r.amount), 0);
    doc.text(`• ${batch.property}: ${fmtMoney(propTotal)} (${receipts.length} receipts)`, 20, y);
    y += 5;
  }

  return doc;
}

/**
 * Download a grouped owner PDF report.
 */
export function downloadGroupedOwnerPDF(
  entityName: string,
  buildingBatches: { batch: any; receipts: any[] }[],
) {
  const doc = generateGroupedOwnerPDF(entityName, buildingBatches);
  const safeEntityName = entityName.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-");
  doc.save(`grouped-report-${safeEntityName}-${new Date().toISOString().slice(0, 10)}.pdf`);
  toast({ title: "Grouped PDF downloaded" });
}

/**
 * Download only the PDF report for a batch.
 */
export function downloadBatchPDF(batch: any, receipts: any[]) {
  const doc = generateBatchPDF(batch, receipts);
  doc.save(`batch-report-${batch.batch_id}-${new Date().toISOString().slice(0, 10)}.pdf`);
  toast({ title: "PDF downloaded" });
}

/**
 * Generate XLSX workbook for a batch using ExcelJS (no known CVEs).
 */
export async function generateBatchXLSX(batch: any, receipts: any[]) {
  const grossTotal = receipts.filter((r) => Number(r.amount) >= 0).reduce((s, r) => s + Number(r.amount), 0);
  const deductions = receipts.filter((r) => Number(r.amount) < 0).reduce((s, r) => s + Number(r.amount), 0);
  const netTotal = grossTotal + deductions;

  const wb = new ExcelJS.Workbook();

  // ---- Receipts sheet ----
  const ws = wb.addWorksheet("Receipts");
  ws.columns = [
    { header: "Tenant", key: "tenant", width: 24 },
    { header: "Unit", key: "unit", width: 12 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Type", key: "type", width: 12 },
    { header: "Subsidy Provider", key: "subsidy_provider", width: 22 },
    { header: "Receipt Date", key: "receipt_date", width: 14 },
    { header: "Reference", key: "reference", width: 20 },
    { header: "Payment Type", key: "payment_type", width: 16 },
    { header: "Receipt ID", key: "receipt_id", width: 18 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of receipts) {
    ws.addRow({
      tenant: r.tenant,
      unit: r.unit,
      amount: Number(r.amount),
      type: Number(r.amount) < 0 ? "Deduction" : "Payment",
      subsidy_provider: r.subsidy_provider || "",
      receipt_date: r.receipt_date || "",
      reference: r.reference || "",
      payment_type: r.payment_type || "",
      receipt_id: r.receipt_id,
    });
  }

  // ---- Summary sheet ----
  const ws2 = wb.addWorksheet("Summary");
  ws2.columns = [{ header: "Field", key: "field", width: 28 }, { header: "Value", key: "value", width: 32 }];
  ws2.getRow(1).font = { bold: true };
  const summaryRows = [
    { field: "Property", value: batch.property },
    { field: "Batch ID", value: batch.batch_id },
    { field: "Period", value: batch.deposit_period || "—" },
    { field: "Status", value: batch.status },
    { field: "Gross Total (Payments)", value: grossTotal },
    { field: "Deductions", value: deductions },
    { field: "Net Total", value: netTotal },
    { field: "Receipt Count", value: batch.receipt_count },
    { field: "Created", value: new Date(batch.created_at).toLocaleDateString() },
    { field: "Transferred", value: batch.transferred_at ? new Date(batch.transferred_at).toLocaleDateString() : "—" },
    { field: "Transfer Method", value: batch.transfer_method || "—" },
    { field: "External Reference", value: batch.external_reference || "—" },
    { field: "Notes", value: batch.notes || "" },
  ];
  ws2.addRows(summaryRows);

  // Write to buffer and trigger download
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `batch-report-${batch.batch_id}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  toast({ title: "XLSX downloaded" });
}

/**
 * Generate and download a ZIP package containing:
 * 1. The enhanced PDF report
 * 2. All source receipt documents
 */
export async function downloadBatchZIP(batch: any, receipts: any[]) {
  const zip = new JSZip();

  // 1. Generate PDF report and add to ZIP
  const doc = generateBatchPDF(batch, receipts);
  const pdfBlob = doc.output("blob");
  zip.file(`batch-report-${batch.batch_id}.pdf`, pdfBlob);

  // Build receipt matching data for highlighting
  const batchReceipts: BatchReceipt[] = receipts.map((r) => ({
    tenant: r.tenant,
    unit: r.unit,
    amount: Number(r.amount),
    receipt_date: r.receipt_date,
    reference: r.reference,
    receipt_id: r.receipt_id,
  }));

  // 2. Collect unique source documents from receipts
  const filePaths = new Set<string>();
  for (const r of receipts) {
    if (r.file_path) filePaths.add(r.file_path);
  }

  // 3. Download each source document, highlight matching rows, and add to ZIP
  const docsFolder = zip.folder("source-documents");
  let docCount = 0;
  for (const fp of filePaths) {
    try {
      const signedUrl = await getSignedUrlForFile(fp);
      if (!signedUrl) continue;
      const resp = await fetch(signedUrl);
      if (!resp.ok) continue;
      const blob = await resp.blob();
      const fileName = fp.split("/").pop() || `document-${docCount + 1}`;
      const ext = fileName.toLowerCase().split(".").pop();

      if (ext === "xlsx" || ext === "xls") {
        try {
          const highlighted = await highlightExcelRows(blob, batchReceipts);
          docsFolder?.file(fileName, highlighted);
        } catch (e) {
          console.warn(`Could not highlight Excel: ${fileName}`, e);
          docsFolder?.file(fileName, blob);
        }
      } else if (ext === "pdf") {
        try {
          const highlighted = await highlightPdfLines(blob, batchReceipts);
          docsFolder?.file(fileName, highlighted);
        } catch (e) {
          console.warn(`Could not highlight PDF: ${fileName}`, e);
          docsFolder?.file(fileName, blob);
        }
      } else {
        docsFolder?.file(fileName, blob);
      }
      docCount++;
    } catch (e) {
      console.warn(`Could not fetch document: ${fp}`, e);
    }
  }

  // 4. Generate and download ZIP
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `deposit-package-${batch.batch_id}-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  URL.revokeObjectURL(url);

  toast({
    title: "Deposit package downloaded",
    description: `ZIP includes report + ${docCount} highlighted source document${docCount !== 1 ? "s" : ""}.`,
  });
}

/**
 * Generate a grouped XLSX report for an ownership entity with all properties.
 */
export async function generateGroupedXLSX(
  entityName: string,
  buildingBatches: { batch: any; receipts: any[] }[],
) {
  const allReceipts = buildingBatches.flatMap(b => b.receipts);
  const grandGross = allReceipts.filter(r => Number(r.amount) >= 0).reduce((s, r) => s + Number(r.amount), 0);
  const grandDeductions = allReceipts.filter(r => Number(r.amount) < 0).reduce((s, r) => s + Number(r.amount), 0);
  const grandNet = grandGross + grandDeductions;

  const wb = new ExcelJS.Workbook();

  // Per-property sheets
  for (const { batch, receipts } of buildingBatches) {
    const sheetName = batch.property.slice(0, 31).replace(/[\\/*?[\]:]/g, "");
    const ws = wb.addWorksheet(sheetName);
    ws.columns = [
      { header: "Tenant", key: "tenant", width: 24 },
      { header: "Unit", key: "unit", width: 12 },
      { header: "Amount", key: "amount", width: 14 },
      { header: "Type", key: "type", width: 12 },
      { header: "Subsidy Provider", key: "subsidy_provider", width: 22 },
      { header: "Receipt Date", key: "receipt_date", width: 14 },
      { header: "Reference", key: "reference", width: 20 },
      { header: "Payment Type", key: "payment_type", width: 16 },
      { header: "Receipt ID", key: "receipt_id", width: 18 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of receipts) {
      ws.addRow({
        tenant: r.tenant,
        unit: r.unit,
        amount: Number(r.amount),
        type: Number(r.amount) < 0 ? "Deduction" : "Payment",
        subsidy_provider: r.subsidy_provider || "",
        receipt_date: r.receipt_date || "",
        reference: r.reference || "",
        payment_type: r.payment_type || "",
        receipt_id: r.receipt_id,
      });
    }
  }

  // Summary sheet
  const ws2 = wb.addWorksheet("Summary");
  ws2.columns = [{ header: "Field", key: "field", width: 28 }, { header: "Value", key: "value", width: 32 }];
  ws2.getRow(1).font = { bold: true };
  ws2.addRows([
    { field: "Ownership Entity", value: entityName },
    { field: "Properties", value: buildingBatches.length },
    { field: "Total Receipts", value: allReceipts.length },
    { field: "Gross Total", value: grandGross },
    { field: "Deductions", value: grandDeductions },
    { field: "Net Total", value: grandNet },
  ]);
  for (const { batch, receipts } of buildingBatches) {
    const propTotal = receipts.reduce((s, r) => s + Number(r.amount), 0);
    ws2.addRow({ field: `  ${batch.property}`, value: propTotal });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = entityName.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-");
  a.download = `grouped-report-${safeName}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  toast({ title: "Grouped XLSX downloaded" });
}

/**
 * Download a grouped ZIP package for an ownership entity.
 * Contains: grouped PDF report + all source documents from all properties.
 */
export async function downloadGroupedZIP(
  entityName: string,
  buildingBatches: { batch: any; receipts: any[] }[],
) {
  const zip = new JSZip();

  // 1. Generate grouped PDF report
  const doc = generateGroupedOwnerPDF(entityName, buildingBatches);
  const pdfBlob = doc.output("blob");
  const safeName = entityName.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-");
  zip.file(`grouped-report-${safeName}.pdf`, pdfBlob);

  // 2. Collect all source documents organized by property
  const allReceipts = buildingBatches.flatMap(b => b.receipts);
  const batchReceipts: BatchReceipt[] = allReceipts.map((r) => ({
    tenant: r.tenant,
    unit: r.unit,
    amount: Number(r.amount),
    receipt_date: r.receipt_date,
    reference: r.reference,
    receipt_id: r.receipt_id,
  }));

  const filePaths = new Set<string>();
  for (const r of allReceipts) {
    if (r.file_path) filePaths.add(r.file_path);
  }

  const docsFolder = zip.folder("source-documents");
  let docCount = 0;
  for (const fp of filePaths) {
    try {
      const signedUrl = await getSignedUrlForFile(fp);
      if (!signedUrl) continue;
      const resp = await fetch(signedUrl);
      if (!resp.ok) continue;
      const blob = await resp.blob();
      const fileName = fp.split("/").pop() || `document-${docCount + 1}`;
      const ext = fileName.toLowerCase().split(".").pop();

      if (ext === "xlsx" || ext === "xls") {
        try {
          const highlighted = await highlightExcelRows(blob, batchReceipts);
          docsFolder?.file(fileName, highlighted);
        } catch (e) {
          console.warn(`Could not highlight Excel: ${fileName}`, e);
          docsFolder?.file(fileName, blob);
        }
      } else if (ext === "pdf") {
        try {
          const highlighted = await highlightPdfLines(blob, batchReceipts);
          docsFolder?.file(fileName, highlighted);
        } catch (e) {
          console.warn(`Could not highlight PDF: ${fileName}`, e);
          docsFolder?.file(fileName, blob);
        }
      } else {
        docsFolder?.file(fileName, blob);
      }
      docCount++;
    } catch (e) {
      console.warn(`Could not fetch document: ${fp}`, e);
    }
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `deposit-package-${safeName}-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  URL.revokeObjectURL(url);

  toast({
    title: "Grouped deposit package downloaded",
    description: `ZIP includes grouped report + ${docCount} source document${docCount !== 1 ? "s" : ""}.`,
  });
}
