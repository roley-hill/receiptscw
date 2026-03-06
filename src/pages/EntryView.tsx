import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchReceipts, markAppfolioRecorded, getFilePreviewUrl, createDepositBatch } from "@/lib/api";
import { motion } from "framer-motion";
import { Copy, Check, FileText, Layers, Loader2, ChevronRight, ChevronDown, Building2, Search, User, AlertTriangle, Trash2, CheckSquare, Square, Calendar } from "lucide-react";
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
const ABBR_MAP: [RegExp, string][] = [
  [/\bave\b/gi, "avenue"],
  [/\bst\b/gi, "street"],
  [/\bblvd\b/gi, "boulevard"],
  [/\bdr\b/gi, "drive"],
  [/\brd\b/gi, "road"],
  [/\bln\b/gi, "lane"],
  [/\bct\b/gi, "court"],
  [/\bpl\b/gi, "place"],
  [/\bpkwy\b/gi, "parkway"],
  [/\bhwy\b/gi, "highway"],
  [/\bn\b/gi, "north"],
  [/\bs\b/gi, "south"],
  [/\be\b/gi, "east"],
  [/\bw\b/gi, "west"],
];

function normalizeAddress(addr: string): string {
  let s = addr.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of ABBR_MAP) {
    s = s.replace(pattern, replacement);
  }
  return s.replace(/\s+/g, " ").trim();
}

function buildCanonicalPropertyMap(receipts: DbReceipt[]): Map<string, string> {
  const normToCanonical = new Map<string, string>();
  for (const r of receipts) {
    if (!r.property) continue;
    const norm = normalizeAddress(r.property);
    const existing = normToCanonical.get(norm);
    if (!existing || r.property.length > existing.length) {
      normToCanonical.set(norm, r.property);
    }
  }
  return normToCanonical;
}

type OwnerEntity = { id: string; name: string };
type PropertyRecord = { id: string; address: string; normalized_address: string; ownership_entity_id: string | null };

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });

