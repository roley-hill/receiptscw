import { useQuery } from "@tanstack/react-query";
import { fetchReceipts } from "@/lib/api";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";

export default function Exceptions() {
  const { data: allReceipts = [], isLoading } = useQuery({
    queryKey: ["receipts"],
    queryFn: fetchReceipts,
  });

  const exceptions = allReceipts.filter((r) => r.status === "exception");

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (exceptions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <CheckCircle2 className="h-12 w-12 text-vault-emerald mb-4" />
        <h2 className="text-xl font-bold text-foreground">No Exceptions</h2>
        <p className="text-sm text-muted-foreground mt-1">All receipts have required fields.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Exceptions Queue</h1>
        <p className="text-sm text-muted-foreground mt-1">Receipts missing critical fields. Fix before batching.</p>
      </div>
      <div className="space-y-3">
        {exceptions.map((r, i) => {
          const conf = (r.confidence_scores as any) || {};
          const issues: string[] = [];
          if ((conf.property || 0) < 0.7) issues.push("Low confidence: Property");
          if ((conf.unit || 0) < 0.7) issues.push("Low confidence: Unit");
          if ((conf.tenant || 0) < 0.75) issues.push("Low confidence: Tenant");
          if ((conf.amount || 0) < 0.8) issues.push("Low confidence: Amount");
          if (!r.property) issues.push("Missing: Property");
          if (!r.tenant) issues.push("Missing: Tenant");
          if (!r.amount || r.amount === 0) issues.push("Missing: Amount");
          return (
            <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="vault-card p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-vault-red-light flex items-center justify-center mt-0.5">
                    <AlertTriangle className="h-4 w-4 text-vault-red" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-foreground">{r.tenant || "Unknown Tenant"}</h3>
                      <span className="vault-mono text-xs text-muted-foreground">{r.receipt_id}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.property || "Unknown Property"} · Unit {r.unit || "?"} · {r.file_name || "No file"}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {issues.map((issue) => <span key={issue} className="vault-badge-error text-[10px]">{issue}</span>)}
                    </div>
                  </div>
                </div>
                <Link to="/review">
                  <Button variant="outline" size="sm">Review & Fix</Button>
                </Link>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
