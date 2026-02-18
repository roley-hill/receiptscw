import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, ChevronRight, FileText, CheckCircle2, AlertCircle, Clock } from "lucide-react";
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

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statusIcon = (status: string) => {
    if (status === "done" || status === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-accent" />;
    if (status === "error") return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
    return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground py-4">Loading upload history...</div>
    );
  }

  if (batches.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4">No previous uploads found.</div>
    );
  }

  return (
    <div className="space-y-2">
      {batches.map((batch) => {
        const isOpen = expandedBatch === batch.id;
        const files = batchFiles[batch.id];
        return (
          <Collapsible key={batch.id} open={isOpen} onOpenChange={() => toggleBatch(batch.id)}>
            <CollapsibleTrigger className="w-full">
              <div className="vault-card flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                {statusIcon(batch.status)}
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-foreground">
                    {batch.file_count} file{batch.file_count !== 1 ? "s" : ""} uploaded
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {batch.uploaded_by_name || batch.uploaded_by_email || "Unknown"} · {format(new Date(batch.created_at), "MMM d, yyyy h:mm a")}
                  </p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  batch.status === "completed" ? "bg-accent/10 text-accent" :
                  batch.status === "cancelled" ? "bg-muted text-muted-foreground" :
                  "bg-primary/10 text-primary"
                }`}>
                  {batch.status}
                </span>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-8 border-l border-border pl-4 pb-2 space-y-1">
                {!files ? (
                  <p className="text-xs text-muted-foreground py-2">Loading files...</p>
                ) : files.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No file records found.</p>
                ) : (
                  files.map((file) => (
                    <div key={file.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/30">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-xs text-foreground truncate flex-1">{file.file_name}</span>
                      <span className="text-xs text-muted-foreground">{formatSize(file.file_size)}</span>
                      {statusIcon(file.status)}
                      {file.status === "done" && file.inserted_count != null && (
                        <span className="text-xs text-accent">{file.inserted_count} extracted</span>
                      )}
                      {file.status === "error" && file.error && (
                        <span className="text-xs text-destructive truncate max-w-[150px]" title={file.error}>{file.error}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}