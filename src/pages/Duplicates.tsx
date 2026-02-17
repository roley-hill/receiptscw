import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Copy, CheckCircle2, XCircle, ChevronDown, ChevronUp, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface SkippedDuplicate {
  id: string;
  tenant: string;
  property: string;
  unit: string;
  amount: number;
  receipt_date: string | null;
  rent_month: string | null;
  payment_type: string | null;
  reference: string | null;
  memo: string | null;
  file_name: string | null;
  file_path: string | null;
  existing_receipt_id: string;
  existing_receipt_uuid: string | null;
  confidence_scores: any;
  status: string;
  created_at: string;
}

interface ExistingReceipt {
  id: string;
  receipt_id: string;
  tenant: string;
  property: string;
  unit: string;
  amount: number;
  receipt_date: string | null;
  rent_month: string | null;
  payment_type: string | null;
  reference: string | null;
  memo: string | null;
  status: string;
  file_name: string | null;
}

async function fetchPendingDuplicates() {
  const { data, error } = await supabase
    .from("skipped_duplicates")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as SkippedDuplicate[];
}

export default function Duplicates() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: duplicates = [], isLoading } = useQuery({
    queryKey: ["skipped_duplicates"],
    queryFn: fetchPendingDuplicates,
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [existingReceipts, setExistingReceipts] = useState<Record<string, ExistingReceipt>>({});
  const [loadingExisting, setLoadingExisting] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState<Set<string>>(new Set());

  const toggleExpand = async (dup: SkippedDuplicate) => {
    if (expandedId === dup.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(dup.id);

    if (dup.existing_receipt_uuid && !existingReceipts[dup.existing_receipt_uuid]) {
      setLoadingExisting((prev) => new Set(prev).add(dup.id));
      const { data } = await supabase
        .from("receipts")
        .select("id, receipt_id, tenant, property, unit, amount, receipt_date, rent_month, payment_type, reference, memo, status, file_name")
        .eq("id", dup.existing_receipt_uuid)
        .single();
      if (data) {
        setExistingReceipts((prev) => ({ ...prev, [dup.existing_receipt_uuid!]: data as ExistingReceipt }));
      }
      setLoadingExisting((prev) => {
        const next = new Set(prev);
        next.delete(dup.id);
        return next;
      });
    }
  };

  const advanceToNext = (currentId: string) => {
    const currentIndex = duplicates.findIndex((d) => d.id === currentId);
    const nextDup = duplicates.find((d, i) => i > currentIndex && d.id !== currentId);
    setExpandedId(nextDup ? nextDup.id : null);
    if (nextDup && nextDup.existing_receipt_uuid && !existingReceipts[nextDup.existing_receipt_uuid]) {
      toggleExpand(nextDup);
    }
  };

  const handleForceAdd = async (dup: SkippedDuplicate) => {
    setProcessing((prev) => new Set(prev).add(dup.id));
    try {
      const confidences = dup.confidence_scores || {};
      const avgConf = [confidences.property || 0, confidences.unit || 0, confidences.tenant || 0, confidences.amount || 0, confidences.receiptDate || 0].reduce((a: number, b: number) => a + b, 0) / 5;
      const hasMissing = !dup.property || !dup.tenant || !dup.amount;
      const status = hasMissing ? "exception" : avgConf < 0.7 ? "exception" : "needs_review";

      const { error: insertError } = await supabase.from("receipts").insert({
        user_id: user?.id,
        property: dup.property,
        unit: dup.unit,
        tenant: dup.tenant,
        receipt_date: dup.receipt_date || null,
        rent_month: dup.rent_month || null,
        amount: dup.amount,
        payment_type: dup.payment_type || "",
        reference: dup.reference || "",
        memo: dup.memo || "",
        confidence_scores: dup.confidence_scores,
        status,
        file_path: dup.file_path,
        file_name: dup.file_name,
      });
      if (insertError) throw insertError;

      await supabase.from("skipped_duplicates").update({
        status: "approved",
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id,
      }).eq("id", dup.id);

      toast.success("Receipt added successfully");
      advanceToNext(dup.id);
      queryClient.invalidateQueries({ queryKey: ["skipped_duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["pending_counts"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to add receipt");
    }
    setProcessing((prev) => {
      const next = new Set(prev);
      next.delete(dup.id);
      return next;
    });
  };

  const handleDismiss = async (dup: SkippedDuplicate) => {
    setProcessing((prev) => new Set(prev).add(dup.id));
    try {
      await supabase.from("skipped_duplicates").update({
        status: "dismissed",
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id,
      }).eq("id", dup.id);
      toast.success("Duplicate confirmed — skipped");
      advanceToNext(dup.id);
      queryClient.invalidateQueries({ queryKey: ["skipped_duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["pending_counts"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to dismiss");
    }
    setProcessing((prev) => {
      const next = new Set(prev);
      next.delete(dup.id);
      return next;
    });
  };

  const handleDelete = async (dup: SkippedDuplicate) => {
    setProcessing((prev) => new Set(prev).add(dup.id));
    try {
      const { error } = await supabase.from("skipped_duplicates").delete().eq("id", dup.id);
      if (error) throw error;
      toast.success("Duplicate deleted");
      advanceToNext(dup.id);
      queryClient.invalidateQueries({ queryKey: ["skipped_duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["pending_counts"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to delete");
    }
    setProcessing((prev) => {
      const next = new Set(prev);
      next.delete(dup.id);
      return next;
    });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (duplicates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <CheckCircle2 className="h-12 w-12 text-vault-emerald mb-4" />
        <h2 className="text-xl font-bold text-foreground">No Pending Duplicates</h2>
        <p className="text-sm text-muted-foreground mt-1">All duplicate detections have been reviewed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Duplicate Review</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {duplicates.length} skipped duplicate{duplicates.length !== 1 ? "s" : ""} awaiting review. Compare with existing records and approve or dismiss.
        </p>
      </div>

      <div className="space-y-3">
        {duplicates.map((dup, i) => {
          const isExpanded = expandedId === dup.id;
          const existing = dup.existing_receipt_uuid ? existingReceipts[dup.existing_receipt_uuid] : null;
          const isLoadingThis = loadingExisting.has(dup.id);
          const isProcessing = processing.has(dup.id);

          return (
            <motion.div
              key={dup.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="vault-card overflow-hidden"
            >
              <button
                onClick={() => toggleExpand(dup)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3 text-left">
                  <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <Copy className="h-4 w-4 text-amber-500" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-foreground">{dup.tenant || "Unknown"}</h3>
                      <span className="vault-mono text-xs text-muted-foreground">${Number(dup.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{dup.property || "Unknown"} · Unit {dup.unit || "?"} · {dup.receipt_date || "No date"} · Matches {dup.existing_receipt_id}</p>
                  </div>
                </div>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 border-t border-border pt-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* New (skipped) record */}
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">New (Skipped)</p>
                          <CompareField label="Tenant" value={dup.tenant} />
                          <CompareField label="Property" value={dup.property} />
                          <CompareField label="Unit" value={dup.unit} />
                          <CompareField label="Amount" value={`$${Number(dup.amount).toFixed(2)}`} />
                          <CompareField label="Date" value={dup.receipt_date || "—"} />
                          <CompareField label="Rent Month" value={dup.rent_month || "—"} />
                          <CompareField label="Payment" value={dup.payment_type || "—"} />
                          <CompareField label="Reference" value={dup.reference || "—"} />
                          <CompareField label="File" value={dup.file_name || "—"} />
                        </div>

                        {/* Existing record */}
                        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Existing Record ({dup.existing_receipt_id})</p>
                          {isLoadingThis ? (
                            <div className="flex items-center justify-center py-6">
                              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                          ) : existing ? (
                            <>
                              <CompareField label="Tenant" value={existing.tenant} />
                              <CompareField label="Property" value={existing.property} />
                              <CompareField label="Unit" value={existing.unit} />
                              <CompareField label="Amount" value={`$${Number(existing.amount).toFixed(2)}`} />
                              <CompareField label="Date" value={existing.receipt_date || "—"} />
                              <CompareField label="Rent Month" value={existing.rent_month || "—"} />
                              <CompareField label="Payment" value={existing.payment_type || "—"} />
                              <CompareField label="Reference" value={existing.reference || "—"} />
                              <CompareField label="File" value={existing.file_name || "—"} />
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground py-4">Could not load existing record.</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-4 justify-end">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(dup)}
                          disabled={isProcessing}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDismiss(dup)}
                          disabled={isProcessing}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Confirm Duplicate
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleForceAdd(dup)}
                          disabled={isProcessing}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                          Add Anyway
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function CompareField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
      <span className="text-xs text-foreground font-medium text-right">{value}</span>
    </div>
  );
}

