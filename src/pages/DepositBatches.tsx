import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchBatches, fetchReceipts, reverseBatch, moveReceiptsToNewBatch } from "@/lib/api";
import { downloadBatchPDF, generateBatchXLSX, downloadBatchZIP } from "@/lib/batchReports";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useState, lazy, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";
import BatchCard from "@/components/BatchCard";

const BatchDocumentPreview = lazy(() => import("@/components/BatchDocumentPreview"));

export default function DepositBatches() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { data: batches = [], isLoading } = useQuery({ queryKey: ["batches"], queryFn: fetchBatches });
  const { data: allReceipts = [] } = useQuery({ queryKey: ["receipts"], queryFn: fetchReceipts });
  const [downloadingZip, setDownloadingZip] = useState<string | null>(null);
  const [previewBatchId, setPreviewBatchId] = useState<string | null>(null);
  const [movingBatchId, setMovingBatchId] = useState<string | null>(null);

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
      toast({
        title: "Receipts moved",
        description: `Created new batch ${newBatch.batch_id} with the selected receipts.`,
      });
    },
    onError: (e: Error) => {
      setMovingBatchId(null);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const handleZipDownload = async (batch: any, receipts: any[]) => {
    setDownloadingZip(batch.id);
    try {
      await downloadBatchZIP(batch, receipts);
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "ZIP download failed", variant: "destructive" });
    } finally {
      setDownloadingZip(null);
    }
  };

  const handleMoveReceipts = (batchId: string, property: string, receiptIds: string[]) => {
    setMovingBatchId(batchId);
    moveMutation.mutate({ sourceBatchId: batchId, receiptIds, property });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Deposit Batches</h1>
          <p className="text-sm text-muted-foreground mt-1">Group receipts into one transfer per property. Download reports for your accountant.</p>
        </div>
        <Button variant="default" size="sm"><Layers className="h-4 w-4 mr-2" />Create Batch</Button>
      </div>

      {batches.length === 0 ? (
        <div className="vault-card p-8 text-center text-muted-foreground text-sm">No deposit batches yet. Create one from the Entry & Recording page.</div>
      ) : (
        <div className="space-y-4">
          {batches.map((batch, i) => {
            const receipts = allReceipts.filter((r) => r.batch_id === batch.id);
            return (
              <BatchCard
                key={batch.id}
                batch={batch}
                receipts={receipts}
                index={i}
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
          })}
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
