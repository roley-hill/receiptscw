import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchReceipts } from "@/lib/api";
import { Search as SearchIcon, X } from "lucide-react";

export default function SearchPage() {
  const { data: allReceipts = [], isLoading } = useQuery({
    queryKey: ["receipts"],
    queryFn: fetchReceipts,
  });

  const [query, setQuery] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const properties = [...new Set(allReceipts.map((r) => r.property).filter(Boolean))];

  const results = allReceipts.filter((r) => {
    if (propertyFilter !== "all" && r.property !== propertyFilter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      (r.tenant || "").toLowerCase().includes(q) ||
      (r.property || "").toLowerCase().includes(q) ||
      (r.unit || "").toLowerCase().includes(q) ||
      (r.reference || "").toLowerCase().includes(q) ||
      (r.memo || "").toLowerCase().includes(q) ||
      r.receipt_id.toLowerCase().includes(q) ||
      String(r.amount).includes(q) ||
      (r.original_text || "").toLowerCase().includes(q)
    );
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Search Receipts</h1>
        <p className="text-sm text-muted-foreground mt-1">Find receipts by tenant, property, amount, reference, or full text.</p>
      </div>

      <div className="vault-card p-4 flex items-center gap-4">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by tenant, property, amount, check #, memo..." className="w-full h-10 rounded-md border border-input bg-background pl-10 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          {query && <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="h-4 w-4 text-muted-foreground" /></button>}
        </div>
        <select value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">All Properties</option>
          {properties.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="text-xs text-muted-foreground">{results.length} result{results.length !== 1 ? "s" : ""}</div>

      <div className="vault-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">ID</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tenant</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Property</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unit</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transfer</th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">{allReceipts.length === 0 ? "No receipts yet. Upload some first." : "No matching results."}</td></tr>
            ) : (
              results.map((r) => (
                <tr key={r.id} className="vault-table-row">
                  <td className="px-4 py-3 text-xs vault-mono text-vault-blue">{r.receipt_id}</td>
                  <td className="px-4 py-3 text-sm font-medium text-foreground">{r.tenant || "—"}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{r.property || "—"}</td>
                  <td className="px-4 py-3 text-sm vault-mono text-muted-foreground">{r.unit || "—"}</td>
                  <td className="px-4 py-3 text-sm text-right vault-mono font-semibold text-foreground">${Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3">
                    {r.status === "finalized" && <span className="vault-badge-success">Finalized</span>}
                    {r.status === "needs_review" && <span className="vault-badge-warning">Review</span>}
                    {r.status === "exception" && <span className="vault-badge-error">Exception</span>}
                  </td>
                  <td className="px-4 py-3">{r.transfer_status === "transferred" ? <span className="vault-badge-success">Transferred</span> : <span className="vault-badge-neutral">Pending</span>}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
