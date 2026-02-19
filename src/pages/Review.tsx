import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { fetchReceipts, updateReceipt, getFilePreviewUrl } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight, Eye, Edit3, Save, FileText, Image as ImageIcon, Loader2, ZoomIn, ZoomOut, RotateCcw, Trash2, CheckCheck, ArrowLeft } from "lucide-react";
import TenantSuggestion from "@/components/TenantSuggestion";
import PdfViewer from "@/components/PdfViewer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { TenantStatusBadge, ChargeTypeBadge, UnverifiedBadge } from "@/components/StatusBadges";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function ReviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const targetReceiptId = searchParams.get("receiptId");
  const { data: allReceipts = [], isLoading } = useQuery({
    queryKey: ["receipts"],
    queryFn: fetchReceipts,
  });
  const queryClient = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const reviewable = allReceipts.filter((r) => r.status === "needs_review" || r.status === "exception");

  const [activeReceiptId, setActiveReceiptId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [fileFilter, setFileFilter] = useState<string>("all");

  // Navigate to specific receipt if receiptId is in URL
  useEffect(() => {
    if (targetReceiptId && reviewable.length > 0) {
      const found = reviewable.find((r) => r.id === targetReceiptId);
      if (found) {
        setActiveReceiptId(targetReceiptId);
        setSearchParams({}, { replace: true });
      }
    }
  }, [targetReceiptId, reviewable.length]);

  // File groups for filter
  const fileGroups = useMemo(() => {
    const groups: Record<string, number> = {};
    for (const r of reviewable) {
      const name = r.file_name || "No file";
      groups[name] = (groups[name] || 0) + 1;
    }
    return Object.entries(groups).sort((a, b) => b[1] - a[1]);
  }, [reviewable]);

  const filteredReviewable = useMemo(
    () => fileFilter === "all"
      ? reviewable
      : reviewable.filter((r) => (r.file_name || "No file") === fileFilter),
    [reviewable, fileFilter]
  );

  const allSelected = filteredReviewable.length > 0 && filteredReviewable.every((r) => selected.has(r.id));

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filteredReviewable.map((r) => r.id)));
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      const ids = Array.from(selected);
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const { error } = await supabase.from("receipts").delete().in("id", chunk);
        if (error) throw error;
      }
      toast.success(`Deleted ${selected.size} receipt(s)`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    }
    setDeleting(false);
  };

  const handleBulkFinalize = async () => {
    if (selected.size === 0) return;
    setFinalizing(true);
    try {
      const ids = Array.from(selected);
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const { error } = await supabase
          .from("receipts")
          .update({ status: "finalized" as any, finalized_at: new Date().toISOString() })
          .in("id", chunk);
        if (error) throw error;
      }
      toast.success(`Finalized ${selected.size} receipt(s)`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
    } catch (err: any) {
      toast.error(err.message || "Finalize failed");
    }
    setFinalizing(false);
  };

  const handleDeleteByFile = async (fileName: string) => {
    setDeleting(true);
    try {
      const idsToDelete = reviewable
        .filter((r) => (r.file_name || "No file") === fileName)
        .map((r) => r.id);
      for (let i = 0; i < idsToDelete.length; i += 100) {
        const chunk = idsToDelete.slice(i, i + 100);
        const { error } = await supabase.from("receipts").delete().in("id", chunk);
        if (error) throw error;
      }
      toast.success(`Deleted ${idsToDelete.length} receipt(s) from "${fileName}"`);
      setSelected(new Set());
      if (fileFilter === fileName) setFileFilter("all");
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    }
    setDeleting(false);
  };

  const handleFinalizeByFile = async (fileName: string) => {
    setFinalizing(true);
    try {
      const idsToFinalize = reviewable
        .filter((r) => (r.file_name || "No file") === fileName)
        .map((r) => r.id);
      for (let i = 0; i < idsToFinalize.length; i += 100) {
        const chunk = idsToFinalize.slice(i, i + 100);
        const { error } = await supabase
          .from("receipts")
          .update({ status: "finalized" as any, finalized_at: new Date().toISOString() })
          .in("id", chunk);
        if (error) throw error;
      }
      toast.success(`Finalized ${idsToFinalize.length} receipt(s) from "${fileName}"`);
      setSelected(new Set());
      if (fileFilter === fileName) setFileFilter("all");
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
    } catch (err: any) {
      toast.error(err.message || "Finalize failed");
    }
    setFinalizing(false);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (reviewable.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <CheckCircle2 className="h-12 w-12 text-vault-emerald mb-4" />
        <h2 className="text-xl font-bold text-foreground">All caught up!</h2>
        <p className="text-sm text-muted-foreground mt-1">No receipts pending review.</p>
      </div>
    );
  }

  // Detail view for a single receipt
  const activeReceipt = activeReceiptId ? reviewable.find((r) => r.id === activeReceiptId) : null;
  const activeIndex = activeReceipt ? filteredReviewable.findIndex((r) => r.id === activeReceiptId) : -1;

  const handleNavigate = (direction: "prev" | "next") => {
    const newIndex = direction === "prev" ? activeIndex - 1 : activeIndex + 1;
    if (newIndex >= 0 && newIndex < filteredReviewable.length) {
      setActiveReceiptId(filteredReviewable[newIndex].id);
    }
  };

  if (activeReceipt) {
    return (
      <ReviewDetail
        receipt={activeReceipt}
        reviewable={filteredReviewable}
        currentIndex={activeIndex}
        isAdmin={isAdmin}
        onBack={() => setActiveReceiptId(null)}
        onNavigate={handleNavigate}
        queryClient={queryClient}
      />
    );
  }

  // List view
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Review Receipts</h1>
          <p className="text-sm text-muted-foreground mt-1">{reviewable.length} receipt(s) pending review</p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <>
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                Select all
              </label>
              {selected.size > 0 && (
                <>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" disabled={finalizing}>
                        <CheckCheck className="h-4 w-4 mr-1" />
                        Finalize {selected.size}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Finalize {selected.size} receipt(s)?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will mark the selected receipts as finalized and move them into entry & recording.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleBulkFinalize}>Finalize</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm" disabled={deleting}>
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete {selected.size}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {selected.size} receipt(s)?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently remove the selected receipts. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* File filter + per-file actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <Select value={fileFilter} onValueChange={setFileFilter}>
            <SelectTrigger className="w-[320px] h-9 text-sm">
              <SelectValue placeholder="Filter by file" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All files ({reviewable.length})</SelectItem>
              {fileGroups.map(([name, count]) => (
                <SelectItem key={name} value={name}>
                  {name.replace(/^Receipts\//, "")} ({count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isAdmin && fileFilter !== "all" && (
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={finalizing}>
                  <CheckCheck className="h-4 w-4 mr-1" />
                  Finalize all from this file ({filteredReviewable.length})
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Finalize all {filteredReviewable.length} receipt(s) from this file?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will mark all receipts from "{fileFilter.replace(/^Receipts\//, "")}" as finalized.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleFinalizeByFile(fileFilter)}>Finalize All</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deleting}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete all from this file ({filteredReviewable.length})
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete all {filteredReviewable.length} receipt(s) from this file?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove all receipts from "{fileFilter.replace(/^Receipts\//, "")}". You can re-upload for clean extraction.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleDeleteByFile(fileFilter)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Delete All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>

      {/* Scrollable receipt list */}
      <div className="space-y-3">
        {filteredReviewable.map((r, i) => {
          const conf = (r.confidence_scores as any) || {};
          return (
            <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="vault-card p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  {isAdmin && (
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={() => toggle(r.id)}
                      className="mt-1"
                    />
                  )}
                  <div className={`h-9 w-9 rounded-lg flex items-center justify-center mt-0.5 ${r.status === "exception" ? "bg-vault-red-light" : "bg-vault-amber-light"}`}>
                    {r.status === "exception"
                      ? <AlertTriangle className="h-4 w-4 text-vault-red" />
                      : <Eye className="h-4 w-4 text-vault-amber" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-foreground">{r.tenant || "Unknown Tenant"}</h3>
                      <span className="vault-mono text-xs text-muted-foreground">{r.receipt_id}</span>
                      {r.status === "exception" && <span className="vault-badge-error text-[10px]">Exception</span>}
                      {r.status === "needs_review" && <span className="vault-badge-warning text-[10px]">Needs Review</span>}
                      {conf.tenantStatus && <TenantStatusBadge status={conf.tenantStatus} />}
                      {conf.chargeType && <ChargeTypeBadge chargeType={conf.chargeType} />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {r.property || "Unknown Property"} · Unit {r.unit || "?"} · ${Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} · {r.file_name || "No file"}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setActiveReceiptId(r.id)}>
                  Review & Fix
                </Button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Detail View ───────────────────────────────────────────────

function ReviewDetail({
  receipt,
  reviewable,
  currentIndex,
  isAdmin,
  onBack,
  onNavigate,
  queryClient,
}: {
  receipt: any;
  reviewable: any[];
  currentIndex: number;
  isAdmin: boolean;
  onBack: () => void;
  onNavigate: (direction: "prev" | "next") => void;
  queryClient: any;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleEdit = (field: string, value: string) => {
    setEdits((prev) => ({ ...prev, [field]: value }));
  };
  const getVal = (field: string, fallback: string) => edits[field] ?? fallback;

  const handleFinalize = async () => {
    setSaving(true);
    try {
      await updateReceipt(receipt.id, {
        property: getVal("property", receipt.property),
        unit: getVal("unit", receipt.unit),
        tenant: getVal("tenant", receipt.tenant),
        receipt_date: getVal("receipt_date", receipt.receipt_date || "") || null,
        rent_month: getVal("rent_month", receipt.rent_month || ""),
        amount: parseFloat(getVal("amount", String(receipt.amount))) || receipt.amount,
        payment_type: getVal("payment_type", receipt.payment_type || ""),
        reference: getVal("reference", receipt.reference || ""),
        memo: getVal("memo", receipt.memo || ""),
        status: "finalized" as const,
        finalized_at: new Date().toISOString(),
      });
      toast.success("Receipt finalized!");
      setEdits({});
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      // Auto-advance to next record, or go back if this was the last one
      if (currentIndex < reviewable.length - 1) {
        onNavigate("next");
      } else if (currentIndex > 0) {
        onNavigate("prev");
      } else {
        onBack();
      }
    } catch (err: any) {
      toast.error(err.message);
    }
    setSaving(false);
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      await updateReceipt(receipt.id, {
        property: getVal("property", receipt.property),
        unit: getVal("unit", receipt.unit),
        tenant: getVal("tenant", receipt.tenant),
        receipt_date: getVal("receipt_date", receipt.receipt_date || "") || null,
        rent_month: getVal("rent_month", receipt.rent_month || ""),
        amount: parseFloat(getVal("amount", String(receipt.amount))) || receipt.amount,
        payment_type: getVal("payment_type", receipt.payment_type || ""),
        reference: getVal("reference", receipt.reference || ""),
        memo: getVal("memo", receipt.memo || ""),
      });
      toast.success("Draft saved");
      setEdits({});
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
    } catch (err: any) {
      toast.error(err.message);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    try {
      const { error } = await supabase.from("receipts").delete().eq("id", receipt.id);
      if (error) throw error;
      toast.success("Receipt deleted");
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      onBack();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const conf = (receipt.confidence_scores as any) || {};

  return (
    <div className="space-y-4 max-w-7xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to list
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Review Receipt</h1>
            <p className="text-sm text-muted-foreground mt-1">{receipt.receipt_id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{currentIndex + 1} of {reviewable.length}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onNavigate("prev")} disabled={currentIndex <= 0}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onNavigate("next")} disabled={currentIndex >= reviewable.length - 1}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div key={receipt.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="vault-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Eye className="h-4 w-4" />Document Preview</h3>
            <span className="text-xs vault-mono text-muted-foreground">{receipt.file_name || "No file"}</span>
          </div>
          <FilePreview filePath={receipt.file_path} fileName={receipt.file_name} originalText={receipt.original_text} />
        </motion.div>

        <motion.div key={receipt.id + "-fields"} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="vault-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Edit3 className="h-4 w-4" />Extracted Fields</h3>
            {receipt.status === "needs_review" && <span className="vault-badge-warning">Needs Review</span>}
            {receipt.status === "exception" && <span className="vault-badge-error flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Exception</span>}
            {Number(receipt.amount) < 0 && <span className="vault-badge-deduction">Deduction</span>}
          </div>
          <div className="space-y-3">
            <FieldRow label="Receipt ID" value={receipt.receipt_id} confidence={1} readOnly />
            <FieldRow label="Property / Building" value={getVal("property", receipt.property)} confidence={conf.property || 0} required onChange={(v) => handleEdit("property", v)} badge={conf.propertyVerified === false ? <UnverifiedBadge field="Property" /> : undefined} />
            <FieldRow label="Unit" value={getVal("unit", receipt.unit)} confidence={conf.unit || 0} required onChange={(v) => handleEdit("unit", v)} />
            <FieldRow label="Tenant" value={getVal("tenant", receipt.tenant)} confidence={conf.tenant || 0} required onChange={(v) => handleEdit("tenant", v)} badge={<>{conf.tenantVerified === false ? <UnverifiedBadge field="Tenant" /> : null}{conf.tenantStatus ? <TenantStatusBadge status={conf.tenantStatus} /> : null}{conf.chargeType ? <ChargeTypeBadge chargeType={conf.chargeType} /> : null}</>} />
            <TenantSuggestion
              property={getVal("property", receipt.property)}
              unit={getVal("unit", receipt.unit)}
              extractedTenant={getVal("tenant", receipt.tenant)}
              onAccept={async ({ name, property, unit }) => {
                try {
                  const updatedScores = { ...(receipt.confidence_scores as any || {}), tenant: 0.95, property: 0.95, unit: 0.95, tenantVerified: true, propertyVerified: true };
                  await updateReceipt(receipt.id, { tenant: name, property, unit, confidence_scores: updatedScores });
                  toast.success(`Updated tenant to ${name}`);
                  queryClient.invalidateQueries({ queryKey: ["receipts"] });
                } catch (err: any) {
                  toast.error(err.message || "Update failed");
                }
              }}
            />
            <FieldRow label="Receipt Date" value={getVal("receipt_date", receipt.receipt_date || "")} confidence={conf.receiptDate || 0} required onChange={(v) => handleEdit("receipt_date", v)} />
            <FieldRow label="Rent Month" value={getVal("rent_month", receipt.rent_month || "")} confidence={0.85} onChange={(v) => handleEdit("rent_month", v)} />
            <FieldRow label="Amount" value={getVal("amount", String(receipt.amount))} confidence={conf.amount || 0} required onChange={(v) => handleEdit("amount", v)} badge={<>{conf.amountVerified === false ? <UnverifiedBadge field="Amount" /> : null}{conf.chargeType ? <ChargeTypeBadge chargeType={conf.chargeType} /> : null}</>} />
            <FieldRow label="Payment Type" value={getVal("payment_type", receipt.payment_type || "")} confidence={conf.paymentType || 0} onChange={(v) => handleEdit("payment_type", v)} />
            <FieldRow label="Reference" value={getVal("reference", receipt.reference || "")} confidence={0.9} onChange={(v) => handleEdit("reference", v)} />
            <FieldRow label="Memo / Remarks" value={getVal("memo", receipt.memo || "")} confidence={0.88} onChange={(v) => handleEdit("memo", v)} />
          </div>
          <div className="flex gap-2 pt-4 border-t border-border">
            <Button variant="default" className="flex-1" onClick={handleFinalize} disabled={saving}>
              <CheckCircle2 className="h-4 w-4 mr-2" /> Mark as Finalized
            </Button>
            <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>
              <Save className="h-4 w-4 mr-2" /> Save Draft
            </Button>
            {isAdmin && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="icon">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this receipt?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove {receipt.receipt_id}. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ─── Helper Components (unchanged) ─────────────────────────────

function ZoomablePreview({ children }: { children: React.ReactNode }) {
  const [zoom, setZoom] = useState(1);
  const zoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const resetZoom = () => setZoom(1);

  return (
    <div>
      <div className="flex items-center gap-1 mb-2">
        <Button variant="ghost" size="sm" onClick={zoomOut} disabled={zoom <= 0.5} className="h-7 w-7 p-0">
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground w-12 text-center vault-mono">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="sm" onClick={zoomIn} disabled={zoom >= 3} className="h-7 w-7 p-0">
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        {zoom !== 1 && (
          <Button variant="ghost" size="sm" onClick={resetZoom} className="h-7 w-7 p-0">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="overflow-auto max-h-[700px] rounded-lg border border-border bg-muted/50">
        <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: `${100 / zoom}%` }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function FilePreview({ filePath, fileName, originalText }: { filePath: string | null; fileName: string | null; originalText: string | null }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fileExt = fileName?.split(".").pop()?.toLowerCase();
  const isImage = ["jpg", "jpeg", "png", "webp", "heic"].includes(fileExt || "");
  const isPdf = fileExt === "pdf";
  const isXlsx = ["xlsx", "xls"].includes(fileExt || "");
  const isEml = fileExt === "eml";

  useEffect(() => {
    if (!filePath) return;
    setLoading(true);
    setError(false);
    getFilePreviewUrl(filePath)
      .then((url) => { setPreviewUrl(url); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [filePath]);

  if (loading) {
    return (
      <div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[400px] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isImage && previewUrl && !error) {
    return (
      <ZoomablePreview>
        <div className="p-4 flex items-center justify-center min-h-[400px]">
          <img src={previewUrl} alt={fileName || "Receipt"} className="max-w-full object-contain" />
        </div>
      </ZoomablePreview>
    );
  }

  if (isPdf && previewUrl && !error) {
    return (
      <div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[400px]">
        <PdfViewer url={previewUrl} />
        {originalText && (
          <div className="w-full mt-4 border-t border-border pt-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">Extracted Text</p>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono max-h-[300px] overflow-auto">{originalText}</pre>
          </div>
        )}
      </div>
    );
  }

  if (isXlsx && originalText) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{fileName}</p>
        </div>
        <ZoomablePreview>
          <div className="p-4">
            <SpreadsheetPreview csv={originalText} />
          </div>
        </ZoomablePreview>
        {previewUrl && !error && (
          <div className="mt-3 text-right">
            <Button variant="ghost" size="sm" onClick={() => window.open(previewUrl, "_blank")}>
              <Eye className="h-3 w-3 mr-1" /> Download Original
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (isEml && originalText?.startsWith("PDF_ATTACHMENT:")) {
    const pdfPath = originalText.replace("PDF_ATTACHMENT:", "");
    return <EmlPdfPreview pdfPath={pdfPath} fileName={fileName} emlPreviewUrl={previewUrl} error={error} />;
  }

  if (isEml && originalText?.startsWith("IMAGE_ATTACHMENT:")) {
    const imgPath = originalText.replace("IMAGE_ATTACHMENT:", "");
    return <EmlImagePreview imgPath={imgPath} fileName={fileName} emlPreviewUrl={previewUrl} error={error} />;
  }

  if (isEml && originalText) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{fileName}</p>
        </div>
        <ZoomablePreview>
          <EmailPreview raw={originalText} />
        </ZoomablePreview>
        {previewUrl && !error && (
          <div className="mt-3 text-right">
            <Button variant="ghost" size="sm" onClick={() => window.open(previewUrl, "_blank")}>
              <Eye className="h-3 w-3 mr-1" /> Download Original
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[400px]">
      <div className="flex flex-col items-center justify-center gap-3 py-4">
        <FileText className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{fileName || "Unknown file"}</p>
        {previewUrl && !error && (
          <Button variant="outline" size="sm" onClick={() => window.open(previewUrl, "_blank")}>
            <Eye className="h-4 w-4 mr-2" /> Download Source File
          </Button>
        )}
      </div>
      {originalText && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Extracted Text</p>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono max-h-[300px] overflow-auto">{originalText}</pre>
        </div>
      )}
    </div>
  );
}

function SpreadsheetPreview({ csv }: { csv: string }) {
  const lines = csv.split("\n").filter((l) => l.trim());
  const rows: string[][] = [];
  for (const line of lines) {
    if (line.startsWith("=== Sheet:")) continue;
    rows.push(line.split(",").map((c) => c.trim()));
  }
  if (rows.length === 0) {
    return <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono max-h-[500px] overflow-auto">{csv}</pre>;
  }
  const headerRow = rows[0];
  const dataRows = rows.slice(1);
  return (
    <div className="overflow-auto max-h-[500px] rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted sticky top-0">
          <tr>
            {headerRow.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-foreground border-b border-border whitespace-nowrap">{h || `Col ${i + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "bg-background" : "bg-muted/30"}>
              {headerRow.map((_, ci) => (
                <td key={ci} className="px-3 py-1.5 text-muted-foreground border-b border-border/50 whitespace-nowrap">{row[ci] || ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmlPdfPreview({ pdfPath, fileName, emlPreviewUrl, error }: { pdfPath: string; fileName: string | null; emlPreviewUrl: string | null; error: boolean }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getFilePreviewUrl(pdfPath)
      .then((url) => { setPdfUrl(url); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, [pdfPath]);

  if (loading) {
    return (
      <div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[400px] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[400px]">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{fileName} <span className="text-xs text-muted-foreground">(PDF attachment)</span></p>
      </div>
      {pdfUrl ? <PdfViewer url={pdfUrl} /> : <p className="text-sm text-muted-foreground">Could not load PDF attachment</p>}
      {emlPreviewUrl && !error && (
        <div className="mt-3 text-right">
          <Button variant="ghost" size="sm" onClick={() => window.open(emlPreviewUrl, "_blank")}>
            <Eye className="h-3 w-3 mr-1" /> Download Original EML
          </Button>
        </div>
      )}
    </div>
  );
}

function EmlImagePreview({ imgPath, fileName, emlPreviewUrl, error }: { imgPath: string; fileName: string | null; emlPreviewUrl: string | null; error: boolean }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getFilePreviewUrl(imgPath)
      .then((url) => { setImgUrl(url); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, [imgPath]);

  if (loading) {
    return (
      <div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[400px] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[400px]">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{fileName} <span className="text-xs text-muted-foreground">(Image attachment)</span></p>
      </div>
      {imgUrl ? (
        <ZoomablePreview>
          <div className="p-4 flex items-center justify-center min-h-[300px]">
            <img src={imgUrl} alt="Email attachment" className="max-w-full object-contain" />
          </div>
        </ZoomablePreview>
      ) : (
        <p className="text-sm text-muted-foreground">Could not load image attachment</p>
      )}
      {emlPreviewUrl && !error && (
        <div className="mt-3 text-right">
          <Button variant="ghost" size="sm" onClick={() => window.open(emlPreviewUrl, "_blank")}>
            <Eye className="h-3 w-3 mr-1" /> Download Original EML
          </Button>
        </div>
      )}
    </div>
  );
}

function EmailPreview({ raw }: { raw: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(500);

  const getHtmlContent = (text: string): string => {
    const trimmed = text.trimStart();
    if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return text;
    if (/<body[\s>]/i.test(text) && (/<table[\s>]/i.test(text) || /<div[\s>]/i.test(text))) return text;
    const parts = text.split(/--[\w\-\.]+/);
    for (const part of parts) {
      if (!/content-type:\s*text\/html/i.test(part)) continue;
      const encodingMatch = part.match(/content-transfer-encoding:\s*(\S+)/i);
      const encoding = encodingMatch?.[1]?.toLowerCase() || "7bit";
      const blankLine = part.indexOf("\r\n\r\n");
      const blankLine2 = part.indexOf("\n\n");
      const bodyStart = blankLine > 0 ? blankLine + 4 : (blankLine2 > 0 ? blankLine2 + 2 : -1);
      if (bodyStart < 0) continue;
      let body = part.substring(bodyStart).trim();
      if (encoding === "base64") {
        try { body = atob(body.replace(/\s/g, "")); } catch { continue; }
      } else if (encoding === "quoted-printable") {
        body = body
          .replace(/=\r?\n/g, "")
          .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      }
      if (body.length > 50) return body;
    }
    const stripped = text.replace(/^[\s\S]*?\n\n/, "");
    return `<html><body style="font-family:sans-serif;padding:16px;font-size:14px;white-space:pre-wrap;background:#fff;color:#333">${stripped.substring(0, 10000).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</body></html>`;
  };

  useEffect(() => {
    if (!iframeRef.current) return;
    const htmlContent = getHtmlContent(raw);
    const doc = iframeRef.current.contentDocument;
    if (doc) {
      doc.open();
      doc.write(htmlContent);
      doc.close();
      setTimeout(() => {
        try {
          const h = doc.documentElement?.scrollHeight || doc.body?.scrollHeight;
          if (h && h > 100) setIframeHeight(Math.min(h + 20, 900));
        } catch { /* cross-origin safety */ }
      }, 200);
    }
  }, [raw]);

  return (
    <div>
      <iframe
        ref={iframeRef}
        title="Email preview"
        sandbox="allow-same-origin"
        className="w-full rounded-md border border-border bg-white"
        style={{ height: `${iframeHeight}px`, minHeight: "400px" }}
      />
    </div>
  );
}

function FieldRow({ label, value, confidence, required, readOnly, onChange, badge }: {
  label: string; value: string; confidence: number; required?: boolean; readOnly?: boolean; onChange?: (v: string) => void; badge?: React.ReactNode;
}) {
  const isLow = confidence < 0.8;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">{label}{required && <span className="text-vault-red ml-0.5">*</span>}</label>
          {badge}
        </div>
        <ConfidenceBadge score={confidence} />
      </div>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        className={`w-full h-9 rounded-md border px-3 text-sm font-medium transition-colors
          ${readOnly ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-background text-foreground"}
          ${isLow && !readOnly ? "border-vault-amber ring-1 ring-vault-amber/30" : "border-input"}
          focus:outline-none focus:ring-2 focus:ring-ring`}
      />
    </div>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  if (pct >= 90) return <span className="vault-badge-success vault-mono text-[10px]">{pct}%</span>;
  if (pct >= 75) return <span className="vault-badge-warning vault-mono text-[10px]">{pct}%</span>;
  return <span className="vault-badge-error vault-mono text-[10px]">{pct}%</span>;
}

// TenantStatusBadge and ChargeTypeBadge are now imported from @/components/StatusBadges
