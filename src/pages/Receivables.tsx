import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchReceipts } from "@/lib/api";
import { motion } from "framer-motion";
import { Download, Mail, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DbReceipt } from "@/lib/api";

export default function Receivables() {
  const { data: allReceipts = [], isLoading } = useQuery({
    queryKey: ["receipts"],
    queryFn: fetchReceipts,
  });

  const [selectedProperty, setSelectedProperty] = useState<string>("all");
  const finalized = allReceipts.filter((r) => r.status === "finalized");
  const properties = [...new Set(finalized.map((r) => r.property).filter(Boolean))];
  const filtered = selectedProperty === "all" ? finalized : finalized.filter((r) => r.property === selectedProperty);

  const grouped = filtered.reduce((acc, r) => {
    if (!acc[r.property]) acc[r.property] = [];
    acc[r.property].push(r);
    return acc;
  }, {} as Record<string, DbReceipt[]>);

  const grandTotal = filtered.reduce((sum, r) => sum + Number(r.amount), 0);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Property Receivables & Deposits</h1>
          <p className="text-sm text-muted-foreground mt-1">Finalized receipts grouped by property.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-2" /> XLSX</Button>
          <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-2" /> CSV</Button>
          <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-2" /> PDF</Button>
          <Button variant="outline" size="sm"><Mail className="h-4 w-4 mr-2" /> Email</Button>
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
          const transferred = receipts.filter((r) => r.transfer_status === "transferred");
          const transferredAmt = transferred.reduce((s, r) => s + Number(r.amount), 0);
          const untransferredAmt = subtotal - transferredAmt;
          return (
            <motion.div key={property} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="vault-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">{property}</h3>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-muted-foreground">{receipts.length} receipts</span>
                  <span className="vault-mono font-bold text-foreground">${subtotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unit</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tenant</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt Date</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reference</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt ID</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transfer</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.sort((a, b) => (a.unit || "").localeCompare(b.unit || "")).map((r) => (
                    <tr key={r.id} className="vault-table-row">
                      <td className="px-4 py-2.5 text-sm vault-mono text-foreground">{r.unit}</td>
                      <td className="px-4 py-2.5 text-sm font-medium text-foreground">{r.tenant}</td>
                      <td className="px-4 py-2.5 text-sm vault-mono text-muted-foreground">{r.receipt_date || "—"}</td>
                      <td className="px-4 py-2.5 text-sm text-right vault-mono font-semibold text-foreground">${Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-2.5 text-sm vault-mono text-muted-foreground">{r.reference || "—"}</td>
                      <td className="px-4 py-2.5 text-xs vault-mono text-vault-blue">{r.receipt_id}</td>
                      <td className="px-4 py-2.5">{r.transfer_status === "transferred" ? <span className="vault-badge-success">Transferred</span> : <span className="vault-badge-neutral">Pending</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-3 border-t border-border bg-muted/20 flex items-center justify-between text-xs">
                <div className="flex gap-6">
                  <span className="text-muted-foreground">Transferred: <span className="vault-mono font-medium text-foreground">${transferredAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></span>
                  <span className="text-muted-foreground">Remaining: <span className="vault-mono font-medium text-foreground">${untransferredAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></span>
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
            <span className="text-sm text-muted-foreground">{filtered.length} receipts</span>
            <span className="text-lg vault-mono font-bold text-foreground">${grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      )}
    </div>
  );
}
