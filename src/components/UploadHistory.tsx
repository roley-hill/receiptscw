import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, ChevronRight, FileText, CheckCircle2, AlertCircle, Clock, Ban } from "lucide-react";
import { format } from "date-fns";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface BatchFile {
  id: string;
  file_name: string;
  file_size: number;
  status: string;
  error: string | null;
  inserted_count: number | null;
  duplicate_count: number | null;
  total_line_items: number | null;
}

interface UploadBatch {
  id: string;
  file_count: number;
  processed_count: number;
  status: string;
  created_at: string;
  uploaded_by_name: string | null;
  uploaded_by_email: string | null;
}

export default function UploadHistory() {
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [expandedCancelled, setExpandedCancelled] = useState<string | null>(null);
  const [batchFiles, setBatchFiles] = useState<Record<string, BatchFile[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBatches();
  }, []);

  const loadBatches = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("upload_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (!error && data) setBatches(data as UploadBatch[]);
    setLoading(false);
  };

  const loadBatchFiles = async (batchId: string) => {
    if (batchFiles[batchId]) return;
    const { data, error } = await supabase
      .from("upload_batch_files")
      .select("*")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true });
    if (!error && data) {
      setBatchFiles((prev) => ({ ...prev, [batchId]: data as BatchFile[] }));
    }
  };

  const toggleBatch = (batchId: string) => {
    const isExpanding = expandedBatch !== batchId;
    setExpandedBatch(isExpanding ? batchId : null);
    if (isExpanding) loadBatchFiles(batchId);
  };

  const toggleCancelled = (batchId: string) => {
    const isExpanding = expandedCancelled !== batchId;
    setExpandedCancelled(isExpanding ? batchId : null);
    if (isExpanding) loadBatchFiles(batchId);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statusIcon = (status: string) => {
    if (status === "done" || status === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-accent" />;
    if (status === "error") return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
    if (status === "cancelled") return <Ban className="h-3.5 w-3.5 text-muted-foreground" />;
    return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground py-4">Loading extraction history...</div>;
  }

  if (batches.length === 0) {
    return <div className="text-sm text-muted-foreground py-4">No previous extractions found.</div>;
  }

  return (
    <div className="space-y-2">
      {batches.map((batch) => {
        const files = batchFiles[batch.id];
        const successFiles = files?.filter((f) => f.status === "done") ?? [];
        const cancelledFiles = files?.filter((f) => f.status === "cancelled") ?? [];
        const successCount = files ? successFiles.length : batch.status === "completed" ? batch.processed_count : null;
        const isOpen = expandedBatch === batch.id;
        const isCancelledOpen = expandedCancelled === batch.id;

        return (
          <div key={batch.id} className="space-y-1">
            {/* Successful extractions */}
            <Collapsible open={isOpen} onOpenChange={() => toggleBatch(batch.id)}>
              <CollapsibleTrigger className="w-full">
                <div className="vault-card flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-medium text-foreground">
                      {successCount != null ? successCount : "—"} file{successCount !== 1 ? "s" : ""} extracted
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {batch.uploaded_by_name || batch.uploaded_by_email || "Unknown"} · {format(new Date(batch.created_at), "MMM d, yyyy h:mm a")}
                    </p>
                  </div>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                    extracted
                  </span>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="ml-8 border-l border-border pl-4 pb-2 space-y-1">
                  {!files ? (
                    <p className="text-xs text-muted-foreground py-2">Loading files...</p>
                  ) : successFiles.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">No successfully extracted files.</p>
                  ) : (
                    successFiles.map((file) => (
                      <div key={file.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/30">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs text-foreground truncate flex-1">{file.file_name}</span>
                        <span className="text-xs text-muted-foreground">{formatSize(file.file_size)}</span>
                        <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
                        {file.inserted_count != null && (
                          <span className="text-xs text-accent">{file.inserted_count} extracted</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Cancelled files for this batch */}
            {((files && cancelledFiles.length > 0) || batch.status === "cancelled") && (
              <Collapsible open={isCancelledOpen} onOpenChange={() => toggleCancelled(batch.id)}>
                <CollapsibleTrigger className="w-full">
                  <div className="vault-card flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer ml-4">
                    {isCancelledOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <Ban className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {files ? cancelledFiles.length : "—"} cancelled file{cancelledFiles.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="ml-12 border-l border-border pl-4 pb-2 space-y-1">
                    {!files ? (
                      <p className="text-xs text-muted-foreground py-2">Loading files...</p>
                    ) : (
                      cancelledFiles.map((file) => (
                        <div key={file.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/30">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground truncate flex-1">{file.file_name}</span>
                          <span className="text-xs text-muted-foreground">{formatSize(file.file_size)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        );
      })}
    </div>
  );
}