import { useQuery } from "@tanstack/react-query";
import { fetchBatches, fetchReceipts } from "@/lib/api";
import { motion } from "framer-motion";
import { Layers, Download, Mail, CheckCircle2, Clock, FileSpreadsheet, FileText as FileTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

function generateBatchPDF(batch: any, receipts: any[]) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(18);
  doc.text("Deposit Batch Report", 14, 20);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 28);

  // Batch info
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text(`Property: ${batch.property}`, 14, 40);
  doc.text(`Batch ID: ${batch.batch_id}`, 14, 48);
  doc.text(`Period: ${batch.deposit_period || "—"}`, 14, 56);
  doc.text(`Status: ${batch.status}`, 14, 64);
  doc.text(`Total Amount: $${Number(batch.total_amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, 14, 72);
  doc.text(`Receipt Count: ${batch.receipt_count}`, pageWidth / 2, 72);

  if (batch.transferred_at) {
    doc.text(`Transferred: ${new Date(batch.transferred_at).toLocaleDateString()}`, 14, 80);
    if (batch.transfer_method) doc.text(`Method: ${batch.transfer_method}`, pageWidth / 2, 80);
  }

  // Receipt table
  const startY = batch.transferred_at ? 90 : 82;
  autoTable(doc, {
    startY,
    head: [["Tenant", "Unit", "Amount", "Receipt Date", "Reference", "Receipt ID"]],
    body: receipts.map((r) => [
      r.tenant,
      r.unit,
      `$${Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      r.receipt_date || "—",
      r.reference || "—",
      r.receipt_id,
    ]),
    foot: [["", "", `$${receipts.reduce((s, r) => s + Number(r.amount), 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, "", "", `${receipts.length} receipts`]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [41, 50, 65] },
    footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: "bold" },
  });

  // Transfer instructions
  const finalY = (doc as any).lastAutoTable?.finalY || startY + 50;
  if (finalY + 40 < doc.internal.pageSize.getHeight()) {
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text("Transfer Instructions", 14, finalY + 15);
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text(`Please transfer $${Number(batch.total_amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} for property "${batch.property}".`, 14, finalY + 24);
    if (batch.external_reference) doc.text(`Reference: ${batch.external_reference}`, 14, finalY + 32);
    if (batch.notes) doc.text(`Notes: ${batch.notes}`, 14, finalY + 40);
  }

  doc.save(`batch-report-${batch.batch_id}-${new Date().toISOString().slice(0, 10)}.pdf`);
  toast({ title: "PDF downloaded" });
}

function generateBatchXLSX(batch: any, receipts: any[]) {
  const wb = XLSX.utils.book_new();

  // Detail sheet
  const detailData = receipts.map((r) => ({
    Tenant: r.tenant,
    Unit: r.unit,
    Amount: Number(r.amount),
    "Receipt Date": r.receipt_date || "",
    Reference: r.reference || "",
    "Receipt ID": r.receipt_id,
    "Payment Type": r.payment_type || "",
  }));
  const ws = XLSX.utils.json_to_sheet(detailData);
  XLSX.utils.book_append_sheet(wb, ws, "Receipts");

  // Summary sheet
  const summaryData = [
    { Field: "Property", Value: batch.property },
    { Field: "Batch ID", Value: batch.batch_id },
    { Field: "Period", Value: batch.deposit_period || "—" },
    { Field: "Status", Value: batch.status },
    { Field: "Total Amount", Value: Number(batch.total_amount) },
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

export default function DepositBatches() {
  const { data: batches = [], isLoading } = useQuery({ queryKey: ["batches"], queryFn: fetchBatches });
  const { data: allReceipts = [] } = useQuery({ queryKey: ["receipts"], queryFn: fetchReceipts });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Deposit Batches</h1>
          <p className="text-sm text-muted-foreground mt-1">Group receipts into one transfer per property. Download reports for your accountant.</p>
        </div>
        <Button variant="default" size="sm"><Layers className="h-4 w-4 mr-2" />Create Batch</Button>
      </div>

      {batches.length === 0 ? (
        <div className="vault-card p-8 text-center text-muted-foreground text-sm">No deposit batches yet. Create one from the Entry & Recording page.</div>
      ) : (
        <div className="space-y-4">
          {batches.map((batch, i) => {
            const receipts = allReceipts.filter((r) => r.batch_id === batch.id);
            return (
              <motion.div key={batch.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="vault-card overflow-hidden">
                <div className="px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${batch.status === "transferred" ? "bg-vault-emerald-light" : "bg-vault-blue-light"}`}>
                      {batch.status === "transferred" ? <CheckCircle2 className="h-5 w-5 text-vault-emerald" /> : <Clock className="h-5 w-5 text-vault-blue" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-foreground">{batch.property}</h3>
                        <span className="vault-mono text-xs text-muted-foreground">{batch.batch_id}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {batch.deposit_period || "—"} · {batch.receipt_count} receipt{batch.receipt_count !== 1 ? "s" : ""} · Created {new Date(batch.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-lg vault-mono font-bold text-foreground">${Number(batch.total_amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                      <BatchStatusBadge status={batch.status} />
                    </div>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" onClick={() => generateBatchPDF(batch, receipts)} title="Download PDF report">
                        <FileTextIcon className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => generateBatchXLSX(batch, receipts)} title="Download XLSX report">
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="outline" size="sm" title="Email report">
                        <Mail className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
                {batch.status === "transferred" && batch.transferred_at && (
                  <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center gap-6 text-xs text-muted-foreground">
                    <span>Transferred: <span className="font-medium text-foreground">{new Date(batch.transferred_at).toLocaleDateString()}</span></span>
                    {batch.transfer_method && <span>Method: <span className="font-medium text-foreground">{batch.transfer_method}</span></span>}
                    {batch.external_reference && <span>Ref: <span className="vault-mono font-medium text-foreground">{batch.external_reference}</span></span>}
                  </div>
                )}
                {receipts.length > 0 && (
                  <div className="border-t border-border">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-muted/30">
                          <th className="px-5 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tenant</th>
                          <th className="px-5 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unit</th>
                          <th className="px-5 py-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                          <th className="px-5 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {receipts.map((r) => (
                          <tr key={r.id} className="vault-table-row">
                            <td className="px-5 py-2.5 text-sm font-medium text-foreground">{r.tenant}</td>
                            <td className="px-5 py-2.5 text-sm vault-mono text-muted-foreground">{r.unit}</td>
                            <td className="px-5 py-2.5 text-sm text-right vault-mono font-semibold text-foreground">${Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                            <td className="px-5 py-2.5 text-xs vault-mono text-vault-blue">{r.receipt_id}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BatchStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "transferred": return <span className="vault-badge-success">Transferred</span>;
    case "ready": return <span className="vault-badge-info">Ready</span>;
    case "draft": return <span className="vault-badge-neutral">Draft</span>;
    case "reversed": return <span className="vault-badge-error">Reversed</span>;
    default: return <span className="vault-badge-neutral">{status}</span>;
  }
}
