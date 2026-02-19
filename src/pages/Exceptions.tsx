import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchReceipts, updateReceipt } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, Trash2, FileText, ChevronDown, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { TenantStatusBadge, ChargeTypeBadge } from "@/components/StatusBadges";
import TenantSuggestion from "@/components/TenantSuggestion";

export default function Exceptions() {
  const { data: allReceipts = [], isLoading } = useQuery({
    queryKey: ["receipts"],
    queryFn: fetchReceipts,
  });
  const queryClient = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const exceptions = allReceipts.filter((r) => r.status === "exception");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [fileFilter, setFileFilter] = useState<string>("all");

  // Group by file_name for the filter dropdown
  const fileGroups = useMemo(() => {
    const groups: Record<string, number> = {};
    for (const r of exceptions) {
      const name = r.file_name || "No file";
      groups[name] = (groups[name] || 0) + 1;
    }
    return Object.entries(groups).sort((a, b) => b[1] - a[1]);
  }, [exceptions]);

  const filteredExceptions = useMemo(
    () => fileFilter === "all"
      ? exceptions
      : exceptions.filter((r) => (r.file_name || "No file") === fileFilter),
    [exceptions, fileFilter]
  );

  const allSelected = filteredExceptions.length > 0 && filteredExceptions.every((r) => selected.has(r.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredExceptions.map((r) => r.id)));
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      const ids = Array.from(selected);
      // Supabase .in() has a limit, batch in chunks of 100
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
      const idsToDelete = exceptions
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
      const idsToFinalize = exceptions
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Exceptions Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">Receipts missing critical fields. Fix before batching.</p>
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
                          This will mark the selected receipts as finalized and move them into entry & recording, even with missing or low-confidence fields.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleBulkFinalize}>
                          Finalize
                        </AlertDialogAction>
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

      {/* File filter + per-file delete */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <Select value={fileFilter} onValueChange={setFileFilter}>
            <SelectTrigger className="w-[320px] h-9 text-sm">
              <SelectValue placeholder="Filter by file" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All files ({exceptions.length})</SelectItem>
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
                  Finalize all from this file ({filteredExceptions.length})
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Finalize all {filteredExceptions.length} receipt(s) from this file?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will mark all exception receipts from "{fileFilter.replace(/^Receipts\//, "")}" as finalized, even with missing or low-confidence fields.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleFinalizeByFile(fileFilter)}>
                    Finalize All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deleting}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete all from this file ({filteredExceptions.length})
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete all {filteredExceptions.length} receipt(s) from this file?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove all receipts extracted from "{fileFilter.replace(/^Receipts\//, "")}". You can then re-upload the file for clean extraction.
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

      <div className="space-y-3">
        {filteredExceptions.map((r, i) => {
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
                  {isAdmin && (
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={() => toggle(r.id)}
                      className="mt-1"
                    />
                  )}
                  <div className="h-9 w-9 rounded-lg bg-vault-red-light flex items-center justify-center mt-0.5">
                    <AlertTriangle className="h-4 w-4 text-vault-red" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-foreground">{r.tenant || "Unknown Tenant"}</h3>
                      <span className="vault-mono text-xs text-muted-foreground">{r.receipt_id}</span>
                      {conf.tenantStatus && <TenantStatusBadge status={conf.tenantStatus} />}
                      {conf.chargeType && <ChargeTypeBadge chargeType={conf.chargeType} />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.property || "Unknown Property"} · Unit {r.unit || "?"} · {r.file_name || "No file"}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {issues.map((issue) => <span key={issue} className="vault-badge-error text-[10px]">{issue}</span>)}
                    </div>
                    <div className="mt-2">
                      <TenantSuggestion
                        property={r.property}
                        unit={r.unit}
                        extractedTenant={r.tenant}
                        onAccept={async ({ name, property, unit }) => {
                          try {
                            await updateReceipt(r.id, { tenant: name, property, unit });
                            toast.success(`Updated tenant to ${name}`);
                            queryClient.invalidateQueries({ queryKey: ["receipts"] });
                          } catch (err: any) {
                            toast.error(err.message || "Update failed");
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
                <Link to={`/review?receiptId=${r.id}`}>
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
