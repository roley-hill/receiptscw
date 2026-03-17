import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchBatches, fetchReceipts, reverseBatch, moveReceiptsToNewBatch } from "@/lib/api";
import { downloadBatchPDF, generateBatchXLSX, downloadBatchZIP, downloadGroupedOwnerPDF, generateGroupedXLSX, downloadGroupedZIP } from "@/lib/batchReports";
import { supabase } from "@/integrations/supabase/client";
import { Building2, ChevronDown, ChevronRight, FileText as FileTextIcon, FileSpreadsheet, Layers, Eye, PackageOpen, Mail, Undo2, SquareCheck, Copy, Check, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { useState, useMemo, lazy, Suspense } from "react";
import { useUndoStack } from "@/hooks/useUndoStack";
import { useAuth } from "@/hooks/useAuth";
import { motion } from "framer-motion";
import BatchCard from "@/components/BatchCard";
import ImportDepositPDFs from "@/components/ImportDepositPDFs";

const BatchDocumentPreview = lazy(() => import("@/components/BatchDocumentPreview"));

type OwnerEntity = { id: string; name: string };

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });

export default function DepositBatches() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { pushUndo } = useUndoStack("batches");
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const copyAmount = (key: string, amount: number) => {
    navigator.clipboard.writeText(amount.toFixed(2));
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const reverseMutation = useMutation({
    mutationFn: (batchId: string) => reverseBatch(batchId),
    onSuccess: (_data, batchId) => {
      // Note: undo for batch reversal would require re-creating the batch which is complex,
      // so we don't add undo for this destructive action
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

  const { entityGroups, unassignedBatches, reversedBatches, bulkBatches } = useMemo(() => {
    const active = batches.filter(b => b.status !== "reversed");
    const reversed = batches.filter(b => b.status === "reversed");
    const parentBatchIds = new Set(active.filter(b => b.parent_batch_id).map(b => b.parent_batch_id!));
    const childBatchIds = new Set(active.filter(b => b.parent_batch_id).map(b => b.id));

    const entityMap: Record<string, EntityGroup> = {};
    const unassigned: typeof batches = [];
    // Cross-entity bulk batches: parent batches with no ownership_entity_id that have children
    const bulk: GroupedSet[] = [];

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
      } else if (parentBatchIds.has(batch.id)) {
        // Cross-entity parent batch (no entity, has children)
        bulk.push({
          parentBatch: batch,
          children: active.filter(b => b.parent_batch_id === batch.id),
        });
      } else {
        unassigned.push(batch);
      }
    }

    const sorted = Object.entries(entityMap).sort(([, a], [, b]) =>
      (a.entity?.name || "").localeCompare(b.entity?.name || "")
    );

    return { entityGroups: sorted, unassignedBatches: unassigned, reversedBatches: reversed, bulkBatches: bulk };
  }, [batches, ownerEntities]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  const hasAnyBatches = entityGroups.length > 0 || unassignedBatches.length > 0 || bulkBatches.length > 0;

  const renderEntityGroup = (entityId: string, group: EntityGroup) => {
    const isCollapsed = collapsedEntities.has(entityId);
    const allChildren = group.groupedSets.flatMap(gs => gs.children);
    const allGroupBatches = [...group.groupedSets.map(gs => gs.parentBatch), ...allChildren, ...group.standalone];
    const allGroupReceipts = allGroupBatches.flatMap(b => allReceipts.filter(r => r.batch_id === b.id));
    const entityTotal = allGroupReceipts.reduce((s, r) => s + Number(r.amount), 0);
    const entityReceiptCount = allGroupReceipts.length;
    const batchCount = group.groupedSets.length + group.standalone.length;
    const entityName = group.entity?.name || "Unknown Entity";

    return (
      <div key={entityId} className="space-y-3">
        {/* Entity header — collapsible grouping only, no actions */}
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
                {batchCount} {batchCount === 1 ? "deposit batch" : "deposit batches"} · {entityReceiptCount} receipts
              </p>
            </div>
          </button>
          <div className="text-right">
            <p className="text-lg vault-mono font-bold text-foreground">${fmt(entityTotal)}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
        </motion.div>

        {!isCollapsed && (
          <div className="space-y-4 pl-6 border-l-2 border-accent/20 ml-4">
            {/* Each grouped deposit batch gets its own header with full actions */}
            {group.groupedSets.map((gs, gsIndex) => {
              const sectionKey = `${entityId}__grouped_${gsIndex}`;
              const isSectionCollapsed = collapsedSections.has(sectionKey);
              const childBatches = gs.children.sort((a, b) => a.property.localeCompare(b.property));
              const groupedReceipts = childBatches.flatMap(b => allReceipts.filter(r => r.batch_id === b.id));
              const groupedTotal = groupedReceipts.reduce((s, r) => s + Number(r.amount), 0);
              const buildingBatches = childBatches.map(b => ({ batch: b, receipts: allReceipts.filter(r => r.batch_id === b.id) }));
              const childBatchIds = childBatches.map(b => b.id);

              return (
                <div key={sectionKey} className="space-y-3">
                  {/* Batch-level header with ALL actions */}
                  <div className="vault-card px-4 py-3 flex items-center justify-between">
                    <button onClick={() => toggleSection(sectionKey)} className="group flex items-center gap-2 text-sm font-semibold text-foreground hover:opacity-80 transition-opacity cursor-pointer flex-1">
                      {isSectionCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                      <Layers className="h-3.5 w-3.5 text-accent" />
                      <span>Deposit Batch — {gs.parentBatch.batch_id}</span>
                      <span className="text-xs vault-mono text-muted-foreground font-normal ml-1">
                        {childBatches.length} properties · {groupedReceipts.length} receipts ·{" "}
                        <button
                          onClick={(e) => { e.stopPropagation(); copyAmount(sectionKey, groupedTotal); }}
                          className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-copy"
                          title="Click to copy amount"
                        >
                          ${fmt(groupedTotal)}
                          {copiedKey === sectionKey ? <Check className="h-3 w-3 text-accent" /> : <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100" />}
                        </button>
                      </span>
                    </button>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setPreviewEntityId(entityId + "__gs__" + gsIndex); }} title="Preview all documents">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline" size="sm"
                        disabled={downloadingEntityZip === sectionKey}
                        onClick={(e) => { e.stopPropagation(); handleEntityZipDownload(sectionKey, entityName, buildingBatches); }}
                        title="Download deposit package (ZIP)"
                      >
                        {downloadingEntityZip === sectionKey ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <PackageOpen className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); downloadGroupedOwnerPDF(entityName, buildingBatches); }} title="Download PDF report">
                        <FileTextIcon className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); generateGroupedXLSX(entityName, buildingBatches); }} title="Download XLSX report">
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="outline" size="sm" title="Email report" onClick={(e) => e.stopPropagation()}>
                        <Mail className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" title="Reverse this batch" className="text-destructive hover:text-destructive" onClick={(e) => e.stopPropagation()}>
                            <Undo2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Reverse Batch {gs.parentBatch.batch_id}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will reverse all {childBatchIds.length} property batches in this deposit batch, unlinking {groupedReceipts.length} receipts. They will be available for re-batching.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => reverseEntityMutation.mutate(childBatchIds)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                              Reverse Batch
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                  {/* Property cards within this batch — no individual actions */}
                  {!isSectionCollapsed && <div className="space-y-3 pl-4">{childBatches.map((batch, i) => renderBatchCard(batch, i, true))}</div>}
                </div>
              );
            })}

            {/* Standalone single-property batches keep their own actions */}
            {group.standalone.length > 0 && group.standalone.sort((a, b) => a.property.localeCompare(b.property)).map((batch, i) => renderBatchCard(batch, i))}
          </div>
        )}
      </div>
    );
  };


  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Deposit Batches</h1>
          <p className="text-sm text-muted-foreground mt-1">Group receipts into one transfer per property. Download reports for your accountant.</p>
        </div>
        <Button
          variant={showImport ? "default" : "outline"}
          size="sm"
          onClick={() => setShowImport(v => !v)}
        >
          <Upload className="h-3.5 w-3.5 mr-1.5" />
          Import from AppFolio
        </Button>
      </div>

      {showImport && (
        <div className="vault-card p-5">
          <ImportDepositPDFs />
        </div>
      )}

      {!hasAnyBatches && reversedBatches.length === 0 ? (
        <div className="vault-card p-8 text-center text-muted-foreground text-sm">No deposit batches yet. Create one from the Entry & Recording page.</div>
      ) : (
        <div className="space-y-6">
          {entityGroups.map(([entityId, group]) => renderEntityGroup(entityId, group))}

          {/* Bulk Deposit Batches (cross-entity) */}
          {bulkBatches.length > 0 && (
            <div className="space-y-3">
              <div className="px-1">
                <h3 className="text-sm font-semibold text-muted-foreground">Bulk Deposit Batches</h3>
              </div>
              {bulkBatches.map((gs, gsIndex) => {
                const sectionKey = `bulk__${gsIndex}`;
                const isSectionCollapsed = collapsedSections.has(sectionKey);
                const childBatches = gs.children.sort((a, b) => a.property.localeCompare(b.property));
                const groupedReceipts = childBatches.flatMap(b => allReceipts.filter(r => r.batch_id === b.id));
                const groupedTotal = groupedReceipts.reduce((s, r) => s + Number(r.amount), 0);
                const buildingBatches = childBatches.map(b => ({ batch: b, receipts: allReceipts.filter(r => r.batch_id === b.id) }));
                const childBatchIds = childBatches.map(b => b.id);

                return (
                  <div key={sectionKey} className="space-y-3">
                    <div className="vault-card px-4 py-3 flex items-center justify-between">
                      <button onClick={() => toggleSection(sectionKey)} className="group flex items-center gap-2 text-sm font-semibold text-foreground hover:opacity-80 transition-opacity cursor-pointer flex-1">
                        {isSectionCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                        <Layers className="h-3.5 w-3.5 text-accent" />
                        <span>Bulk Deposit — {gs.parentBatch.batch_id}</span>
                        <span className="text-xs vault-mono text-muted-foreground font-normal ml-1">
                          {childBatches.length} properties · {groupedReceipts.length} receipts ·{" "}
                          <button
                            onClick={(e) => { e.stopPropagation(); copyAmount(sectionKey, groupedTotal); }}
                            className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-copy"
                            title="Click to copy amount"
                          >
                            ${fmt(groupedTotal)}
                            {copiedKey === sectionKey ? <Check className="h-3 w-3 text-accent" /> : <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100" />}
                          </button>
                        </span>
                      </button>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setPreviewEntityId("bulk__" + gsIndex); }} title="Preview all documents">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline" size="sm"
                          disabled={downloadingEntityZip === sectionKey}
                          onClick={(e) => { e.stopPropagation(); handleEntityZipDownload(sectionKey, gs.parentBatch.property, buildingBatches); }}
                          title="Download deposit package (ZIP)"
                        >
                          {downloadingEntityZip === sectionKey ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <PackageOpen className="h-3.5 w-3.5" />}
                        </Button>
                        <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); downloadGroupedOwnerPDF(gs.parentBatch.property, buildingBatches); }} title="Download PDF report">
                          <FileTextIcon className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); generateGroupedXLSX(gs.parentBatch.property, buildingBatches); }} title="Download XLSX report">
                          <FileSpreadsheet className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="outline" size="sm" title="Email report" onClick={(e) => e.stopPropagation()}>
                          <Mail className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" title="Reverse this batch" className="text-destructive hover:text-destructive" onClick={(e) => e.stopPropagation()}>
                              <Undo2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Reverse Bulk Batch {gs.parentBatch.batch_id}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will reverse all {childBatchIds.length} property batches in this bulk deposit, unlinking {groupedReceipts.length} receipts. They will be available for re-batching.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => reverseEntityMutation.mutate(childBatchIds)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Reverse Batch
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                    {!isSectionCollapsed && <div className="space-y-3 pl-4">{childBatches.map((batch, i) => renderBatchCard(batch, i, true))}</div>}
                  </div>
                );
              })}
            </div>
          )}

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

      {previewEntityId && (() => {
        // Handle bulk batch previews
        if (previewEntityId.startsWith("bulk__")) {
          const gsIdx = Number(previewEntityId.replace("bulk__", ""));
          const gs = bulkBatches[gsIdx];
          if (!gs) return null;
          const childBatches = gs.children.sort((a, b) => a.property.localeCompare(b.property));
          const buildingBatches = childBatches.map(b => ({ batch: b, receipts: allReceipts.filter(r => r.batch_id === b.id) }));
          const previewReceipts = buildingBatches.flatMap(bb => bb.receipts);
          return (
            <Suspense fallback={null}>
              <BatchDocumentPreview
                receipts={previewReceipts}
                batch={childBatches[0]}
                onClose={() => setPreviewEntityId(null)}
                groupedMode={{ entityName: gs.parentBatch.property, buildingBatches }}
              />
            </Suspense>
          );
        }

        // Handle entity grouped batch previews
        const parts = previewEntityId.split("__gs__");
        if (parts.length !== 2) return null;
        const [eid, gsIdxStr] = parts;
        const gsIdx = Number(gsIdxStr);
        const entry = entityGroups.find(([id]) => id === eid);
        if (!entry) return null;
        const [, group] = entry;
        const gs = group.groupedSets[gsIdx];
        if (!gs) return null;
        const childBatches = gs.children.sort((a, b) => a.property.localeCompare(b.property));
        const buildingBatches = childBatches.map(b => ({ batch: b, receipts: allReceipts.filter(r => r.batch_id === b.id) }));
        const previewReceipts = buildingBatches.flatMap(bb => bb.receipts);
        const entityName = group.entity?.name || "Unknown Entity";
        return (
          <Suspense fallback={null}>
            <BatchDocumentPreview
              receipts={previewReceipts}
              batch={childBatches[0]}
              onClose={() => setPreviewEntityId(null)}
              groupedMode={{ entityName, buildingBatches }}
            />
          </Suspense>
        );
      })()}
    </div>
  );
}