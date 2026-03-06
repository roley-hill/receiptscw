import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2, Clock, Eye, PackageOpen, FileText as FileTextIcon,
  FileSpreadsheet, Mail, Undo2, ArrowRightLeft, SquareCheck, Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { DbReceipt, DbDepositBatch } from "@/lib/api";

interface BatchCardProps {
  batch: DbDepositBatch;
  receipts: DbReceipt[];
  index: number;
  isZipping: boolean;
  onPreview: () => void;
  onZipDownload: () => void;
  onPdfDownload: () => void;
  onXlsxDownload: () => void;
  onReverse: () => void;
  onMoveReceipts: (receiptIds: string[]) => void;
  isMoving: boolean;
  hideActions?: boolean;
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

function formatRentMonth(rm: string | null): string {
  if (!rm) return "No Month Assigned";
  const [year, month] = rm.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

export default function BatchCard({
  batch, receipts, index, isZipping,
  onPreview, onZipDownload, onPdfDownload, onXlsxDownload, onReverse,
  onMoveReceipts, isMoving, hideActions = false,
}: BatchCardProps) {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const grossTotal = receipts.filter((r) => Number(r.amount) >= 0).reduce((s, r) => s + Number(r.amount), 0);
  const deductionTotal = receipts.filter((r) => Number(r.amount) < 0).reduce((s, r) => s + Number(r.amount), 0);
  const netTotal = grossTotal + deductionTotal;
  const hasDeductions = deductionTotal < 0;

  // Group receipts by rent_month, sorted newest first
  const monthGroups = useMemo(() => {
    const groups: Record<string, DbReceipt[]> = {};
    for (const r of receipts) {
      const key = r.rent_month || "__none__";
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === "__none__") return 1;
      if (b === "__none__") return -1;
      return b.localeCompare(a); // newest first
    });
  }, [receipts]);

  const hasMultipleMonths = monthGroups.length > 1;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === receipts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(receipts.map((r) => r.id)));
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const selectedTotal = receipts
    .filter((r) => selectedIds.has(r.id))
    .reduce((s, r) => s + Number(r.amount), 0);

  const renderReceiptRow = (r: DbReceipt) => {
    const isSelected = selectedIds.has(r.id);
    return (
      <tr
        key={r.id}
        className={`vault-table-row ${selectMode ? "cursor-pointer" : ""} ${isSelected ? "bg-accent/40" : ""}`}
        onClick={selectMode ? () => toggleSelect(r.id) : undefined}
      >
        {selectMode && (
          <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleSelect(r.id)}
            />
          </td>
        )}
        <td className="px-5 py-2.5 text-sm font-medium text-foreground">{r.tenant}</td>
        <td className="px-5 py-2.5 text-sm vault-mono text-muted-foreground">{r.unit}</td>
        <td className={`px-5 py-2.5 text-sm text-right vault-mono font-semibold ${Number(r.amount) < 0 ? "text-[hsl(var(--vault-red))]" : "text-foreground"}`}>
          ${Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </td>
        <td className="px-5 py-2.5">{Number(r.amount) < 0 ? <span className="vault-badge-deduction">Deduction</span> : <span className="text-xs text-muted-foreground">Payment</span>}</td>
        <td className="px-5 py-2.5 text-xs text-muted-foreground">{r.subsidy_provider || "—"}</td>
        <td className="px-5 py-2.5 text-xs vault-mono text-vault-blue">{r.receipt_id}</td>
      </tr>
    );
  };

  return (
    <motion.div key={batch.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="vault-card overflow-hidden">
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
          {!hideActions && (
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={onPreview} title="Preview all documents">
                <Eye className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="sm" onClick={onZipDownload} disabled={isZipping} title="Download deposit package (ZIP)">
                {isZipping ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <PackageOpen className="h-3.5 w-3.5" />}
              </Button>
              <Button variant="outline" size="sm" onClick={onPdfDownload} title="Download PDF report">
                <FileTextIcon className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="sm" onClick={onXlsxDownload} title="Download XLSX report">
                <FileSpreadsheet className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="sm" title="Email report">
                <Mail className="h-3.5 w-3.5" />
              </Button>
              {receipts.length > 0 && batch.status !== "reversed" && (
                <Button
                  variant={selectMode ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
                  title={selectMode ? "Cancel selection" : "Select receipts to move"}
                >
                  <SquareCheck className="h-3.5 w-3.5" />
                </Button>
              )}
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
                      <AlertDialogAction onClick={onReverse} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Reverse Batch
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Select mode action bar */}
      {selectMode && (
        <div className="px-5 py-3 border-t border-border bg-accent/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm text-foreground font-medium">
              {selectedIds.size} of {receipts.length} selected
            </span>
            {selectedIds.size > 0 && (
              <span className="text-sm vault-mono text-muted-foreground">
                (${selectedTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })})
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={exitSelectMode}>Cancel</Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="default" size="sm" disabled={selectedIds.size === 0 || isMoving}>
                  {isMoving ? (
                    <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                  ) : (
                    <ArrowRightLeft className="h-3.5 w-3.5 mr-2" />
                  )}
                  Move to New Batch
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Move {selectedIds.size} receipt{selectedIds.size !== 1 ? "s" : ""} to a new batch?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will create a new draft deposit batch for <strong>{batch.property}</strong> containing the {selectedIds.size} selected receipt{selectedIds.size !== 1 ? "s" : ""} totaling <strong>${selectedTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>.
                    The original batch ({batch.batch_id}) will be updated to reflect the remaining receipts.
                    {selectedIds.size === receipts.length && " Since all receipts are being moved, the original batch will be marked as reversed."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onMoveReceipts(Array.from(selectedIds))}>
                    Move Receipts
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}

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
                {selectMode && (
                  <th className="px-3 py-2 w-10">
                    <Checkbox
                      checked={selectedIds.size === receipts.length && receipts.length > 0}
                      onCheckedChange={toggleAll}
                    />
                  </th>
                )}
                <th className="px-5 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tenant</th>
                <th className="px-5 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unit</th>
                <th className="px-5 py-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                <th className="px-5 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type</th>
                <th className="px-5 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subsidy</th>
                <th className="px-5 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt ID</th>
              </tr>
            </thead>
            <tbody>
              {hasMultipleMonths
                ? monthGroups.map(([monthKey, monthReceipts]) => {
                    const monthTotal = monthReceipts.reduce((s, r) => s + Number(r.amount), 0);
                    return (
                      <>
                        <tr key={`month-${monthKey}`} className="bg-muted/15">
                          <td colSpan={selectMode ? 7 : 6} className="px-5 py-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Calendar className="h-3.5 w-3.5 text-accent" />
                                <span className="text-xs font-semibold text-foreground">{formatRentMonth(monthKey === "__none__" ? null : monthKey)}</span>
                                <span className="text-xs text-muted-foreground">· {monthReceipts.length} receipt{monthReceipts.length !== 1 ? "s" : ""}</span>
                              </div>
                              <span className="text-xs vault-mono font-semibold text-foreground">${monthTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                            </div>
                          </td>
                        </tr>
                        {monthReceipts.map(renderReceiptRow)}
                      </>
                    );
                  })
                : receipts.map(renderReceiptRow)
              }
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
}