/** Format YYYY-MM rent_month to readable label */
function formatRentMonth(rm: string | null): string {
  if (!rm) return "No Month Assigned";
  const [year, month] = rm.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

/** Sort rent months newest first; null goes last */
function sortRentMonths(a: string, b: string): number {
  if (a === "__none__") return 1;
  if (b === "__none__") return -1;
  return b.localeCompare(a);
}

/* ─── Main page ─── */
export default function EntryView() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { isAdmin, deleteMutation } = useAdminDelete();
  const { data: allReceipts = [], isLoading } = useQuery({ queryKey: ["receipts"], queryFn: fetchReceipts });

  const { data: ownerEntities = [] } = useQuery({
    queryKey: ["ownership_entities"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ownership_entities").select("*").order("name");
      if (error) throw error;
      return data as OwnerEntity[];
    },
  });

  const { data: dbProperties = [] } = useQuery({
    queryKey: ["properties"],
    queryFn: async () => {
      const { data, error } = await supabase.from("properties").select("*").order("address");
      if (error) throw error;
      return data as PropertyRecord[];
    },
  });

  const finalized = allReceipts.filter((r) => r.status === "finalized" && !r.batch_id);
  const canonicalMap = buildCanonicalPropertyMap(finalized);
  const canonical = (prop: string) => canonicalMap.get(normalizeAddress(prop)) ?? prop;

  // Map canonical property names to their ownership entity
  const propertyToEntity = useMemo(() => {
    const map = new Map<string, string | null>(); // canonical property → entity id
    for (const p of dbProperties) {
      const norm = p.normalized_address;
      // Find matching canonical property
      for (const [normKey, canonName] of canonicalMap.entries()) {
        if (normKey.startsWith(norm) || norm.startsWith(normKey) ||
            normalizeAddress(p.address) === normKey ||
            canonName.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim().startsWith(norm)) {
          map.set(canonName, p.ownership_entity_id);
        }
      }
      // Direct address match
      map.set(p.address, p.ownership_entity_id);
    }
    return map;
  }, [dbProperties, canonicalMap]);

  const [selectedProperty, setSelectedProperty] = useState<string>("all");
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(new Set());
  const [expandedProperties, setExpandedProperties] = useState<Set<string>>(new Set());
  const [treeSearch, setTreeSearch] = useState("");
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchProperty, setBatchProperty] = useState("");
  const [depositPeriod, setDepositPeriod] = useState("");
  const [previewReceipt, setPreviewReceipt] = useState<DbReceipt | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [expandedTableTenants, setExpandedTableTenants] = useState<Set<string>>(new Set());

  // Selection state for batch creation
  const [selectedReceipts, setSelectedReceipts] = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode] = useState(false);
  const [groupedBatchDialogOpen, setGroupedBatchDialogOpen] = useState(false);
  const [batchCreationType, setBatchCreationType] = useState<"individual" | "grouped">("individual");
  const [isBatchCreating, setIsBatchCreating] = useState(false);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());

  const filteredProperties = [...new Set(finalized.map((r) => canonical(r.property)).filter(Boolean))];

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

  // Group properties by ownership entity
  const entityGroups = useMemo(() => {
    const groups: Record<string, string[]> = {}; // entityId → property names
    const unassigned: string[] = [];

    for (const prop of filteredProperties) {
      const entityId = propertyToEntity.get(prop);
      if (entityId) {
        if (!groups[entityId]) groups[entityId] = [];
        groups[entityId].push(prop);
      } else {
        unassigned.push(prop);
      }
    }

    return { groups, unassigned };
  }, [filteredProperties, propertyToEntity]);

  const togglePropertyExpand = (property: string) => {
    setExpandedProperties(prev => {
      const next = new Set(prev);
      if (next.has(property)) next.delete(property);
      else next.add(property);
      return next;
    });
  };

  const toggleEntityExpand = (entityId: string) => {
    setExpandedEntities(prev => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
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

  // ─── Selection helpers ───
  const getPropertyReceipts = (property: string) =>
    finalized.filter(r => canonical(r.property) === property && (r as any).appfolio_recorded && !r.batch_id);

  const getEntityReceipts = (entityId: string) => {
    const props = entityGroups.groups[entityId] || [];
    return props.flatMap(getPropertyReceipts);
  };

  const toggleSelectProperty = (property: string) => {
    const receipts = getPropertyReceipts(property);
    const allSelected = receipts.every(r => selectedReceipts.has(r.id));
    setSelectedReceipts(prev => {
      const next = new Set(prev);
      for (const r of receipts) {
        allSelected ? next.delete(r.id) : next.add(r.id);
      }
      return next;
    });
  };

  const toggleSelectEntity = (entityId: string) => {
    const receipts = getEntityReceipts(entityId);
    const allSelected = receipts.length > 0 && receipts.every(r => selectedReceipts.has(r.id));
    setSelectedReceipts(prev => {
      const next = new Set(prev);
      for (const r of receipts) {
        allSelected ? next.delete(r.id) : next.add(r.id);
      }
      return next;
    });
  };

  const toggleSelectReceipt = (id: string) => {
    setSelectedReceipts(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const isPropertySelected = (property: string) => {
    const receipts = getPropertyReceipts(property);
    return receipts.length > 0 && receipts.every(r => selectedReceipts.has(r.id));
  };

  const isPropertyPartial = (property: string) => {
    const receipts = getPropertyReceipts(property);
    const selected = receipts.filter(r => selectedReceipts.has(r.id));
    return selected.length > 0 && selected.length < receipts.length;
  };

  const isEntitySelected = (entityId: string) => {
    const receipts = getEntityReceipts(entityId);
    return receipts.length > 0 && receipts.every(r => selectedReceipts.has(r.id));
  };

  const isEntityPartial = (entityId: string) => {
    const receipts = getEntityReceipts(entityId);
    const selected = receipts.filter(r => selectedReceipts.has(r.id));
    return selected.length > 0 && selected.length < receipts.length;
  };

  const selectedTotal = finalized.filter(r => selectedReceipts.has(r.id)).reduce((s, r) => s + Number(r.amount), 0);

  // ─── Batch creation ───
  const handleCreateBatches = async (type: "individual" | "grouped") => {
    if (selectedReceipts.size === 0) return;
    setIsBatchCreating(true);

    try {
      const selectedArr = finalized.filter(r => selectedReceipts.has(r.id));

      if (type === "individual") {
        // Group selected receipts by canonical property, create one batch per property
        const byProperty: Record<string, DbReceipt[]> = {};
        for (const r of selectedArr) {
          const prop = canonical(r.property);
          if (!byProperty[prop]) byProperty[prop] = [];
          byProperty[prop].push(r);
        }

        let created = 0;
        for (const [prop, receipts] of Object.entries(byProperty)) {
          const ids = receipts.map(r => r.id);
          const today = new Date();
          const period = `${today.getMonth() + 1}/${today.getDate()}/${String(today.getFullYear()).slice(-2)}`;
          await createDepositBatch(prop, ids, period, user!.id);
          created++;
        }

        toast({ title: `${created} batch${created > 1 ? "es" : ""} created`, description: `Created individual batches for ${created} properties.` });
      } else {
        // "Grouped by Owner" — group by entity, create one parent + children per entity
        // For properties without an entity, create individual batches
        const byEntity: Record<string, Record<string, DbReceipt[]>> = {};
        const noEntity: Record<string, DbReceipt[]> = {};

        for (const r of selectedArr) {
          const prop = canonical(r.property);
          const entityId = propertyToEntity.get(prop);
          if (entityId) {
            if (!byEntity[entityId]) byEntity[entityId] = {};
            if (!byEntity[entityId][prop]) byEntity[entityId][prop] = [];
            byEntity[entityId][prop].push(r);
          } else {
            if (!noEntity[prop]) noEntity[prop] = [];
            noEntity[prop].push(r);
          }
        }

        let created = 0;
        const today = new Date();
        const period = `${today.getMonth() + 1}/${today.getDate()}/${String(today.getFullYear()).slice(-2)}`;

        // For each entity group: create parent batch, then child batches
        for (const [entityId, propMap] of Object.entries(byEntity)) {
          const entity = ownerEntities.find(e => e.id === entityId);
          const allIds = Object.values(propMap).flat().map(r => r.id);
          const allTotal = Object.values(propMap).flat().reduce((s, r) => s + Number(r.amount), 0);
          const entityName = entity?.name || "Unknown Entity";

          // Create parent batch
          const { data: parentBatch, error: parentErr } = await supabase
            .from("deposit_batches")
            .insert({
              property: entityName,
              deposit_period: period,
              total_amount: allTotal,
              receipt_count: allIds.length,
              created_by: user!.id,
              ownership_entity_id: entityId,
              status: "draft" as any,
            })
            .select()
            .single();
          if (parentErr) throw parentErr;

          // Create child batches per property
          for (const [prop, receipts] of Object.entries(propMap)) {
            const ids = receipts.map(r => r.id);
            const propTotal = receipts.reduce((s, r) => s + Number(r.amount), 0);

            const { data: childBatch, error: childErr } = await supabase
              .from("deposit_batches")
              .insert({
                property: prop,
                deposit_period: period,
                total_amount: propTotal,
                receipt_count: ids.length,
                created_by: user!.id,
                parent_batch_id: parentBatch.id,
                ownership_entity_id: entityId,
                status: "draft" as any,
              })
              .select()
              .single();
            if (childErr) throw childErr;

            // Assign receipts to child batch
            for (const id of ids) {
              await supabase.from("receipts").update({ batch_id: childBatch.id }).eq("id", id);
            }
            created++;
          }
        }

        // Unassigned properties get individual batches
        for (const [prop, receipts] of Object.entries(noEntity)) {
          const ids = receipts.map(r => r.id);
          await createDepositBatch(prop, ids, period, user!.id);
          created++;
        }

        toast({ title: "Grouped batches created", description: `Created ${created} batches across ${Object.keys(byEntity).length} ownership groups.` });
      }

      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      setSelectedReceipts(new Set());
      setBatchMode(false);
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Batch creation failed", variant: "destructive" });
    } finally {
      setIsBatchCreating(false);
      setGroupedBatchDialogOpen(false);
    }
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

  // Group flatGrouped by entity for main content display
  const mainContentGroups = useMemo(() => {
    const entityMap: Record<string, { entity: OwnerEntity | null; properties: Record<string, DbReceipt[]> }> = {};

    for (const [prop, receipts] of Object.entries(flatGrouped)) {
      const entityId = propertyToEntity.get(prop);
      const key = entityId || "__unassigned__";
      if (!entityMap[key]) {
        entityMap[key] = {
          entity: entityId ? ownerEntities.find(e => e.id === entityId) || null : null,
          properties: {},
        };
      }
      entityMap[key].properties[prop] = receipts;
    }

    // Sort: entities first (alphabetically), then unassigned
    const sorted = Object.entries(entityMap).sort(([a, va], [b, vb]) => {
      if (a === "__unassigned__") return 1;
      if (b === "__unassigned__") return -1;
      return (va.entity?.name || "").localeCompare(vb.entity?.name || "");
    });

    return sorted;
  }, [flatGrouped, propertyToEntity, ownerEntities]);

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

  /* ─── Render receipt row (shared between single and multi-tenant) ─── */
  const renderReceiptRow = (r: DbReceipt, indent = false, isDupMonth = false) => (
    <tr key={r.id} className={`vault-table-row ${isDupMonth ? "bg-[hsl(var(--vault-amber)/0.05)]" : ""}`}>
      {batchMode && (
        <td className="px-3 py-2.5">
          <Checkbox
            checked={selectedReceipts.has(r.id)}
            onCheckedChange={() => toggleSelectReceipt(r.id)}
            disabled={!(r as any).appfolio_recorded}
          />
        </td>
      )}
      <td className="px-3 py-2.5">
        <Checkbox checked={(r as any).appfolio_recorded || false} onCheckedChange={(checked) => toggleMutation.mutate({ id: r.id, recorded: !!checked })} disabled={toggleMutation.isPending} />
      </td>
      <td className="px-3 py-2.5 text-center">
        {r.file_path && (<Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleViewAttachment(r)}><FileText className="h-3.5 w-3.5 text-vault-blue" /></Button></TooltipTrigger><TooltipContent>View document</TooltipContent></Tooltip>)}
      </td>
      <td className="px-3 py-2.5"><CopyCell value={r.unit} mono id={`unit-${r.id}`} /></td>
      <td className="px-3 py-2.5">
        <div className={`flex items-center gap-1.5 ${indent ? "pl-4" : ""}`}>
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

  /* ─── Render property table ─── */
  const renderPropertyCard = (property: string, receipts: DbReceipt[]) => {
    const subtotal = receipts.reduce((s, r) => s + Number(r.amount), 0);
    const recorded = receipts.filter((r) => (r as any).appfolio_recorded);
    const recordedAmt = recorded.reduce((s, r) => s + Number(r.amount), 0);
    const unbatched = recorded.filter((r) => !r.batch_id);
    const propSelected = isPropertySelected(property);
    const propPartial = isPropertyPartial(property);

    // Build tenant groups
    const tenantGroups: Record<string, DbReceipt[]> = {};
    for (const r of receipts) {
      const key = r.tenant || "(No Tenant)";
      if (!tenantGroups[key]) tenantGroups[key] = [];
      tenantGroups[key].push(r);
    }
    const sortedTenants = Object.keys(tenantGroups).sort();

    return (
      <motion.div key={property} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="vault-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {batchMode && (
              <Checkbox
                checked={propSelected}
                // @ts-ignore - indeterminate support
                data-state={propPartial ? "indeterminate" : propSelected ? "checked" : "unchecked"}
                onCheckedChange={() => toggleSelectProperty(property)}
              />
            )}
            <h3 className="text-sm font-bold text-foreground">{property}</h3>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-muted-foreground">{recorded.length}/{receipts.length} recorded</span>
            <span className="vault-mono font-bold text-foreground">${fmt(subtotal)}</span>
            {!batchMode && (
              <Button variant="default" size="sm" onClick={() => openBatchDialog(property)} disabled={unbatched.length === 0}>
                <Layers className="h-3.5 w-3.5 mr-1" /> Create Batch ({unbatched.length})
              </Button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
          <table className="w-full min-w-[1200px]">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border">
                {batchMode && <th className="px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide w-10">Select</th>}
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-10">Recorded?</th>
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
              {sortedTenants.flatMap((tenant): React.ReactElement[] => {
                const group = tenantGroups[tenant].sort((a, b) => (a.unit || "").localeCompare(b.unit || ""));
                const tenantKey = `${property}::${tenant}`;
                const isMulti = group.length > 1;
                const isOpen = expandedTableTenants.has(tenantKey);

                const monthCounts: Record<string, number> = {};
                for (const r of group) {
                  const m = r.rent_month || "none";
                  monthCounts[m] = (monthCounts[m] || 0) + 1;
                }
                const hasSameMonthDups = Object.values(monthCounts).some((c) => c > 1);

                if (!isMulti) return [renderReceiptRow(group[0])];

                const tenantTotal = group.reduce((s, r) => s + Number(r.amount), 0);
                const rows: React.ReactElement[] = [];

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
                    <td className="px-3 py-2.5" colSpan={batchMode ? 3 : 2}>
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
                    <td className="px-3 py-2.5 text-right text-sm vault-mono font-semibold text-foreground">${fmt(tenantTotal)}</td>
                    <td colSpan={batchMode ? 10 : 9}></td>
                  </tr>
                );

                if (isOpen) {
                  for (const r of group) {
                    const isDupMonth = monthCounts[r.rent_month || "none"] > 1;
                    rows.push(renderReceiptRow(r, true, isDupMonth));
                  }
                }
                return rows;
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border bg-muted/20 flex items-center justify-between text-xs">
          <div className="flex gap-6">
            <span className="text-muted-foreground">Recorded: <span className="vault-mono font-medium text-foreground">${fmt(recordedAmt)}</span></span>
            <span className="text-muted-foreground">Unrecorded: <span className="vault-mono font-medium text-foreground">${fmt(subtotal - recordedAmt)}</span></span>
          </div>
        </div>
      </motion.div>
    );
  };

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

      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AppFolio Entry & Recording</h1>
          <p className="text-sm text-muted-foreground mt-1">Select a building, copy fields into AppFolio, mark as recorded, then create deposit batches.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={batchMode ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setBatchMode(!batchMode);
              if (batchMode) setSelectedReceipts(new Set());
            }}
          >
            <CheckSquare className="h-4 w-4 mr-1" />
            {batchMode ? "Exit Batch Mode" : "Select for Batching"}
          </Button>
        </div>
      </div>

      {/* Batch mode action bar */}
      {batchMode && selectedReceipts.size > 0 && (
        <div className="mb-4 vault-card px-4 py-3 flex items-center justify-between bg-accent/5 border-accent/20">
          <div className="flex items-center gap-4 text-sm">
            <span className="font-semibold text-foreground">{selectedReceipts.size} receipts selected</span>
            <span className="vault-mono font-bold text-accent">${fmt(selectedTotal)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleCreateBatches("individual")}
              disabled={isBatchCreating}
            >
              <Layers className="h-3.5 w-3.5 mr-1" />
              Create Individual Batches
            </Button>
            <AlertDialog open={groupedBatchDialogOpen} onOpenChange={setGroupedBatchDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button size="sm" disabled={isBatchCreating}>
                  <Building2 className="h-3.5 w-3.5 mr-1" />
                  Create Grouped Batch by Owner
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Create Grouped Batches?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will create a parent batch for each ownership entity with child batches per property. Properties without an owner will get individual batches.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleCreateBatches("grouped")} disabled={isBatchCreating}>
                    {isBatchCreating ? "Creating..." : "Create Grouped Batches"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}

      <div className="flex gap-4">
        {/* ─── Building Tree Sidebar ─── */}
        <div className="vault-card p-0 overflow-hidden w-[240px] shrink-0 self-start sticky top-4">
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

            {/* Entity groups in sidebar */}
            {Object.entries(entityGroups.groups).sort(([, a], [, b]) => {
              const nameA = ownerEntities.find(e => e.id === a[0])?.name || "";
              const nameB = ownerEntities.find(e => e.id === b[0])?.name || "";
              return nameA.localeCompare(nameB);
            }).map(([entityId, props]) => {
              const entity = ownerEntities.find(e => e.id === entityId);
              if (!entity) return null;
              const filteredProps = props.filter(p => !treeSearch || p.toLowerCase().includes(treeSearch.toLowerCase()));
              if (filteredProps.length === 0 && treeSearch) return null;
              const isEntityExpanded = expandedEntities.has(entityId);
              const entityReceiptCount = props.reduce((sum, p) => sum + (tenantsByProperty[p] ? Object.values(tenantsByProperty[p]).flat().length : 0), 0);

              return (
                <div key={entityId}>
                  <button
                    onClick={() => toggleEntityExpand(entityId)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-xs transition-colors hover:bg-muted/50 bg-muted/20 border-l-2 border-transparent"
                  >
                    {batchMode && (
                      <Checkbox
                        checked={isEntitySelected(entityId)}
                        onCheckedChange={() => toggleSelectEntity(entityId)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5"
                      />
                    )}
                    {isEntityExpanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                    <span className="truncate text-left flex-1 font-semibold text-foreground">{entity.name}</span>
                    <span className="text-[10px] vault-mono text-muted-foreground shrink-0">{entityReceiptCount}</span>
                  </button>

                  {isEntityExpanded && (filteredProps.length > 0 ? filteredProps : props).sort().map(property => {
                    const count = finalized.filter(r => canonical(r.property) === property).length;
                    const recCount = finalized.filter(r => canonical(r.property) === property && (r as any).appfolio_recorded).length;
                    const isPropExpanded = expandedProperties.has(property);
                    const tenants = tenantsByProperty[property] || {};
                    const tenantNames = Object.keys(tenants).sort();
                    return (
                      <div key={property}>
                        <button
                          onClick={() => { handleSelectProperty(property); togglePropertyExpand(property); }}
                          className={`w-full flex items-center gap-2 pl-7 pr-3 py-2 text-xs transition-colors ${selectedProperty === property && !selectedTenant ? "bg-accent/10 text-accent font-semibold border-l-2 border-accent" : "text-foreground hover:bg-muted/50 border-l-2 border-transparent"}`}
                        >
                          {batchMode && (
                            <Checkbox
                              checked={isPropertySelected(property)}
                              onCheckedChange={() => toggleSelectProperty(property)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-3.5 w-3.5"
                            />
                          )}
                          {isPropExpanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                          <span className="truncate text-left flex-1">{property}</span>
                          <span className="text-[10px] vault-mono text-muted-foreground shrink-0">{recCount}/{count}</span>
                        </button>
                        {isPropExpanded && tenantNames.map(tenant => {
                          const tReceipts = tenants[tenant];
                          const isSelected = selectedProperty === property && selectedTenant === tenant;
                          return (
                            <button
                              key={tenant}
                              onClick={() => handleSelectTenant(property, tenant)}
                              className={`w-full flex items-center gap-2 pl-12 pr-3 py-1.5 text-[11px] transition-colors ${isSelected ? "bg-accent/10 text-accent font-semibold border-l-2 border-accent" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-l-2 border-transparent"}`}
                            >
                              <User className="h-3 w-3 shrink-0" />
                              <span className="truncate text-left flex-1">{tenant}</span>
                              <span className="text-[10px] vault-mono shrink-0">{tReceipts.length}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Unassigned properties */}
            {entityGroups.unassigned.filter(p => !treeSearch || p.toLowerCase().includes(treeSearch.toLowerCase())).length > 0 && (
              <div>
                {ownerEntities.length > 0 && (
                  <div className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/10">
                    Unassigned
                  </div>
                )}
                {entityGroups.unassigned.sort().filter(p => !treeSearch || p.toLowerCase().includes(treeSearch.toLowerCase())).map(property => {
                  const count = finalized.filter(r => canonical(r.property) === property).length;
                  const recCount = finalized.filter(r => canonical(r.property) === property && (r as any).appfolio_recorded).length;
                  const isPropExpanded = expandedProperties.has(property);
                  const tenants = tenantsByProperty[property] || {};
                  const tenantNames = Object.keys(tenants).sort();
                  return (
                    <div key={property}>
                      <button
                        onClick={() => { handleSelectProperty(property); togglePropertyExpand(property); }}
                        className={`w-full flex items-center gap-2 px-4 py-2.5 text-xs transition-colors ${selectedProperty === property && !selectedTenant ? "bg-accent/10 text-accent font-semibold border-l-2 border-accent" : "text-foreground hover:bg-muted/50 border-l-2 border-transparent"}`}
                      >
                        {batchMode && (
                          <Checkbox
                            checked={isPropertySelected(property)}
                            onCheckedChange={() => toggleSelectProperty(property)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-3.5 w-3.5"
                          />
                        )}
                        {isPropExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                        <span className="truncate text-left flex-1">{property}</span>
                        <span className="text-[10px] vault-mono text-muted-foreground shrink-0">{recCount}/{count}</span>
                      </button>
                      {isPropExpanded && tenantNames.map(tenant => {
                        const tReceipts = tenants[tenant];
                        const isSelected = selectedProperty === property && selectedTenant === tenant;
                        return (
                          <button
                            key={tenant}
                            onClick={() => handleSelectTenant(property, tenant)}
                            className={`w-full flex items-center gap-2 pl-9 pr-4 py-1.5 text-[11px] transition-colors ${isSelected ? "bg-accent/10 text-accent font-semibold border-l-2 border-accent" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-l-2 border-transparent"}`}
                          >
                            <User className="h-3 w-3 shrink-0" />
                            <span className="truncate text-left flex-1">{tenant}</span>
                            <span className="text-[10px] vault-mono shrink-0">{tReceipts.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ─── Main Content ─── */}
        <div className="flex-1 min-w-0 space-y-6">
          {mainContentGroups.length === 0 ? (
            <div className="vault-card p-8 text-center text-muted-foreground text-sm">No finalized receipts.</div>
          ) : (
            mainContentGroups.map(([key, { entity, properties: propMap }]) => {
              const entityTotal = Object.values(propMap).flat().reduce((s, r) => s + Number(r.amount), 0);
              const entityReceiptCount = Object.values(propMap).flat().length;
              const propCount = Object.keys(propMap).length;

              return (
                <div key={key} className="space-y-4">
                  {/* Entity header */}
                  {entity && (
                    <div className="flex items-center gap-3 px-1">
                      {batchMode && (
                        <Checkbox
                          checked={isEntitySelected(entity.id)}
                          onCheckedChange={() => toggleSelectEntity(entity.id)}
                        />
                      )}
                      <Building2 className="h-5 w-5 text-accent" />
                      <div className="flex-1">
                        <h2 className="text-lg font-bold text-foreground">{entity.name}</h2>
                        <p className="text-xs text-muted-foreground">{propCount} properties • {entityReceiptCount} receipts • ${fmt(entityTotal)}</p>
                      </div>
                    </div>
                  )}
                  {key === "__unassigned__" && ownerEntities.length > 0 && (
                    <div className="flex items-center gap-3 px-1">
                      <div className="flex-1">
                        <h2 className="text-lg font-bold text-muted-foreground">Unassigned Properties</h2>
                        <p className="text-xs text-muted-foreground">{propCount} properties • {entityReceiptCount} receipts • ${fmt(entityTotal)}</p>
                      </div>
                    </div>
                  )}

                  {/* Property cards within entity */}
                  {Object.entries(propMap).sort(([a], [b]) => a.localeCompare(b)).map(([prop, receipts]) =>
                    renderPropertyCard(prop, receipts)
                  )}
                </div>
              );
            })
          )}

          {grandTotal > 0 && (
            <div className="vault-card px-4 py-4 flex items-center justify-between">
              <span className="text-sm font-bold text-foreground">Grand Total</span>
              <div className="flex items-center gap-6">
                <span className="text-sm text-muted-foreground">{recordedReceipts.length}/{filtered.length} recorded</span>
                <span className="text-sm text-muted-foreground">Recorded: <span className="vault-mono font-bold text-foreground">${fmt(recordedTotal)}</span></span>
                <span className="text-lg vault-mono font-bold text-foreground">${fmt(grandTotal)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Deposit Batch — {batchProperty}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">This will batch {finalized.filter((r) => canonical(r.property) === batchProperty && (r as any).appfolio_recorded && !r.batch_id).length} recorded, unbatched receipts for <strong>{batchProperty}</strong>.</p>
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
