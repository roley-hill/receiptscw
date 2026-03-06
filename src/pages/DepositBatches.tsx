import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchBatches, fetchReceipts, reverseBatch, moveReceiptsToNewBatch } from "@/lib/api";
import { downloadBatchPDF, generateBatchXLSX, downloadBatchZIP, downloadGroupedOwnerPDF, generateGroupedXLSX, downloadGroupedZIP } from "@/lib/batchReports";
import { supabase } from "@/integrations/supabase/client";
import { Building2, ChevronDown, ChevronRight, FileText as FileTextIcon, FileSpreadsheet, Layers, Eye, PackageOpen, Mail, Undo2, SquareCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  const [downloadingEntityZip, setDownloadingEntityZip] = useState<string | null>(null);
  const [previewBatchId, setPreviewBatchId] = useState<string | null>(null);
  const [previewEntityId, setPreviewEntityId] = useState<string | null>(null);
  const [movingBatchId, setMovingBatchId] = useState<string | null>(null);
  const [collapsedEntities, setCollapsedEntities] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [reversedCollapsed, setReversedCollapsed] = useState(true);

  const reverseMutation = useMutation({
    mutationFn: (batchId: string) => reverseBatch(batchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      toast({ title: "Batch reversed", description: "Receipts have been unlinked and are available for re-batching." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reverseEntityMutation = useMutation({
    mutationFn: async (batchIds: string[]) => {
      for (const id of batchIds) {
        await reverseBatch(id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      toast({ title: "All batches reversed", description: "All property batches in this group have been reversed." });
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

  const handleEntityZipDownload = async (entityId: string, entityName: string, buildingBatches: { batch: any; receipts: any[] }[]) => {
    setDownloadingEntityZip(entityId);
    try { await downloadGroupedZIP(entityName, buildingBatches); }
    catch (e) { toast({ title: "Error", description: e instanceof Error ? e.message : "ZIP download failed", variant: "destructive" }); }
    finally { setDownloadingEntityZip(null); }
  };

  const handleMoveReceipts = (batchId: string, property: string, receiptIds: string[]) => {
    setMovingBatchId(batchId);
    moveMutation.mutate({ sourceBatchId: batchId, receiptIds, property });
  };

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const renderBatchCard = (batch: any, index: number, hideActions = false) => {
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
        hideActions={hideActions}
      />
    );
  };

  // Organize batches: entity → multiple grouped sets + standalone
  type GroupedSet = { parentBatch: typeof batches[0]; children: typeof batches };
  type EntityGroup = { entity: OwnerEntity | null; groupedSets: GroupedSet[]; standalone: typeof batches };

  const { entityGroups, unassignedBatches, reversedBatches } = useMemo(() => {
    const active = batches.filter(b => b.status !== "reversed");
    const reversed = batches.filter(b => b.status === "reversed");
    const parentBatchIds = new Set(active.filter(b => b.parent_batch_id).map(b => b.parent_batch_id!));
    const childBatchIds = new Set(active.filter(b => b.parent_batch_id).map(b => b.id));

    const entityMap: Record<string, EntityGroup> = {};
    const unassigned: typeof batches = [];

    for (const batch of active) {
      if (childBatchIds.has(batch.id)) continue;
      const entityId = batch.ownership_entity_id;
      if (entityId) {
        if (!entityMap[entityId]) {
          entityMap[entityId] = {
            entity: ownerEntities.find(e => e.id === entityId) || null,
            groupedSets: [],
            standalone: [],
          };
        }
        if (parentBatchIds.has(batch.id)) {
          entityMap[entityId].groupedSets.push({
            parentBatch: batch,
            children: active.filter(b => b.parent_batch_id === batch.id),
          });
        } else {
          entityMap[entityId].standalone.push(batch);
        }
      } else {
        unassigned.push(batch);
      }
    }

    const sorted = Object.entries(entityMap).sort(([, a], [, b]) =>
      (a.entity?.name || "").localeCompare(b.entity?.name || "")
    );

    return { entityGroups: sorted, unassignedBatches: unassigned, reversedBatches: reversed };
  }, [batches, ownerEntities]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  const hasAnyBatches = entityGroups.length > 0 || unassignedBatches.length > 0;

  const renderEntityGroup = (entityId: string, group: EntityGroup) => {
    const isCollapsed = collapsedEntities.has(entityId);
    const allGroupBatches = [...(group.parentBatch ? [group.parentBatch] : []), ...group.children, ...group.standalone];
    const allGroupReceipts = allGroupBatches.flatMap(b => allReceipts.filter(r => r.batch_id === b.id));
    const entityTotal = allGroupReceipts.reduce((s, r) => s + Number(r.amount), 0);
    const entityReceiptCount = allGroupReceipts.length;
    const batchCount = group.children.length > 0 ? group.children.length : group.standalone.length;
    const isGrouped = group.children.length > 0;
    const childBatches = isGrouped ? group.children : group.standalone;
    const buildingBatches = childBatches
      .sort((a, b) => a.property.localeCompare(b.property))
      .map(b => ({ batch: b, receipts: allReceipts.filter(r => r.batch_id === b.id) }));
    const entityName = group.entity?.name || "Unknown Entity";
    const allChildBatchIds = childBatches.map(b => b.id);

    return (
      <div key={entityId} className="space-y-3">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="vault-card px-5 py-4 flex items-center justify-between"
        >
          <button
            onClick={() => {
              setCollapsedEntities(prev => {
                const next = new Set(prev);
                next.has(entityId) ? next.delete(entityId) : next.add(entityId);
                return next;
              });
            }}
            className="flex items-center gap-3 flex-1 hover:opacity-80 transition-opacity cursor-pointer"
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            <div className="h-9 w-9 rounded-lg bg-accent/10 flex items-center justify-center">
              <Building2 className="h-4.5 w-4.5 text-accent" />
            </div>
            <div className="text-left">
              <h2 className="text-base font-bold text-foreground">{entityName}</h2>
              <p className="text-xs text-muted-foreground">
                {batchCount} {batchCount === 1 ? "property" : "properties"} · {entityReceiptCount} receipts
              </p>
            </div>
          </button>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-lg vault-mono font-bold text-foreground">${fmt(entityTotal)}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
            {isGrouped && (
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setPreviewEntityId(entityId); }} title="Preview all documents">
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline" size="sm"
                  disabled={downloadingEntityZip === entityId}
                  onClick={(e) => { e.stopPropagation(); handleEntityZipDownload(entityId, entityName, buildingBatches); }}
                  title="Download grouped deposit package (ZIP)"
                >
                  {downloadingEntityZip === entityId ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <PackageOpen className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); downloadGroupedOwnerPDF(entityName, buildingBatches); }} title="Download grouped PDF report">
                  <FileTextIcon className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); generateGroupedXLSX(entityName, buildingBatches); }} title="Download grouped XLSX report">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="sm" title="Email grouped report" onClick={(e) => e.stopPropagation()}>
                  <Mail className="h-3.5 w-3.5" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" title="Reverse all batches in group" className="text-destructive hover:text-destructive" onClick={(e) => e.stopPropagation()}>
                      <Undo2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reverse all batches for {entityName}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will reverse all {childBatches.length} property batches in this group, unlinking {entityReceiptCount} receipts. They will be available for re-batching.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => reverseEntityMutation.mutate(allChildBatchIds)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Reverse All Batches
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
            {!isGrouped && (
              <Button
                variant="outline"
                size="sm"
                title="Download grouped owner PDF"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadGroupedOwnerPDF(entityName, buildingBatches);
                }}
              >
                <FileTextIcon className="h-3.5 w-3.5 mr-1" />
                Owner PDF
              </Button>
            )}
          </div>
        </motion.div>

        {!isCollapsed && (
          <div className="space-y-4 pl-6 border-l-2 border-accent/20 ml-4">
            {group.children.length > 0 && (() => {
              const sectionKey = `${entityId}__grouped`;
              const isSectionCollapsed = collapsedSections.has(sectionKey);
              const groupedReceipts = group.children.flatMap(b => allReceipts.filter(r => r.batch_id === b.id));
              const groupedTotal = groupedReceipts.reduce((s, r) => s + Number(r.amount), 0);
              return (
                <div className="space-y-3">
                  <button onClick={() => toggleSection(sectionKey)} className="flex items-center gap-2 text-sm font-semibold text-foreground hover:opacity-80 transition-opacity cursor-pointer">
                    {isSectionCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                    <Layers className="h-3.5 w-3.5 text-accent" />
                    <span>Grouped Deposit Batches</span>
                    <span className="text-xs vault-mono text-muted-foreground font-normal ml-1">{group.children.length} properties · ${fmt(groupedTotal)}</span>
                  </button>
                  {!isSectionCollapsed && <div className="space-y-3">{group.children.sort((a, b) => a.property.localeCompare(b.property)).map((batch, i) => renderBatchCard(batch, i, true))}</div>}
                </div>
              );
            })()}
            {group.standalone.length > 0 && (() => {
              const sectionKey = `${entityId}__single`;
              const isSectionCollapsed = collapsedSections.has(sectionKey);
              const singleReceipts = group.standalone.flatMap(b => allReceipts.filter(r => r.batch_id === b.id));
              const singleTotal = singleReceipts.reduce((s, r) => s + Number(r.amount), 0);
              return (
                <div className="space-y-3">
                  <button onClick={() => toggleSection(sectionKey)} className="flex items-center gap-2 text-sm font-semibold text-foreground hover:opacity-80 transition-opacity cursor-pointer">
                    {isSectionCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Single Property Deposit Batches</span>
                    <span className="text-xs vault-mono text-muted-foreground font-normal ml-1">{group.standalone.length} batches · ${fmt(singleTotal)}</span>
                  </button>
                  {!isSectionCollapsed && <div className="space-y-3">{group.standalone.sort((a, b) => a.property.localeCompare(b.property)).map((batch, i) => renderBatchCard(batch, i))}</div>}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    );
  };

  // Find entity data for preview
  const previewEntityData = previewEntityId ? (() => {
    const entry = entityGroups.find(([id]) => id === previewEntityId);
    if (!entry) return null;
    const [, group] = entry;
    const childBatches = group.children.length > 0 ? group.children : group.standalone;
    const buildingBatches = childBatches.map(b => ({ batch: b, receipts: allReceipts.filter(r => r.batch_id === b.id) }));
    const entityAllReceipts = buildingBatches.flatMap(bb => bb.receipts);
    return {
      entityName: group.entity?.name || "Unknown Entity",
      buildingBatches,
      allReceipts: entityAllReceipts,
      // Use first child batch as the "batch" prop for BatchDocumentPreview
      firstBatch: childBatches[0],
    };
  })() : null;

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Deposit Batches</h1>
        <p className="text-sm text-muted-foreground mt-1">Group receipts into one transfer per property. Download reports for your accountant.</p>
      </div>

      {!hasAnyBatches && reversedBatches.length === 0 ? (
        <div className="vault-card p-8 text-center text-muted-foreground text-sm">No deposit batches yet. Create one from the Entry & Recording page.</div>
      ) : (
        <div className="space-y-6">
          {entityGroups.map(([entityId, group]) => renderEntityGroup(entityId, group))}

          {unassignedBatches.length > 0 && (
            <div className="space-y-3">
              {entityGroups.length > 0 && (
                <div className="px-1">
                  <h3 className="text-sm font-semibold text-muted-foreground">Unassigned Batches</h3>
                </div>
              )}
              <div className="space-y-3">
                {unassignedBatches.map((batch, i) => renderBatchCard(batch, i))}
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

      {previewEntityData && (
        <Suspense fallback={null}>
          <BatchDocumentPreview
            receipts={previewEntityData.allReceipts}
            batch={previewEntityData.firstBatch}
            onClose={() => setPreviewEntityId(null)}
            groupedMode={{
              entityName: previewEntityData.entityName,
              buildingBatches: previewEntityData.buildingBatches,
            }}
          />
        </Suspense>
      )}
    </div>
  );
}