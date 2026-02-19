import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { toast } from "@/hooks/use-toast";
import { getSignedUrlForFile } from "@/lib/api";

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
      ? `Please transfer $${netTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })} (net after deductions) to the operating account for "${batch.property}".`
      : `Please transfer $${grossTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })} to the operating account for "${batch.property}".`;
    doc.text(depositLabel, 14, finalY + 20);
    if (batch.external_reference) doc.text(`Reference: ${batch.external_reference}`, 14, finalY + 28);
  }

  return doc;
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
 * Generate XLSX workbook for a batch.
 */
export function generateBatchXLSX(batch: any, receipts: any[]) {
  const grossTotal = receipts.filter((r) => Number(r.amount) >= 0).reduce((s, r) => s + Number(r.amount), 0);
  const deductions = receipts.filter((r) => Number(r.amount) < 0).reduce((s, r) => s + Number(r.amount), 0);
  const netTotal = grossTotal + deductions;

  const wb = XLSX.utils.book_new();

  const detailData = receipts.map((r: any) => ({
    Tenant: r.tenant,
    Unit: r.unit,
    Amount: Number(r.amount),
    Type: Number(r.amount) < 0 ? "Deduction" : "Payment",
    "Subsidy Provider": r.subsidy_provider || "",
    "Receipt Date": r.receipt_date || "",
    Reference: r.reference || "",
    "Payment Type": r.payment_type || "",
    "Receipt ID": r.receipt_id,
  }));
  const ws = XLSX.utils.json_to_sheet(detailData);
  XLSX.utils.book_append_sheet(wb, ws, "Receipts");

  const summaryData = [
    { Field: "Property", Value: batch.property },
    { Field: "Batch ID", Value: batch.batch_id },
    { Field: "Period", Value: batch.deposit_period || "—" },
    { Field: "Status", Value: batch.status },
    { Field: "Gross Total (Payments)", Value: grossTotal },
    { Field: "Deductions", Value: deductions },
    { Field: "Net Total", Value: netTotal },
    { Field: "Receipt Count", Value: batch.receipt_count },
    { Field: "Created", Value: new Date(batch.created_at).toLocaleDateString() },
    { Field: "Transferred", Value: batch.transferred_at ? new Date(batch.transferred_at).toLocaleDateString() : "—" },
    { Field: "Transfer Method", Value: batch.transfer_method || "—" },
    { Field: "External Reference", Value: batch.external_reference || "—" },
    { Field: "Notes", Value: batch.notes || "" },
  ];
  const ws2 = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, ws2, "Summary");

  XLSX.writeFile(wb, `batch-report-${batch.batch_id}-${new Date().toISOString().slice(0, 10)}.xlsx`);
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

  // 2. Collect unique source documents from receipts
  const filePaths = new Set<string>();
  for (const r of receipts) {
    if (r.file_path) filePaths.add(r.file_path);
  }

  // 3. Download each source document and add to ZIP
  const docsFolder = zip.folder("source-documents");
  let docCount = 0;
  for (const fp of filePaths) {
    try {
      const signedUrl = await getSignedUrlForFile(fp);
      if (!signedUrl) continue;
      const resp = await fetch(signedUrl);
      if (!resp.ok) continue;
      const blob = await resp.blob();
      // Extract filename from path
      const fileName = fp.split("/").pop() || `document-${docCount + 1}`;
      docsFolder?.file(fileName, blob);
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
    description: `ZIP includes report + ${docCount} source document${docCount !== 1 ? "s" : ""}.`,
  });
}
