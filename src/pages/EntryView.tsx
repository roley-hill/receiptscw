import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchReceipts, markAppfolioRecorded, getFilePreviewUrl, createDepositBatch } from "@/lib/api";
import { motion } from "framer-motion";
import { Copy, Check, FileText, Layers, Loader2, ChevronRight, ChevronDown, Building2, Search, User, AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DbReceipt } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FilePreviewOverlay, AttachmentContent } from "@/components/FilePreview";
import { useAdminDelete } from "@/hooks/useAdminDelete";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";


/* ─── Inline copy button with tooltip ─── */
function CopyCell({ value, mono, id }: { value: string; mono?: boolean; id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  if (!value || value === "—") return <span className={`text-sm text-muted-foreground ${mono ? "vault-mono" : ""}`}>—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={copy} className={`group flex items-center gap-1 text-sm text-left ${mono ? "vault-mono" : ""} text-foreground hover:text-accent transition-colors max-w-full`}>
          <span className="truncate max-w-[120px]">{value}</span>
          {copied ? <Check className="h-3 w-3 text-vault-emerald shrink-0" /> : <Copy className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs"><p className="text-xs whitespace-pre-wrap break-words">{value}</p></TooltipContent>
    </Tooltip>
  );
}

/* ─── Normalize address abbreviations for grouping ─── */
const ABBR_MAP: Record<string, string> = {
  " ave ": " avenue ", " ave,": " avenue,",
  " st ": " street ", " st,": " street,",
  " blvd ": " boulevard ", " blvd,": " boulevard,",
  " dr ": " drive ", " dr,": " drive,",
  " rd ": " road ", " rd,": " road,",
  " ln ": " lane ", " ln,": " lane,",
  " ct ": " court ", " ct,": " court,",
  " pl ": " place ", " pl,": " place,",
  " n ": " north ", " s ": " south ", " e ": " east ", " w ": " west ",
};

function normalizeAddress(addr: string): string {
  let s = " " + addr.toLowerCase().trim() + " ";
  for (const [abbr, full] of Object.entries(ABBR_MAP)) {
    // Replace only when the abbreviation appears as a word boundary
    s = s.split(abbr).join(full);
  }
  // Also handle trailing abbreviations (end of string before city/state)
  return s.trim();
}

// Map each raw property string to a canonical (normalized) key,
// and track the canonical display value (prefer longest/most complete form)
function buildCanonicalPropertyMap(receipts: DbReceipt[]): Map<string, string> {
  const normToCanonical = new Map<string, string>();
  for (const r of receipts) {
    if (!r.property) continue;
    const norm = normalizeAddress(r.property);
    const existing = normToCanonical.get(norm);
    // Prefer the longer string as the canonical display name (more complete)
    if (!existing || r.property.length > existing.length) {
      normToCanonical.set(norm, r.property);
    }
  }
  return normToCanonical;
}

/* ─── Main page ─── */
export default function EntryView() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { isAdmin, deleteMutation } = useAdminDelete();
  const { data: allReceipts = [], isLoading } = useQuery({ queryKey: ["receipts"], queryFn: fetchReceipts });

  const finalized = allReceipts.filter((r) => r.status === "finalized" && !r.batch_id);

  // Build canonical property map (merges Ave/Avenue etc.)
  const canonicalMap = buildCanonicalPropertyMap(finalized);
  // Resolve a receipt's property to its canonical form
  const canonical = (prop: string) => canonicalMap.get(normalizeAddress(prop)) ?? prop;

  const [selectedProperty, setSelectedProperty] = useState<string>("all");
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
  const [expandedProperties, setExpandedProperties] = useState<Set<string>>(new Set());
  const [treeSearch, setTreeSearch] = useState("");
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchProperty, setBatchProperty] = useState("");
  const [depositPeriod, setDepositPeriod] = useState("");
  const [previewReceipt, setPreviewReceipt] = useState<DbReceipt | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [expandedTableTenants, setExpandedTableTenants] = useState<Set<string>>(new Set());

  // Use canonical property names for all grouping
  const filteredProperties = [...new Set(finalized.map((r) => canonical(r.property)).filter(Boolean))];

  // Build tenant map per canonical property
  const tenantsByProperty = finalized.reduce((acc, r) => {
    if (!r.property) return acc;
    const prop = canonical(r.property);
    if (!acc[prop]) acc[prop] = {};
    const tenant = r.tenant || "(No Tenant)";
    if (!acc[prop][tenant]) acc[prop][tenant] = [];
    acc[prop][tenant].push(r);
    return acc;
  }, {} as Record<string, Record<string, DbReceipt[]>>);

  const filtered = selectedProperty === "all"
    ? (selectedTenant ? finalized.filter(r => (r.tenant || "(No Tenant)") === selectedTenant) : finalized)
    : selectedTenant
      ? finalized.filter(r => canonical(r.property) === selectedProperty && (r.tenant || "(No Tenant)") === selectedTenant)
      : finalized.filter(r => canonical(r.property) === selectedProperty);

  const togglePropertyExpand = (property: string) => {
    setExpandedProperties(prev => {
      const next = new Set(prev);
      if (next.has(property)) next.delete(property);
      else next.add(property);
      return next;
    });
  };

  const handleSelectProperty = (property: string) => {
    setSelectedProperty(property);
    setSelectedTenant(null);
    if (property !== "all") {
      setExpandedProperties(prev => new Set(prev).add(property));
    }
  };

  const handleSelectTenant = (property: string, tenant: string) => {
    setSelectedProperty(property);
    setSelectedTenant(tenant);
  };

  const flatGrouped = filtered.reduce((acc, r) => {
    const prop = canonical(r.property);
    if (!acc[prop]) acc[prop] = [];
    acc[prop].push(r);
    return acc;
  }, {} as Record<string, DbReceipt[]>);

  const grandTotal = filtered.reduce((sum, r) => sum + Number(r.amount), 0);
  const recordedReceipts = filtered.filter((r) => (r as any).appfolio_recorded);
  const recordedTotal = recordedReceipts.reduce((sum, r) => sum + Number(r.amount), 0);

  const toggleMutation = useMutation({
    mutationFn: ({ id, recorded }: { id: string; recorded: boolean }) => markAppfolioRecorded(id, recorded, user!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["receipts"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const batchMutation = useMutation({
    mutationFn: ({ property, ids, period }: { property: string; ids: string[]; period: string }) => createDepositBatch(property, ids, period, user!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      setBatchDialogOpen(false);
      toast({ title: "Deposit batch created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleViewAttachment = async (receipt: DbReceipt) => {
    if (!receipt.file_path) return;
    setPreviewReceipt(receipt);
    setPreviewLoading(true);
    setPreviewUrl(null);
    try { const url = await getFilePreviewUrl(receipt.file_path); setPreviewUrl(url); }
    catch { toast({ title: "Error", description: "Could not load attachment", variant: "destructive" }); setPreviewReceipt(null); }
    finally { setPreviewLoading(false); }
  };

  const closePreview = () => { setPreviewReceipt(null); setPreviewUrl(null); };
  

  const openBatchDialog = (property: string) => {
    const propertyRecorded = finalized.filter((r) => canonical(r.property) === property && (r as any).appfolio_recorded && !r.batch_id);
    if (propertyRecorded.length === 0) { toast({ title: "No eligible receipts", description: "Mark receipts as recorded in AppFolio first.", variant: "destructive" }); return; }
    setBatchProperty(property); setDepositPeriod(""); setBatchDialogOpen(true);
  };

  const handleCreateBatch = () => {
    const ids = finalized.filter((r) => canonical(r.property) === batchProperty && (r as any).appfolio_recorded && !r.batch_id).map((r) => r.id);
    if (ids.length === 0) return;
    batchMutation.mutate({ property: batchProperty, ids, period: depositPeriod });
  };

  const copyRowAll = (r: DbReceipt) => {
    const text = `${r.tenant}\t${Number(r.amount).toFixed(2)}\t${r.receipt_date || ""}\t${r.reference || ""}\t${r.memo || ""}\t${r.payment_type || ""}`;
    navigator.clipboard.writeText(text);
    toast({ title: "Copied all fields" });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (finalized.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h2 className="text-xl font-bold text-foreground">No Finalized Receipts</h2>
        <p className="text-sm text-muted-foreground mt-1">Review and finalize receipts first.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Floating Attachment Preview */}
      {previewReceipt && (
        <FilePreviewOverlay
          fileName={previewReceipt.file_name || "Attachment"}
          fileUrl={previewUrl}
          loading={previewLoading}
          originalText={previewReceipt.original_text}
          onClose={closePreview}
        />
      )}

      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">AppFolio Entry & Recording</h1>
        <p className="text-sm text-muted-foreground mt-1">Select a building, copy fields into AppFolio, mark as recorded, then create deposit batches.</p>
      </div>

      <div className="flex gap-4">
        {/* ─── Building Tree Sidebar ─── */}
        <div className="vault-card p-0 overflow-hidden w-[220px] shrink-0 self-start sticky top-4">
          <div className="px-3 py-3 border-b border-border bg-muted/30 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Buildings</h3>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filter buildings..."
                value={treeSearch}
                onChange={(e) => setTreeSearch(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <div className="divide-y divide-border max-h-[calc(100vh-260px)] overflow-auto">
            {!treeSearch && (
              <button
                onClick={() => { setSelectedProperty("all"); setSelectedTenant(null); }}
                className={`w-full flex items-center gap-2 px-4 py-3 text-sm transition-colors ${selectedProperty === "all" && !selectedTenant ? "bg-accent/10 text-accent font-semibold border-l-2 border-accent" : "text-foreground hover:bg-muted/50 border-l-2 border-transparent"}`}
              >
                <Building2 className="h-4 w-4 shrink-0" />
                <span>All Buildings</span>
                <span className="ml-auto text-xs vault-mono text-muted-foreground">{filteredProperties.length}</span>
              </button>
            )}
            {filteredProperties.sort().filter((p) => !treeSearch || p.toLowerCase().includes(treeSearch.toLowerCase())).map((property) => {
              const count = finalized.filter((r) => canonical(r.property) === property).length;
              const recCount = finalized.filter((r) => canonical(r.property) === property && (r as any).appfolio_recorded).length;
              const isExpanded = expandedProperties.has(property);
              const tenants = tenantsByProperty[property] || {};
              const tenantNames = Object.keys(tenants).sort();
              return (
                <div key={property}>
                  <button
                    onClick={() => { handleSelectProperty(property); togglePropertyExpand(property); }}
                    className={`w-full flex items-center gap-2 px-4 py-3 text-sm transition-colors ${selectedProperty === property && !selectedTenant ? "bg-accent/10 text-accent font-semibold border-l-2 border-accent" : "text-foreground hover:bg-muted/50 border-l-2 border-transparent"}`}
                  >
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform" />}
                    <span className="truncate text-left flex-1">{property}</span>
                    <span className="text-xs vault-mono text-muted-foreground shrink-0">{recCount}/{count}</span>
                  </button>
                  {isExpanded && tenantNames.map((tenant) => {
                    const tReceipts = tenants[tenant];
                    const tCount = tReceipts.length;
                    const hasDuplicateRisk = tCount > 1;
                    const isSelected = selectedProperty === property && selectedTenant === tenant;
                    return (
                      <button
                        key={tenant}
                        onClick={() => handleSelectTenant(property, tenant)}
                        className={`w-full flex items-center gap-2 pl-9 pr-4 py-2 text-xs transition-colors ${isSelected ? "bg-accent/10 text-accent font-semibold border-l-2 border-accent" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-l-2 border-transparent"}`}
                      >
                        <User className="h-3 w-3 shrink-0" />
                        <span className="truncate text-left flex-1">{tenant}</span>
                        <span className={`text-xs vault-mono shrink-0 ${hasDuplicateRisk ? "text-[hsl(var(--vault-amber))] font-bold" : ""}`}>{tCount}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* ─── Main Content ─── */}
        <div className="flex-1 min-w-0 space-y-4">
          {Object.keys(flatGrouped).length === 0 ? (
            <div className="vault-card p-8 text-center text-muted-foreground text-sm">No finalized receipts.</div>
          ) : (
            Object.entries(flatGrouped).map(([property, receipts]) => {
              const subtotal = receipts.reduce((s, r) => s + Number(r.amount), 0);
              const recorded = receipts.filter((r) => (r as any).appfolio_recorded);
              const recordedAmt = recorded.reduce((s, r) => s + Number(r.amount), 0);
              const unbatched = recorded.filter((r) => !r.batch_id);
              return (
                <motion.div key={property} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="vault-card overflow-hidden">
                  <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-foreground">{property}</h3>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-muted-foreground">{recorded.length}/{receipts.length} recorded</span>
                      <span className="vault-mono font-bold text-foreground">${subtotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                      <Button variant="default" size="sm" onClick={() => openBatchDialog(property)} disabled={unbatched.length === 0}>
                        <Layers className="h-3.5 w-3.5 mr-1" /> Create Batch ({unbatched.length})
                      </Button>
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
                    <table className="w-full min-w-[1200px]">
                      <thead className="sticky top-0 z-10 bg-card">
                        <tr className="border-b border-border">
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-10">Recorded in PM Software?</th>
                          <th className="px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[40px]">Doc</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[70px]">Unit</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[140px]">Tenant</th>
                          <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[100px]">Amount</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[100px]">Date</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[80px]">Month</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[90px]">Pay Type</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[100px]">Reference</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[120px]">Subsidy</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[140px]">Memo</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[100px]">Receipt ID</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[80px]">Transfer</th>
                          <th className="px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[60px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          // Group receipts by tenant
                          const tenantGroups: Record<string, DbReceipt[]> = {};
                          for (const r of receipts) {
                            const key = r.tenant || "(No Tenant)";
                            if (!tenantGroups[key]) tenantGroups[key] = [];
                            tenantGroups[key].push(r);
                          }
                          // Sort tenants, then sort receipts within each group
                          const sortedTenants = Object.keys(tenantGroups).sort();

                          return sortedTenants.flatMap((tenant): React.ReactElement[] => {
                            const group = tenantGroups[tenant].sort((a, b) => (a.unit || "").localeCompare(b.unit || ""));
                            const tenantKey = `${property}::${tenant}`;
                            const isMulti = group.length > 1;
                            const isOpen = expandedTableTenants.has(tenantKey);

                            // Detect same-month duplicates within this tenant
                            const monthCounts: Record<string, number> = {};
                            for (const r of group) {
                              const m = r.rent_month || "none";
                              monthCounts[m] = (monthCounts[m] || 0) + 1;
                            }
                            const hasSameMonthDups = Object.values(monthCounts).some((c) => c > 1);

                            if (!isMulti) {
                              // Single receipt for this tenant — render directly
                              const r = group[0];
                              return [(
                                <tr key={r.id} className="vault-table-row">
                                  <td className="px-3 py-2.5">
                                    <Checkbox checked={(r as any).appfolio_recorded || false} onCheckedChange={(checked) => toggleMutation.mutate({ id: r.id, recorded: !!checked })} disabled={toggleMutation.isPending} />
                                  </td>
                                  <td className="px-3 py-2.5 text-center">
                                    {r.file_path && (<Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleViewAttachment(r)}><FileText className="h-3.5 w-3.5 text-vault-blue" /></Button></TooltipTrigger><TooltipContent>View document</TooltipContent></Tooltip>)}
                                  </td>
                                  <td className="px-3 py-2.5"><CopyCell value={r.unit} mono id={`unit-${r.id}`} /></td>
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-1.5">
                                      <CopyCell value={r.tenant} id={`tenant-${r.id}`} />
                                      {Number(r.amount) < 0 && <span className="vault-badge-deduction">Deduction</span>}
                                    </div>
                                  </td>
                                  <td className={`px-3 py-2.5 text-right ${Number(r.amount) < 0 ? "text-[hsl(var(--vault-red))]" : ""}`}><CopyCell value={`$${Number(r.amount).toFixed(2)}`} mono id={`amt-${r.id}`} /></td>
                                  <td className="px-3 py-2.5"><CopyCell value={r.receipt_date || "—"} mono id={`date-${r.id}`} /></td>
                                  <td className="px-3 py-2.5"><CopyCell value={r.rent_month || "—"} mono id={`month-${r.id}`} /></td>
                                  <td className="px-3 py-2.5"><CopyCell value={r.payment_type || "—"} id={`ptype-${r.id}`} /></td>
                                  <td className="px-3 py-2.5"><CopyCell value={r.reference || "—"} mono id={`ref-${r.id}`} /></td>
                                  <td className="px-3 py-2.5"><CopyCell value={r.subsidy_provider || "—"} id={`sub-${r.id}`} /></td>
                                  <td className="px-3 py-2.5"><CopyCell value={r.memo || "—"} id={`memo-${r.id}`} /></td>
                                  <td className="px-3 py-2.5 text-xs vault-mono text-vault-blue">{r.receipt_id}</td>
                                  <td className="px-3 py-2.5">{r.transfer_status === "transferred" ? <span className="vault-badge-success">Transferred</span> : <span className="vault-badge-neutral">Pending</span>}</td>
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-center justify-center gap-1">
                                      <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => copyRowAll(r)}><Copy className="h-3.5 w-3.5 text-muted-foreground" /></Button></TooltipTrigger><TooltipContent>Copy all fields</TooltipContent></Tooltip>
                                      {isAdmin && (
                                        <AlertDialog>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                                              </AlertDialogTrigger>
                                            </TooltipTrigger>
                                            <TooltipContent>Delete receipt</TooltipContent>
                                          </Tooltip>
                                          <AlertDialogContent>
                                            <AlertDialogHeader><AlertDialogTitle>Delete this receipt?</AlertDialogTitle><AlertDialogDescription>This will permanently remove {r.receipt_id}.</AlertDialogDescription></AlertDialogHeader>
                                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteMutation.mutate(r.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter>
                                          </AlertDialogContent>
                                        </AlertDialog>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )];
                            }

                            // Multi-receipt tenant — collapsible group
                            const tenantTotal = group.reduce((s, r) => s + Number(r.amount), 0);
                            const rows: React.ReactElement[] = [];

                            // Tenant header row
                            rows.push(
                              <tr
                                key={`tenant-header-${tenantKey}`}
                                className="cursor-pointer hover:bg-muted/50 transition-colors border-b border-border"
                                onClick={() => setExpandedTableTenants(prev => {
                                  const next = new Set(prev);
                                  if (next.has(tenantKey)) next.delete(tenantKey);
                                  else next.add(tenantKey);
                                  return next;
                                })}
                              >
                                <td className="px-3 py-2.5" colSpan={2}>
                                  <div className="flex items-center gap-1.5">
                                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                  </div>
                                </td>
                                <td className="px-3 py-2.5">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-foreground">{tenant}</span>
                                    <span className="text-xs vault-mono text-muted-foreground bg-muted rounded-full px-2 py-0.5">{group.length} receipts</span>
                                    {hasSameMonthDups && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="flex items-center gap-1 text-xs font-semibold text-[hsl(var(--vault-amber))] bg-[hsl(var(--vault-amber)/0.1)] rounded-full px-2 py-0.5">
                                            <AlertTriangle className="h-3 w-3" /> Dup risk
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent>Multiple receipts for the same rent month — verify these are not duplicates</TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 text-right text-sm vault-mono font-semibold text-foreground">${tenantTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                                <td colSpan={9}></td>
                              </tr>
                            );

                            // Child receipt rows (shown when expanded)
                            if (isOpen) {
                              for (const r of group) {
                                const isDupMonth = monthCounts[r.rent_month || "none"] > 1;
                                rows.push(
                                  <tr key={r.id} className={`vault-table-row ${isDupMonth ? "bg-[hsl(var(--vault-amber)/0.05)]" : ""}`}>
                                    <td className="px-3 py-2.5">
                                      <Checkbox checked={(r as any).appfolio_recorded || false} onCheckedChange={(checked) => toggleMutation.mutate({ id: r.id, recorded: !!checked })} disabled={toggleMutation.isPending} />
                                    </td>
                                    <td className="px-3 py-2.5 text-center">
                                      {r.file_path && (<Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleViewAttachment(r)}><FileText className="h-3.5 w-3.5 text-vault-blue" /></Button></TooltipTrigger><TooltipContent>View document</TooltipContent></Tooltip>)}
                                    </td>
                                    <td className="px-3 py-2.5"><CopyCell value={r.unit} mono id={`unit-${r.id}`} /></td>
                                    <td className="px-3 py-2.5">
                                      <div className="flex items-center gap-1.5 pl-4">
                                        <CopyCell value={r.tenant} id={`tenant-${r.id}`} />
                                        {Number(r.amount) < 0 && <span className="vault-badge-deduction">Deduction</span>}
                                        {isDupMonth && <AlertTriangle className="h-3 w-3 text-[hsl(var(--vault-amber))] shrink-0" />}
                                      </div>
                                    </td>
                                    <td className={`px-3 py-2.5 text-right ${Number(r.amount) < 0 ? "text-[hsl(var(--vault-red))]" : ""}`}><CopyCell value={`$${Number(r.amount).toFixed(2)}`} mono id={`amt-${r.id}`} /></td>
                                    <td className="px-3 py-2.5"><CopyCell value={r.receipt_date || "—"} mono id={`date-${r.id}`} /></td>
                                    <td className={`px-3 py-2.5 ${isDupMonth ? "font-semibold" : ""}`}><CopyCell value={r.rent_month || "—"} mono id={`month-${r.id}`} /></td>
                                    <td className="px-3 py-2.5"><CopyCell value={r.payment_type || "—"} id={`ptype-${r.id}`} /></td>
                                    <td className="px-3 py-2.5"><CopyCell value={r.reference || "—"} mono id={`ref-${r.id}`} /></td>
                                    <td className="px-3 py-2.5"><CopyCell value={r.subsidy_provider || "—"} id={`sub-${r.id}`} /></td>
                                    <td className="px-3 py-2.5"><CopyCell value={r.memo || "—"} id={`memo-${r.id}`} /></td>
                                    <td className="px-3 py-2.5 text-xs vault-mono text-vault-blue">{r.receipt_id}</td>
                                    <td className="px-3 py-2.5">{r.transfer_status === "transferred" ? <span className="vault-badge-success">Transferred</span> : <span className="vault-badge-neutral">Pending</span>}</td>
                                    <td className="px-3 py-2.5">
                                      <div className="flex items-center justify-center gap-1">
                                        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => copyRowAll(r)}><Copy className="h-3.5 w-3.5 text-muted-foreground" /></Button></TooltipTrigger><TooltipContent>Copy all fields</TooltipContent></Tooltip>
                                        {isAdmin && (
                                          <AlertDialog>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <AlertDialogTrigger asChild>
                                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                                                </AlertDialogTrigger>
                                              </TooltipTrigger>
                                              <TooltipContent>Delete receipt</TooltipContent>
                                            </Tooltip>
                                            <AlertDialogContent>
                                              <AlertDialogHeader><AlertDialogTitle>Delete this receipt?</AlertDialogTitle><AlertDialogDescription>This will permanently remove {r.receipt_id}.</AlertDialogDescription></AlertDialogHeader>
                                              <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteMutation.mutate(r.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter>
                                            </AlertDialogContent>
                                          </AlertDialog>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              }
                            }
                            return rows;
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-3 border-t border-border bg-muted/20 flex items-center justify-between text-xs">
                    <div className="flex gap-6">
                      <span className="text-muted-foreground">Recorded: <span className="vault-mono font-medium text-foreground">${recordedAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></span>
                      <span className="text-muted-foreground">Unrecorded: <span className="vault-mono font-medium text-foreground">${(subtotal - recordedAmt).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></span>
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
                <span className="text-sm text-muted-foreground">{recordedReceipts.length}/{filtered.length} recorded</span>
                <span className="text-sm text-muted-foreground">Recorded: <span className="vault-mono font-bold text-foreground">${recordedTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></span>
                <span className="text-lg vault-mono font-bold text-foreground">${grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Deposit Batch — {batchProperty}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">This will batch {finalized.filter((r) => r.property === batchProperty && (r as any).appfolio_recorded && !r.batch_id).length} recorded, unbatched receipts for <strong>{batchProperty}</strong>.</p>
            <div><Label htmlFor="depositPeriod">Deposit Period</Label><Input id="depositPeriod" placeholder="e.g. Feb 2026" value={depositPeriod} onChange={(e) => setDepositPeriod(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateBatch} disabled={batchMutation.isPending}><Layers className="h-4 w-4 mr-2" /> Create Batch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
