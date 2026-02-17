import { useQuery } from "@tanstack/react-query";
import { fetchBatches, fetchReceipts } from "@/lib/api";
import { motion } from "framer-motion";
import { Layers, Download, Mail, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

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
          <p className="text-sm text-muted-foreground mt-1">Group receipts into one transfer per property.</p>
        </div>
        <Button variant="default" size="sm"><Layers className="h-4 w-4 mr-2" />Create Batch</Button>
      </div>

      {batches.length === 0 ? (
        <div className="vault-card p-8 text-center text-muted-foreground text-sm">No deposit batches yet. Create one from the Receivables report.</div>
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
                      <Button variant="outline" size="sm"><Download className="h-3.5 w-3.5" /></Button>
                      <Button variant="outline" size="sm"><Mail className="h-3.5 w-3.5" /></Button>
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
