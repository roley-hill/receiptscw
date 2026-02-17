import { mockBatches, mockReceipts } from "@/lib/mockData";
import { motion } from "framer-motion";
import { Layers, ArrowRight, Download, Mail, CheckCircle2, Clock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DepositBatches() {
  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Deposit Batches</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Group receipts into one transfer per property. Track transfer status.
          </p>
        </div>
        <Button variant="default" size="sm">
          <Layers className="h-4 w-4 mr-2" />
          Create Batch
        </Button>
      </div>

      {/* Batch List */}
      <div className="space-y-4">
        {mockBatches.map((batch, i) => {
          const receipts = mockReceipts.filter((r) => batch.receiptIds.includes(r.id));
          return (
            <motion.div
              key={batch.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="vault-card overflow-hidden"
            >
              <div className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                    batch.status === "transferred" ? "bg-vault-emerald-light" : "bg-vault-blue-light"
                  }`}>
                    {batch.status === "transferred" ? (
                      <CheckCircle2 className="h-5 w-5 text-vault-emerald" />
                    ) : (
                      <Clock className="h-5 w-5 text-vault-blue" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-foreground">{batch.property}</h3>
                      <span className="vault-mono text-xs text-muted-foreground">{batch.id}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {batch.depositPeriod} · {batch.receiptCount} receipt{batch.receiptCount !== 1 ? "s" : ""} · Created{" "}
                      {new Date(batch.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-lg vault-mono font-bold text-foreground">
                      ${batch.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </p>
                    <BatchStatusBadge status={batch.status} />
                  </div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm">
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="sm">
                      <Mail className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              {batch.status === "transferred" && batch.transferredAt && (
                <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center gap-6 text-xs text-muted-foreground">
                  <span>Transferred: <span className="font-medium text-foreground">{new Date(batch.transferredAt).toLocaleDateString()}</span></span>
                  <span>Method: <span className="font-medium text-foreground">{batch.transferMethod}</span></span>
                  <span>Ref: <span className="vault-mono font-medium text-foreground">{batch.externalReference}</span></span>
                </div>
              )}

              {/* Receipt List */}
              <div className="border-t border-border">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="px-5 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tenant</th>
                      <th className="px-5 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unit</th>
                      <th className="px-5 py-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                      <th className="px-5 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reference</th>
                      <th className="px-5 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((r) => (
                      <tr key={r.id} className="vault-table-row">
                        <td className="px-5 py-2.5 text-sm font-medium text-foreground">{r.tenant}</td>
                        <td className="px-5 py-2.5 text-sm vault-mono text-muted-foreground">{r.unit}</td>
                        <td className="px-5 py-2.5 text-sm text-right vault-mono font-semibold text-foreground">
                          ${r.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-5 py-2.5 text-sm vault-mono text-muted-foreground">{r.reference}</td>
                        <td className="px-5 py-2.5 text-xs vault-mono text-vault-blue">{r.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function BatchStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "transferred":
      return <span className="vault-badge-success">Transferred</span>;
    case "ready":
      return <span className="vault-badge-info">Ready</span>;
    case "draft":
      return <span className="vault-badge-neutral">Draft</span>;
    case "reversed":
      return <span className="vault-badge-error">Reversed</span>;
    default:
      return <span className="vault-badge-neutral">{status}</span>;
  }
}
