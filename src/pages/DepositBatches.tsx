import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchBatches, fetchReceipts, reverseBatch } from "@/lib/api";
import { downloadBatchPDF, generateBatchXLSX, downloadBatchZIP } from "@/lib/batchReports";
import { motion } from "framer-motion";
import { Layers, Download, Mail, CheckCircle2, Clock, FileSpreadsheet, FileText as FileTextIcon, Undo2, PackageOpen, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useState, lazy, Suspense } from "react";

const BatchDocumentPreview = lazy(() => import("@/components/BatchDocumentPreview"));

export default function DepositBatches() {
  const queryClient = useQueryClient();
  const { data: batches = [], isLoading } = useQuery({ queryKey: ["batches"], queryFn: fetchBatches });
  const { data: allReceipts = [] } = useQuery({ queryKey: ["receipts"], queryFn: fetchReceipts });
  const [downloadingZip, setDownloadingZip] = useState<string | null>(null);
  const [previewBatchId, setPreviewBatchId] = useState<string | null>(null);

  const reverseMutation = useMutation({
    mutationFn: (batchId: string) => reverseBatch(batchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      toast({ title: "Batch reversed", description: "Receipts have been unlinked and are available for re-batching." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleZipDownload = async (batch: any, receipts: any[]) => {
    setDownloadingZip(batch.id);
    try {
      await downloadBatchZIP(batch, receipts);
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "ZIP download failed", variant: "destructive" });
    } finally {
      setDownloadingZip(null);
    }
  };

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
            const grossTotal = receipts.filter((r) => Number(r.amount) >= 0).reduce((s, r) => s + Number(r.amount), 0);
            const deductionTotal = receipts.filter((r) => Number(r.amount) < 0).reduce((s, r) => s + Number(r.amount), 0);
            const netTotal = grossTotal + deductionTotal;
            const hasDeductions = deductionTotal < 0;
            const isZipping = downloadingZip === batch.id;
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
                      {hasDeductions ? (
                        <div className="space-y-0.5">
                          <p className="text-xs text-muted-foreground">Gross: <span className="vault-mono font-medium text-foreground">${grossTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></p>
                          <p className="text-xs text-muted-foreground">Deductions: <span className="vault-mono font-medium text-[hsl(var(--vault-red))]">${deductionTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></p>
                          <p className="text-sm vault-mono font-bold text-foreground">Net: ${netTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                        </div>
                      ) : (
                        <p className="text-lg vault-mono font-bold text-foreground">${Number(batch.total_amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                      )}
                      <BatchStatusBadge status={batch.status} />
                    </div>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" onClick={() => setPreviewBatchId(batch.id)} title="Preview all documents">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleZipDownload(batch, receipts)} disabled={isZipping} title="Download deposit package (ZIP)">
                        {isZipping ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <PackageOpen className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => downloadBatchPDF(batch, receipts)} title="Download PDF report">
                        <FileTextIcon className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => generateBatchXLSX(batch, receipts)} title="Download XLSX report">
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="outline" size="sm" title="Email report">
                        <Mail className="h-3.5 w-3.5" />
                      </Button>
                      {batch.status !== "reversed" && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" title="Reverse batch" className="text-destructive hover:text-destructive">
                              <Undo2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Reverse Batch {batch.batch_id}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will unlink all {batch.receipt_count} receipt{batch.receipt_count !== 1 ? "s" : ""} from this batch, making them available for re-batching. The batch will be marked as reversed.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => reverseMutation.mutate(batch.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Reverse Batch
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
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
                          <th className="px-5 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type</th>
                          <th className="px-5 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subsidy</th>
                          <th className="px-5 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {receipts.map((r) => (
                          <tr key={r.id} className="vault-table-row">
                            <td className="px-5 py-2.5 text-sm font-medium text-foreground">{r.tenant}</td>
                            <td className="px-5 py-2.5 text-sm vault-mono text-muted-foreground">{r.unit}</td>
                            <td className={`px-5 py-2.5 text-sm text-right vault-mono font-semibold ${Number(r.amount) < 0 ? "text-[hsl(var(--vault-red))]" : "text-foreground"}`}>${Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                            <td className="px-5 py-2.5">{Number(r.amount) < 0 ? <span className="vault-badge-deduction">Deduction</span> : <span className="text-xs text-muted-foreground">Payment</span>}</td>
                            <td className="px-5 py-2.5 text-xs text-muted-foreground">{r.subsidy_provider || "—"}</td>
                            <td className="px-5 py-2.5 text-xs vault-mono text-vault-blue">{r.receipt_id}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {hasDeductions && (
                      <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-end gap-6 text-xs">
                        <span className="text-muted-foreground">Gross: <span className="vault-mono font-medium text-foreground">${grossTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></span>
                        <span className="text-muted-foreground">Deductions: <span className="vault-mono font-medium text-[hsl(var(--vault-red))]">${deductionTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></span>
                        <span className="text-muted-foreground">Net: <span className="vault-mono font-bold text-foreground">${netTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></span>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
      {previewBatchId && (
        <Suspense fallback={null}>
          <BatchDocumentPreview
            receipts={allReceipts.filter((r) => r.batch_id === previewBatchId)}
            batch={batches.find((b) => b.id === previewBatchId)}
            onClose={() => setPreviewBatchId(null)}
          />
        </Suspense>
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
