import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchBatches, fetchReceipts, reverseBatch, moveReceiptsToNewBatch } from "@/lib/api";
import { downloadBatchPDF, generateBatchXLSX, downloadBatchZIP, downloadGroupedOwnerPDF } from "@/lib/batchReports";
import { supabase } from "@/integrations/supabase/client";
import { Building2, ChevronDown, ChevronRight, FileText as FileTextIcon, Layers, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useState, useMemo, lazy, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";
import { motion } from "framer-motion";
import BatchCard from "@/components/BatchCard";

const BatchDocumentPreview = lazy(() => import("@/components/BatchDocumentPreview"));

type OwnerEntity = { id: string; name: string };

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });

function formatRentMonth(rm: string | null): string {
  if (!rm) return "No Month Assigned";
  const [year, month] = rm.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

function getBatchMonth(batchId: string, allReceipts: any[]): string {
  const receipts = allReceipts.filter(r => r.batch_id === batchId);
  // Find predominant rent_month
  const counts: Record<string, number> = {};
  for (const r of receipts) {
    const m = r.rent_month || "__none__";
    counts[m] = (counts[m] || 0) + 1;
  }
  let best = "__none__";
  let bestCount = 0;
  for (const [m, c] of Object.entries(counts)) {
    if (c > bestCount) { best = m; bestCount = c; }
  }
  return best;
}

export default function DepositBatches() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { data: batches = [], isLoading } = useQuery({ queryKey: ["batches"], queryFn: fetchBatches });
  const { data: allReceipts = [] } = useQuery({ queryKey: ["receipts"], queryFn: fetchReceipts });
  const { data: ownerEntities = [] } = useQuery({
    queryKey: ["ownership_entities"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ownership_entities").select("*").order("name");
      if (error) throw error;
      return data as OwnerEntity[];
    },
  });

  const [downloadingZip, setDownloadingZip] = useState<string | null>(null);
  const [previewBatchId, setPreviewBatchId] = useState<string | null>(null);
  const [movingBatchId, setMovingBatchId] = useState<string | null>(null);
  const [collapsedEntities, setCollapsedEntities] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [reversedCollapsed, setReversedCollapsed] = useState(true);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());

  const reverseMutation = useMutation({
    mutationFn: (batchId: string) => reverseBatch(batchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      toast({ title: "Batch reversed", description: "Receipts have been unlinked and are available for re-batching." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const moveMutation = useMutation({
    mutationFn: ({ sourceBatchId, receiptIds, property }: { sourceBatchId: string; receiptIds: string[]; property: string }) =>
      moveReceiptsToNewBatch(sourceBatchId, receiptIds, property, session?.user?.id || ""),
    onSuccess: (newBatch) => {
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      setMovingBatchId(null);
      toast({ title: "Receipts moved", description: `Created new batch ${newBatch.batch_id} with the selected receipts.` });
    },
    onError: (e: Error) => { setMovingBatchId(null); toast({ title: "Error", description: e.message, variant: "destructive" }); },
  });

  const handleZipDownload = async (batch: any, receipts: any[]) => {
    setDownloadingZip(batch.id);
    try { await downloadBatchZIP(batch, receipts); }
    catch (e) { toast({ title: "Error", description: e instanceof Error ? e.message : "ZIP download failed", variant: "destructive" }); }
    finally { setDownloadingZip(null); }
  };

  const handleMoveReceipts = (batchId: string, property: string, receiptIds: string[]) => {
    setMovingBatchId(batchId);
    moveMutation.mutate({ sourceBatchId: batchId, receiptIds, property });
  };

  const toggleEntityCollapse = (entityId: string) => {
    setCollapsedEntities(prev => {
      const next = new Set(prev);
      next.has(entityId) ? next.delete(entityId) : next.add(entityId);
      return next;
    });
  };

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const renderBatchCard = (batch: any, index: number) => {
    const receipts = allReceipts.filter((r) => r.batch_id === batch.id);
    return (
      <BatchCard
        key={batch.id}
        batch={batch}
        receipts={receipts}
        index={index}
        isZipping={downloadingZip === batch.id}
        onPreview={() => setPreviewBatchId(batch.id)}
        onZipDownload={() => handleZipDownload(batch, receipts)}
        onPdfDownload={() => downloadBatchPDF(batch, receipts)}
        onXlsxDownload={() => generateBatchXLSX(batch, receipts)}
        onReverse={() => reverseMutation.mutate(batch.id)}
        onMoveReceipts={(ids) => handleMoveReceipts(batch.id, batch.property, ids)}
        isMoving={movingBatchId === batch.id}
      />
    );
  };

  // Determine month for each batch
  const batchMonthMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of batches) {
      map.set(b.id, getBatchMonth(b.id, allReceipts));
    }
    return map;
  }, [batches, allReceipts]);

  // Organize batches: month → entity → grouped/standalone
  type EntityGroup = { entity: OwnerEntity | null; parentBatch: typeof batches[0] | null; children: typeof batches; standalone: typeof batches };
  type MonthGroup = {
    monthKey: string;
    label: string;
    entityGroups: [string, EntityGroup][];
    standaloneBatches: typeof batches;
    totalAmount: number;
    receiptCount: number;
  };

  const { monthGroups, reversedBatches } = useMemo(() => {
    const active = batches.filter(b => b.status !== "reversed");
    const reversed = batches.filter(b => b.status === "reversed");
    const parentBatchIds = new Set(active.filter(b => b.parent_batch_id).map(b => b.parent_batch_id!));
    const childBatchIds = new Set(active.filter(b => b.parent_batch_id).map(b => b.id));

    // Group active top-level batches by month
    const byMonth: Record<string, typeof batches> = {};
    for (const batch of active) {
      if (childBatchIds.has(batch.id)) continue;
      const month = batchMonthMap.get(batch.id) || "__none__";
      if (!byMonth[month]) byMonth[month] = [];
      byMonth[month].push(batch);
    }

    const result: MonthGroup[] = [];
    for (const monthKey of Object.keys(byMonth).sort((a, b) => {
      if (a === "__none__") return 1;
      if (b === "__none__") return -1;
      return b.localeCompare(a);
    })) {
      const monthBatches = byMonth[monthKey];
      const entityMap: Record<string, EntityGroup> = {};
      const unassigned: typeof batches = [];

      for (const batch of monthBatches) {
        const entityId = batch.ownership_entity_id;
        if (entityId) {
          if (!entityMap[entityId]) {
            entityMap[entityId] = {
              entity: ownerEntities.find(e => e.id === entityId) || null,
              parentBatch: null,
              children: [],
              standalone: [],
            };
          }
          if (parentBatchIds.has(batch.id)) {
            entityMap[entityId].parentBatch = batch;
            entityMap[entityId].children = active.filter(b => b.parent_batch_id === batch.id);
          } else {
            entityMap[entityId].standalone.push(batch);
          }
        } else {
          unassigned.push(batch);
        }
      }

      const sortedEntities = Object.entries(entityMap).sort(([, a], [, b]) =>
        (a.entity?.name || "").localeCompare(b.entity?.name || "")
      );

      // Compute totals for month
      const allMonthBatchIds = new Set<string>();
      for (const [, g] of sortedEntities) {
        if (g.parentBatch) allMonthBatchIds.add(g.parentBatch.id);
        for (const c of g.children) allMonthBatchIds.add(c.id);
        for (const s of g.standalone) allMonthBatchIds.add(s.id);
      }
      for (const b of unassigned) allMonthBatchIds.add(b.id);
      const monthReceipts = allReceipts.filter(r => {
        if (!r.batch_id) return false;
        return allMonthBatchIds.has(r.batch_id);
      });

      result.push({
        monthKey,
        label: monthKey === "__none__" ? "No Month Assigned" : formatRentMonth(monthKey),
        entityGroups: sortedEntities,
        standaloneBatches: unassigned,
        totalAmount: monthReceipts.reduce((s, r) => s + Number(r.amount), 0),
        receiptCount: monthReceipts.length,
      });
    }

    return { monthGroups: result, reversedBatches: reversed };
  }, [batches, ownerEntities, allReceipts, batchMonthMap]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  const sortedEntityGroups = Object.entries(entityGroupedBatches).sort(([, a], [, b]) =>
    (a.entity?.name || "").localeCompare(b.entity?.name || "")
  );

  const hasAnyBatches = sortedEntityGroups.length > 0 || standaloneBatches.length > 0;

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Deposit Batches</h1>
        <p className="text-sm text-muted-foreground mt-1">Group receipts into one transfer per property. Download reports for your accountant.</p>
      </div>

      {!hasAnyBatches && reversedBatches.length === 0 ? (
        <div className="vault-card p-8 text-center text-muted-foreground text-sm">No deposit batches yet. Create one from the Entry & Recording page.</div>
      ) : (
        <div className="space-y-8">
          {/* Entity-grouped batches */}
          {sortedEntityGroups.map(([entityId, group]) => {
            const isCollapsed = collapsedEntities.has(entityId);
            const allGroupBatches = [...(group.parentBatch ? [group.parentBatch] : []), ...group.children, ...group.standalone];
            const allGroupReceipts = allGroupBatches.flatMap(b => allReceipts.filter(r => r.batch_id === b.id));
            const entityTotal = allGroupReceipts.reduce((s, r) => s + Number(r.amount), 0);
            const entityReceiptCount = allGroupReceipts.length;
            const batchCount = group.children.length > 0 ? group.children.length : group.standalone.length;

            return (
              <div key={entityId} className="space-y-3">
                {/* Entity header */}
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="vault-card px-5 py-4 flex items-center justify-between"
                >
                  <button
                    onClick={() => toggleEntityCollapse(entityId)}
                    className="flex items-center gap-3 flex-1 hover:opacity-80 transition-opacity cursor-pointer"
                  >
                    {isCollapsed
                      ? <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    }
                    <div className="h-9 w-9 rounded-lg bg-accent/10 flex items-center justify-center">
                      <Building2 className="h-4.5 w-4.5 text-accent" />
                    </div>
                    <div className="text-left">
                      <h2 className="text-base font-bold text-foreground">{group.entity?.name || "Unknown Entity"}</h2>
                      <p className="text-xs text-muted-foreground">
                        {batchCount} {batchCount === 1 ? "property" : "properties"} · {entityReceiptCount} receipts
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-lg vault-mono font-bold text-foreground">${fmt(entityTotal)}</p>
                      <p className="text-xs text-muted-foreground">Grand Total</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      title="Download grouped owner PDF"
                      onClick={(e) => {
                        e.stopPropagation();
                        const childBatches = group.children.length > 0 ? group.children : group.standalone;
                        const buildingBatches = childBatches
                          .sort((a, b) => a.property.localeCompare(b.property))
                          .map(b => ({ batch: b, receipts: allReceipts.filter(r => r.batch_id === b.id) }));
                        downloadGroupedOwnerPDF(group.entity?.name || "Unknown Entity", buildingBatches);
                      }}
                    >
                      <FileTextIcon className="h-3.5 w-3.5 mr-1" />
                      Owner PDF
                    </Button>
                  </div>
                </motion.div>

                {!isCollapsed && (
                  <div className="space-y-4 pl-6 border-l-2 border-accent/20 ml-4">
                    {/* Grouped Deposit Batches (parent with children) */}
                    {group.children.length > 0 && (() => {
                      const sectionKey = `${entityId}__grouped`;
                      const isSectionCollapsed = collapsedSections.has(sectionKey);
                      const groupedReceipts = group.children.flatMap(b => allReceipts.filter(r => r.batch_id === b.id));
                      const groupedTotal = groupedReceipts.reduce((s, r) => s + Number(r.amount), 0);
                      return (
                        <div className="space-y-3">
                          <button
                            onClick={() => toggleSection(sectionKey)}
                            className="flex items-center gap-2 text-sm font-semibold text-foreground hover:opacity-80 transition-opacity cursor-pointer"
                          >
                            {isSectionCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                            <Layers className="h-3.5 w-3.5 text-accent" />
                            <span>Grouped Deposit Batches</span>
                            <span className="text-xs vault-mono text-muted-foreground font-normal ml-1">
                              {group.children.length} properties · ${fmt(groupedTotal)}
                            </span>
                          </button>
                          {!isSectionCollapsed && (
                            <div className="space-y-3">
                              {group.children.sort((a, b) => a.property.localeCompare(b.property)).map((batch, i) => renderBatchCard(batch, i))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Single Property Deposit Batches */}
                    {group.standalone.length > 0 && (() => {
                      const sectionKey = `${entityId}__single`;
                      const isSectionCollapsed = collapsedSections.has(sectionKey);
                      const singleReceipts = group.standalone.flatMap(b => allReceipts.filter(r => r.batch_id === b.id));
                      const singleTotal = singleReceipts.reduce((s, r) => s + Number(r.amount), 0);
                      return (
                        <div className="space-y-3">
                          <button
                            onClick={() => toggleSection(sectionKey)}
                            className="flex items-center gap-2 text-sm font-semibold text-foreground hover:opacity-80 transition-opacity cursor-pointer"
                          >
                            {isSectionCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>Single Property Deposit Batches</span>
                            <span className="text-xs vault-mono text-muted-foreground font-normal ml-1">
                              {group.standalone.length} batches · ${fmt(singleTotal)}
                            </span>
                          </button>
                          {!isSectionCollapsed && (
                            <div className="space-y-3">
                              {group.standalone.sort((a, b) => a.property.localeCompare(b.property)).map((batch, i) => renderBatchCard(batch, i))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}

          {/* Standalone (unassigned) batches */}
          {standaloneBatches.length > 0 && (
            <div className="space-y-3">
              {sortedEntityGroups.length > 0 && (
                <div className="px-1">
                  <h2 className="text-lg font-semibold text-muted-foreground">Unassigned Batches</h2>
                  <p className="text-xs text-muted-foreground">{standaloneBatches.length} batches not linked to an ownership entity</p>
                </div>
              )}
              <div className="space-y-4">
                {standaloneBatches.map((batch, i) => renderBatchCard(batch, i))}
              </div>
            </div>
          )}

          {/* Reversed batches */}
          {reversedBatches.length > 0 && (
            <div className="space-y-4 mt-10">
              <button
                onClick={() => setReversedCollapsed(prev => !prev)}
                className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
              >
                {reversedCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                <h2 className="text-lg font-semibold text-muted-foreground">Reversed Batches</h2>
                <span className="text-xs vault-mono text-muted-foreground">({reversedBatches.length})</span>
              </button>
              {!reversedCollapsed && reversedBatches.map((batch, i) => renderBatchCard(batch, i))}
            </div>
          )}
        </div>
      )}

      {previewBatchId && (
        <Suspense fallback={null}>
          <BatchDocumentPreview
            receipts={allReceipts.filter((r) => r.batch_id === previewBatchId)}
            batch={batches.find((b) => b.id === previewBatchId)}
            onClose={() => setPreviewBatchId(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
