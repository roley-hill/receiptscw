import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { Upload as UploadIcon, FolderOpen, FileText, Image, AlertCircle, CheckCircle2, X, Loader2, Copy, Ban, ChevronDown, ChevronRight, AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadReceiptFile } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useUploadStore, UploadedFile } from "@/hooks/useUploadStore";
import { supabase } from "@/integrations/supabase/client";
import UploadHistory from "@/components/UploadHistory";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function UploadPage() {
  const { files, setFiles, isProcessing, setIsProcessing, cancelledRef, cancelExtraction } = useUploadStore();
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { session, user } = useAuth();
  const queryClient = useQueryClient();
  const [historyKey, setHistoryKey] = useState(0);
  const [cancelledOpen, setCancelledOpen] = useState(false);

  const handleFiles = (fileList: FileList) => {
    const accepted = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/jpg", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "message/rfc822", "application/octet-stream"];
    const newFiles = Array.from(fileList)
      .filter((f) => {
        const ext = f.name.split(".").pop()?.toLowerCase();
        return accepted.includes(f.type) || ["xlsx", "xls", "eml", "pdf"].includes(ext || "") || f.type.startsWith("image/");
      })
      .map((f) => ({
        id: `${f.name}-${Date.now()}-${Math.random()}`,
        name: f.name,
        size: f.size,
        type: f.type,
        file: f,
        status: "pending" as const,
      }));
    if (newFiles.length === 0) {
      toast.error("No supported files found. Upload PDF, JPG, PNG, XLSX, or EML files.");
      return;
    }
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const startExtraction = async () => {
    if (!session?.access_token) {
      toast.error("Not authenticated");
      return;
    }
    cancelledRef.current = false;
    setIsProcessing(true);
    const pending = files.filter((f) => f.status === "pending");

    // Create upload batch record
    const { data: profile } = await supabase.from("profiles").select("display_name, email").eq("user_id", user?.id ?? "").maybeSingle();
    const { data: batch } = await supabase.from("upload_batches").insert({
      file_count: pending.length,
      user_id: user?.id ?? null,
      uploaded_by_name: profile?.display_name ?? null,
      uploaded_by_email: profile?.email ?? user?.email ?? null,
    } as any).select().single();

    const batchId = batch?.id;

    // Insert file records
    if (batchId) {
      await supabase.from("upload_batch_files").insert(
        pending.map((f) => ({
          batch_id: batchId,
          file_name: f.name,
          file_size: f.size,
          status: "pending",
        } as any))
      );
    }

    let processedCount = 0;
    for (let i = 0; i < pending.length; i++) {
      if (cancelledRef.current) {
        // Mark remaining as cancelled
        const remaining = pending.slice(i);
        setFiles((prev) =>
          prev.map((pf) =>
            remaining.some((r) => r.id === pf.id) && pf.status === "pending"
              ? { ...pf, status: "cancelled", error: "Cancelled" }
              : pf
          )
        );
        if (batchId) {
          await supabase.from("upload_batch_files")
            .update({ status: "cancelled", error: "Cancelled by user" } as any)
            .eq("batch_id", batchId)
            .eq("status", "pending");
          await supabase.from("upload_batches")
            .update({ status: "cancelled", processed_count: processedCount } as any)
            .eq("id", batchId);
        }
        toast.info("Extraction cancelled.");
        break;
      }

      const f = pending[i];
      setFiles((prev) =>
        prev.map((pf) => (pf.id === f.id ? { ...pf, status: "processing" } : pf))
      );

      try {
        const result = await uploadReceiptFile(f.file, session.access_token);
        
        if (result.skipped_already_processed) {
          setFiles((prev) =>
            prev.map((pf) =>
              pf.id === f.id
                ? { ...pf, status: "done", insertedCount: 0, duplicateCount: 0, totalLineItems: 0, error: `Already processed (${result.existing_count} receipt(s) exist)` }
                : pf
            )
          );
          processedCount++;
          toast.info(`${f.name} already processed — skipped.`);
          if (batchId) {
            await supabase.from("upload_batch_files")
              .update({ status: "skipped", error: "Already processed" } as any)
              .eq("batch_id", batchId)
              .eq("file_name", f.name);
          }
          continue;
        }

        const insertedCount = result.inserted_count ?? 1;
        const duplicateCount = result.duplicate_count ?? 0;
        const totalLineItems = result.total_line_items ?? 1;
        const duplicateContentWarning = result.duplicate_content_warning ?? false;
        const duplicateContentFile = result.duplicate_content_file ?? null;
        const duplicateContentCount = result.duplicate_content_count ?? 0;
        const fileContentHash = result.file_content_hash ?? null;

        setFiles((prev) =>
          prev.map((pf) =>
            pf.id === f.id
              ? { ...pf, status: "done", insertedCount, duplicateCount, totalLineItems, duplicateContentWarning, duplicateContentFile, duplicateContentCount, fileContentHash }
              : pf
          )
        );
        processedCount++;

        if (batchId) {
          await supabase.from("upload_batch_files")
            .update({ status: "done", inserted_count: insertedCount, duplicate_count: duplicateCount, total_line_items: totalLineItems } as any)
            .eq("batch_id", batchId)
            .eq("file_name", f.name);
        }

        if (duplicateCount > 0) {
          toast.warning(`${duplicateCount} duplicate(s) skipped in ${f.name}`);
        }
      } catch (err: any) {
        setFiles((prev) =>
          prev.map((pf) =>
            pf.id === f.id
              ? { ...pf, status: "error", error: err.message }
              : pf
          )
        );
        processedCount++;

        if (batchId) {
          await supabase.from("upload_batch_files")
            .update({ status: "error", error: err.message } as any)
            .eq("batch_id", batchId)
            .eq("file_name", f.name);
        }
      }
    }

    if (batchId && !cancelledRef.current) {
      await supabase.from("upload_batches")
        .update({ status: "completed", processed_count: processedCount } as any)
        .eq("id", batchId);
    }

    setIsProcessing(false);
    cancelledRef.current = false;
    queryClient.invalidateQueries({ queryKey: ["receipts"] });
    queryClient.invalidateQueries({ queryKey: ["pending_counts"] });
    setHistoryKey((k) => k + 1);
    if (!cancelledRef.current) {
      toast.success("Extraction complete!");
      // Clear completed files from the upload list after a brief delay so user sees final state
      setTimeout(() => {
        setFiles((prev) => prev.filter((f) => f.status !== "done"));
      }, 2000);
    }
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) return <Image className="h-4 w-4 text-primary" />;
    return <FileText className="h-4 w-4 text-accent" />;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "done").length;
  const cancelledFiles = files.filter((f) => f.status === "cancelled");
  const activeFiles = files.filter((f) => f.status !== "cancelled");

  const handleDeleteDuplicateContent = async (fileContentHash: string, originalFileName: string) => {
    try {
      // Get all receipt IDs with this hash that belong to the ORIGINAL file (not the newly uploaded one)
      const { data: toDelete } = await supabase
        .from("receipts")
        .select("id")
        .eq("file_content_hash", fileContentHash)
        .eq("file_name", originalFileName);
      
      if (!toDelete || toDelete.length === 0) {
        toast.info("No duplicate receipts found to delete.");
        return;
      }

      const ids = toDelete.map(r => r.id);
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const { error } = await supabase.from("receipts").delete().in("id", chunk);
        if (error) throw error;
      }

      toast.success(`Deleted ${ids.length} duplicate receipt(s) from "${originalFileName.replace(/^Receipts\//, "")}"`);
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      
      // Clear the warning from the file
      setFiles(prev => prev.map(f => 
        f.fileContentHash === fileContentHash 
          ? { ...f, duplicateContentWarning: false, duplicateContentFile: undefined, duplicateContentCount: undefined }
          : f
      ));
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {isProcessing && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm text-foreground">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <span>
            <strong>Extraction in progress</strong> — Please do not navigate away from this app or close the tab, or progress will be lost.
          </span>
        </div>
      )}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Upload Receipts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload rent receipt files or remittance details. AI will extract each line item as a separate receipt. Supported: PDF, JPG, PNG, XLSX, EML.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.heic,.xlsx,.xls,.eml"
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-ignore
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`
          vault-card cursor-pointer border-2 border-dashed transition-all duration-200
          flex flex-col items-center justify-center py-16 gap-4
          ${isDragging ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"}
        `}
      >
        <div className="h-14 w-14 rounded-xl bg-muted flex items-center justify-center">
          <UploadIcon className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Drop receipt files or remittance details here</p>
          <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG, XLSX, EML — each line item will become a separate receipt</p>
        </div>
        <div className="flex gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
            <FolderOpen className="h-4 w-4 mr-2" /> Browse Files
          </Button>
          <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click(); }}>
            <FolderOpen className="h-4 w-4 mr-2" /> Browse Folder
          </Button>
        </div>
      </motion.div>

      {activeFiles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              {activeFiles.length} file{activeFiles.length !== 1 ? "s" : ""} · {doneCount} extracted · {pendingCount} pending
            </h2>
            <div className="flex items-center gap-2">
              {isProcessing && (
                <Button variant="outline" size="sm" onClick={cancelExtraction} className="text-destructive border-destructive/30 hover:bg-destructive/10">
                  <Ban className="h-4 w-4 mr-1" /> Cancel
                </Button>
              )}
              {pendingCount > 0 && !isProcessing && (
                <Button variant="default" size="sm" onClick={startExtraction}>
                  Start Extraction
                </Button>
              )}
              {isProcessing && (
                <Button variant="default" size="sm" disabled>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Extracting...
                </Button>
              )}
            </div>
          </div>
           <div className="vault-card divide-y divide-border">
            {activeFiles.map((file) => (
              <div key={file.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {getFileIcon(file.type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatSize(file.size)}
                      {file.status === "done" && file.totalLineItems !== undefined && (
                        <span className="ml-2 vault-mono text-accent">
                          → {file.insertedCount} receipt{file.insertedCount !== 1 ? "s" : ""} extracted
                          {(file.totalLineItems ?? 0) > 1 && ` (from ${file.totalLineItems} line items)`}
                        </span>
                      )}
                      {file.status === "done" && (file.duplicateCount ?? 0) > 0 && (
                        <span className="ml-2 vault-mono text-amber-500 flex items-center gap-1 inline-flex">
                          <Copy className="h-3 w-3" /> {file.duplicateCount} duplicate{file.duplicateCount !== 1 ? "s" : ""} skipped
                        </span>
                      )}
                      {file.error && <span className="ml-2 text-destructive">{file.error}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {file.status === "done" && <CheckCircle2 className="h-4 w-4 text-accent" />}
                    {file.status === "processing" && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
                    {file.status === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
                    {file.status === "pending" && (
                      <button onClick={(e) => { e.stopPropagation(); removeFile(file.id); }} className="p-1 rounded hover:bg-muted">
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                </div>
                {file.duplicateContentWarning && file.duplicateContentFile && file.fileContentHash && (
                  <div className="mt-2 ml-7 p-3 rounded-lg bg-muted/50 border border-border">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <p className="text-xs font-medium text-foreground">
                          Duplicate content detected
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          This file has identical content to "{file.duplicateContentFile.replace(/^Receipts\//, "")}" which has {file.duplicateContentCount} existing receipt(s). This may be a duplicate download with a different name.
                        </p>
                        <div className="mt-2">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="destructive" size="sm" className="h-7 text-xs">
                                <Trash2 className="h-3 w-3 mr-1" />
                                Delete {file.duplicateContentCount} receipt(s) from original file
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete duplicate file's receipts?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will delete all {file.duplicateContentCount} receipt(s) from "{file.duplicateContentFile.replace(/^Receipts\//, "")}". 
                                  The receipts from this new upload ("{file.name}") will be kept.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction 
                                  onClick={() => handleDeleteDuplicateContent(file.fileContentHash!, file.duplicateContentFile!)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete Duplicates
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {cancelledFiles.length > 0 && (
        <Collapsible open={cancelledOpen} onOpenChange={setCancelledOpen}>
          <CollapsibleTrigger className="w-full">
            <div className="vault-card flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer">
              {cancelledOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <Ban className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">
                {cancelledFiles.length} cancelled file{cancelledFiles.length !== 1 ? "s" : ""}
              </span>
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="vault-card divide-y divide-border mt-1">
              {cancelledFiles.map((file) => (
                <div key={file.id} className="flex items-center gap-3 px-4 py-3">
                  {getFileIcon(file.type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">Cancelled</span>
                  <button onClick={() => removeFile(file.id)} className="p-1 rounded hover:bg-muted">
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Upload History */}
      <div className="pt-4 border-t border-border">
        <h2 className="text-sm font-semibold text-foreground mb-3">Extraction History</h2>
        <UploadHistory key={historyKey} />
      </div>
    </div>
  );
}