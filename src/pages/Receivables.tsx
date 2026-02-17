import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchReceipts, markAppfolioRecorded, getFilePreviewUrl, createDepositBatch } from "@/lib/api";
import { motion } from "framer-motion";
import { Download, Mail, Filter, FileText, Layers, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DbReceipt } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Receivables() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: allReceipts = [], isLoading } = useQuery({
    queryKey: ["receipts"],
    queryFn: fetchReceipts,
  });

  const [selectedProperty, setSelectedProperty] = useState<string>("all");
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchProperty, setBatchProperty] = useState("");
  const [depositPeriod, setDepositPeriod] = useState("");

  const finalized = allReceipts.filter((r) => r.status === "finalized");
  const properties = [...new Set(finalized.map((r) => r.property).filter(Boolean))];
  const filtered = selectedProperty === "all" ? finalized : finalized.filter((r) => r.property === selectedProperty);

  const grouped = filtered.reduce((acc, r) => {
    if (!acc[r.property]) acc[r.property] = [];
    acc[r.property].push(r);
    return acc;
  }, {} as Record<string, DbReceipt[]>);

  const grandTotal = filtered.reduce((sum, r) => sum + Number(r.amount), 0);
  const recordedReceipts = filtered.filter((r) => (r as any).appfolio_recorded);
  const recordedTotal = recordedReceipts.reduce((sum, r) => sum + Number(r.amount), 0);

  const toggleMutation = useMutation({
    mutationFn: ({ id, recorded }: { id: string; recorded: boolean }) =>
      markAppfolioRecorded(id, recorded, user!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["receipts"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const batchMutation = useMutation({
    mutationFn: ({ property, ids, period }: { property: string; ids: string[]; period: string }) =>
      createDepositBatch(property, ids, period, user!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      setBatchDialogOpen(false);
      toast({ title: "Deposit batch created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleViewAttachment = async (filePath: string | null) => {
    if (!filePath) return;
    try {
      const url = await getFilePreviewUrl(filePath);
      window.open(url, "_blank");
    } catch {
      toast({ title: "Error", description: "Could not load attachment", variant: "destructive" });
    }
  };

  const openBatchDialog = (property: string) => {
    const propertyRecorded = finalized.filter((r) => r.property === property && (r as any).appfolio_recorded && !r.batch_id);
    if (propertyRecorded.length === 0) {
      toast({ title: "No eligible receipts", description: "Mark receipts as recorded in AppFolio first.", variant: "destructive" });
      return;
    }
    setBatchProperty(property);
    setDepositPeriod("");
    setBatchDialogOpen(true);
  };

  const handleCreateBatch = () => {
    const ids = finalized
      .filter((r) => r.property === batchProperty && (r as any).appfolio_recorded && !r.batch_id)
      .map((r) => r.id);
    if (ids.length === 0) return;
    batchMutation.mutate({ property: batchProperty, ids, period: depositPeriod });
  };

  const downloadCSV = (onlyRecorded: boolean) => {
    const rows = onlyRecorded ? recordedReceipts : filtered;
    if (rows.length === 0) return;
    const headers = ["Property", "Unit", "Tenant", "Receipt Date", "Amount", "Reference", "Receipt ID", "Payment Type", "Transfer Status"];
    const csv = [
      headers.join(","),
      ...rows.map((r) =>
        [r.property, r.unit, r.tenant, r.receipt_date || "", Number(r.amount).toFixed(2), r.reference || "", r.receipt_id, r.payment_type || "", r.transfer_status].join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receivables-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Property Receivables & Deposits</h1>
          <p className="text-sm text-muted-foreground mt-1">Finalized receipts grouped by property. Mark as recorded in AppFolio before batching.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadCSV(true)} disabled={recordedReceipts.length === 0}>
            <Download className="h-4 w-4 mr-2" /> CSV (Recorded)
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadCSV(false)}>
            <Download className="h-4 w-4 mr-2" /> CSV (All)
          </Button>
        </div>
      </div>

      <div className="vault-card p-4 flex items-center gap-4">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select value={selectedProperty} onChange={(e) => setSelectedProperty(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
          <option value="all">All Properties</option>
          {properties.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="vault-card p-8 text-center text-muted-foreground text-sm">No finalized receipts. Review and finalize receipts first.</div>
      ) : (
        Object.entries(grouped).map(([property, receipts]) => {
          const subtotal = receipts.reduce((s, r) => s + Number(r.amount), 0);
          const recorded = receipts.filter((r) => (r as any).appfolio_recorded);
          const recordedAmt = recorded.reduce((s, r) => s + Number(r.amount), 0);
          const unbatched = recorded.filter((r) => !r.batch_id);
          return (
            <motion.div key={property} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="vault-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">{property}</h3>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-muted-foreground">{recorded.length}/{receipts.length} recorded</span>
                  <span className="vault-mono font-bold text-foreground">${subtotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                  <Button variant="default" size="sm" onClick={() => openBatchDialog(property)} disabled={unbatched.length === 0}>
                    <Layers className="h-3.5 w-3.5 mr-1" /> Create Batch ({unbatched.length})
                  </Button>
                </div>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-10">Recorded</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unit</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tenant</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt Date</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reference</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt ID</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transfer</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Attachment</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.sort((a, b) => (a.unit || "").localeCompare(b.unit || "")).map((r) => (
                    <tr key={r.id} className="vault-table-row">
                      <td className="px-4 py-2.5">
                        <Checkbox
                          checked={(r as any).appfolio_recorded || false}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: r.id, recorded: !!checked })}
                          disabled={toggleMutation.isPending}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-sm vault-mono text-foreground">{r.unit}</td>
                      <td className="px-4 py-2.5 text-sm font-medium text-foreground">{r.tenant}</td>
                      <td className="px-4 py-2.5 text-sm vault-mono text-muted-foreground">{r.receipt_date || "—"}</td>
                      <td className="px-4 py-2.5 text-sm text-right vault-mono font-semibold text-foreground">${Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-2.5 text-sm vault-mono text-muted-foreground">{r.reference || "—"}</td>
                      <td className="px-4 py-2.5 text-xs vault-mono text-vault-blue">{r.receipt_id}</td>
                      <td className="px-4 py-2.5">{r.transfer_status === "transferred" ? <span className="vault-badge-success">Transferred</span> : <span className="vault-badge-neutral">Pending</span>}</td>
                      <td className="px-4 py-2.5 text-center">
                        {r.file_path ? (
                          <Button variant="ghost" size="sm" onClick={() => handleViewAttachment(r.file_path)} title="View source document">
                            <FileText className="h-4 w-4 text-vault-blue" />
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-3 border-t border-border bg-muted/20 flex items-center justify-between text-xs">
                <div className="flex gap-6">
                  <span className="text-muted-foreground">Recorded: <span className="vault-mono font-medium text-foreground">${recordedAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></span>
                  <span className="text-muted-foreground">Unrecorded: <span className="vault-mono font-medium text-foreground">${(subtotal - recordedAmt).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></span>
                </div>
              </div>
            </motion.div>
          );
        })
      )}

      {grandTotal > 0 && (
        <div className="vault-card px-4 py-4 flex items-center justify-between">
          <span className="text-sm font-bold text-foreground">Grand Total</span>
          <div className="flex items-center gap-6">
            <span className="text-sm text-muted-foreground">{recordedReceipts.length}/{filtered.length} recorded</span>
            <span className="text-sm text-muted-foreground">Recorded: <span className="vault-mono font-bold text-foreground">${recordedTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></span>
            <span className="text-lg vault-mono font-bold text-foreground">${grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      )}

      <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Deposit Batch — {batchProperty}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This will batch {finalized.filter((r) => r.property === batchProperty && (r as any).appfolio_recorded && !r.batch_id).length} recorded, unbatched receipts for <strong>{batchProperty}</strong>.
            </p>
            <div>
              <Label htmlFor="depositPeriod">Deposit Period</Label>
              <Input id="depositPeriod" placeholder="e.g. Feb 2026" value={depositPeriod} onChange={(e) => setDepositPeriod(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateBatch} disabled={batchMutation.isPending}>
              <Layers className="h-4 w-4 mr-2" /> Create Batch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
