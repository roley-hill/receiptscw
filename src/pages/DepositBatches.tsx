import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchBatches, fetchReceipts, reverseBatch, moveReceiptsToNewBatch } from "@/lib/api";
import { downloadBatchPDF, generateBatchXLSX, downloadBatchZIP, downloadGroupedOwnerPDF } from "@/lib/batchReports";
import { supabase } from "@/integrations/supabase/client";
import { Building2, ChevronDown, ChevronRight, FileText as FileTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useState, useMemo, lazy, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";
import { motion } from "framer-motion";
import BatchCard from "@/components/BatchCard";

const BatchDocumentPreview = lazy(() => import("@/components/BatchDocumentPreview"));

type OwnerEntity = { id: string; name: string };

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });

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

  // Organize batches into entity groups
  const { entityGroupedBatches, standaloneBatches, reversedBatches } = useMemo(() => {
    const active = batches.filter(b => b.status !== "reversed");
    const reversed = batches.filter(b => b.status === "reversed");

    // Parent batches (have ownership_entity_id and no parent_batch_id, or are parents of children)
    const parentBatchIds = new Set(active.filter(b => b.parent_batch_id).map(b => b.parent_batch_id!));
    const childBatches = new Set(active.filter(b => b.parent_batch_id).map(b => b.id));

    // Group by ownership entity
    const entityMap: Record<string, { entity: OwnerEntity | null; parentBatch: typeof batches[0] | null; children: typeof batches; standalone: typeof batches }> = {};

    for (const batch of active) {
      if (childBatches.has(batch.id)) continue; // handled under parent

      const entityId = batch.ownership_entity_id;
      if (entityId && (parentBatchIds.has(batch.id) || batch.parent_batch_id === null)) {
        if (!entityMap[entityId]) {
          entityMap[entityId] = {
            entity: ownerEntities.find(e => e.id === entityId) || null,
            parentBatch: null,
            children: [],
            standalone: [],
          };
        }

        if (parentBatchIds.has(batch.id)) {
          // This is a parent batch — find its children
          entityMap[entityId].parentBatch = batch;
          entityMap[entityId].children = active.filter(b => b.parent_batch_id === batch.id);
        } else {
          // Standalone batch with entity assignment (individual batch)
          entityMap[entityId].standalone.push(batch);
        }
      }
    }

    // Standalone batches: no entity assignment, not a child
    const entityBatchIds = new Set<string>();
    for (const group of Object.values(entityMap)) {
      if (group.parentBatch) entityBatchIds.add(group.parentBatch.id);
      for (const c of group.children) entityBatchIds.add(c.id);
      for (const s of group.standalone) entityBatchIds.add(s.id);
    }
    const standalone = active.filter(b => !entityBatchIds.has(b.id) && !childBatches.has(b.id));

    return { entityGroupedBatches: entityMap, standaloneBatches: standalone, reversedBatches: reversed };
  }, [batches, ownerEntities]);

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

                {/* Child/standalone batches */}
                {!isCollapsed && (
                  <div className="space-y-3 pl-6 border-l-2 border-accent/20 ml-4">
                    {group.children.length > 0
                      ? group.children.sort((a, b) => a.property.localeCompare(b.property)).map((batch, i) => renderBatchCard(batch, i))
                      : group.standalone.sort((a, b) => a.property.localeCompare(b.property)).map((batch, i) => renderBatchCard(batch, i))
                    }
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
              <h2 className="text-lg font-semibold text-muted-foreground">Reversed Batches</h2>
              {reversedBatches.map((batch, i) => renderBatchCard(batch, i))}
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
