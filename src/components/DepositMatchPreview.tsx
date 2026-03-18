import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface NearMatch {
  deposit_line: {
    tenant_name: string;
    amount: number;
    property: string;
    check_number: string;
    date: string;
    description?: string;
  };
  receipt: {
    id: string;
    tenant: string;
    property: string;
    amount: number;
    rent_month: string;
    reference: string;
    unit: string;
    receipt_date: string;
  };
  score: number;
  reasons: string[];
}

interface Props {
  nearMatches: NearMatch[];
  batchId: string;
  batchUuid: string | null;
  onInclude: (receiptId: string) => void;
  onSkip: (receiptId: string) => void;
  onDone: () => void;
}

function getConfidenceColor(score: number): string {
  if (score >= 8) return "bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/20";
  if (score >= 4) return "bg-amber-500/15 text-amber-600 ring-1 ring-amber-500/20";
  return "bg-red-500/15 text-red-600 ring-1 ring-red-500/20";
}

function getConfidenceLabel(score: number): string {
  if (score >= 8) return "High";
  if (score >= 4) return "Medium";
  return "Low";
}

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });

export default function DepositMatchPreview({ nearMatches, batchId, batchUuid, onInclude, onSkip, onDone }: Props) {
  const [decisions, setDecisions] = useState<Record<string, "include" | "skip">>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));

  const toggleExpand = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const handleInclude = (nm: NearMatch, i: number) => {
    setDecisions(prev => ({ ...prev, [i]: "include" }));
    onInclude(nm.receipt.id);
  };

  const handleSkip = (_nm: NearMatch, i: number) => {
    setDecisions(prev => ({ ...prev, [i]: "skip" }));
    onSkip(_nm.receipt.id);
  };

  if (nearMatches.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Review Borderline Matches — {batchId}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {nearMatches.length} potential match{nearMatches.length > 1 ? "es" : ""} need review
          </p>
        </div>
        <Button size="sm" onClick={onDone} disabled={Object.keys(decisions).length < nearMatches.length}>
          Finalize Batch
        </Button>
      </div>

      <AnimatePresence>
        {nearMatches.map((nm, i) => {
          const isExpanded = expanded.has(i);
          const decision = decisions[i];

          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`vault-card overflow-hidden ${decision === "include" ? "ring-1 ring-emerald-500/30" : decision === "skip" ? "ring-1 ring-border opacity-60" : ""}`}
            >
              {/* Header */}
              <button
                onClick={() => toggleExpand(i)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className="text-sm font-medium text-foreground">{nm.deposit_line.tenant_name}</span>
                  <span className="text-sm vault-mono text-foreground">${fmt(nm.deposit_line.amount)}</span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${getConfidenceColor(nm.score)}`}>
                    {getConfidenceLabel(nm.score)} ({nm.score})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {decision === "include" && <span className="text-xs text-emerald-600 font-semibold">✓ Included</span>}
                  {decision === "skip" && <span className="text-xs text-muted-foreground font-semibold">✗ Skipped</span>}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border">
                  <div className="grid grid-cols-2 divide-x divide-border">
                    {/* LEFT: Our receipt */}
                    <div className="p-4 space-y-2">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Our System</h4>
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Tenant</span>
                          <span className="font-medium text-foreground">{nm.receipt.tenant}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Property</span>
                          <span className="text-foreground">{nm.receipt.property}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Unit</span>
                          <span className="vault-mono text-foreground">{nm.receipt.unit || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Amount</span>
                          <span className="vault-mono font-semibold text-foreground">${fmt(nm.receipt.amount)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Rent Month</span>
                          <span className="vault-mono text-foreground">{nm.receipt.rent_month || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Reference</span>
                          <span className="vault-mono text-foreground">{nm.receipt.reference || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Receipt Date</span>
                          <span className="vault-mono text-foreground">{nm.receipt.receipt_date || "—"}</span>
                        </div>
                      </div>
                    </div>

                    {/* RIGHT: AppFolio deposit line */}
                    <div className="p-4 space-y-2">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Deposit Line</h4>
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Tenant</span>
                          <span className="font-medium text-foreground">{nm.deposit_line.tenant_name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Property</span>
                          <span className="text-foreground">{nm.deposit_line.property || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Amount</span>
                          <span className="vault-mono font-semibold text-foreground">${fmt(nm.deposit_line.amount)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Check #</span>
                          <span className="vault-mono text-foreground">{nm.deposit_line.check_number || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Date</span>
                          <span className="vault-mono text-foreground">{nm.deposit_line.date || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Description</span>
                          <span className="text-foreground">{nm.deposit_line.description || "—"}</span>
                        </div>
                      </div>

                      {/* Match reasons */}
                      <div className="pt-2 border-t border-border">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase">Match Signals</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {nm.reasons.map((r, j) => (
                            <span key={j} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground ring-1 ring-border">
                              {r.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  {!decision && (
                    <div className="px-4 py-3 border-t border-border bg-muted/20 flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSkip(nm, i)}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" /> Skip
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleInclude(nm, i)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Include in Batch
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
