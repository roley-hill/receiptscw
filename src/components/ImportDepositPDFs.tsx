import { useState, useRef, useCallback } from "react";
import { Upload, FolderOpen, CheckCircle2, XCircle, Loader2, FileText, AlertTriangle, MinusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

interface FileResult {
  fileName: string;
  status: "pending" | "processing" | "perfect" | "partial" | "unrelated" | "skipped" | "error";
  message?: string;
  depositNumber?: string;
  matchedCount?: number;
  unmatchedCount?: number;
}

export default function ImportDepositPDFs() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileResult[]>([]);
  const [processing, setProcessing] = useState(false);
  const [completed, setCompleted] = useState(0);

  const handleFiles = useCallback(async (selectedFiles: FileList | null) => {
    if (!selectedFiles || selectedFiles.length === 0 || !session?.access_token) return;

    const pdfFiles = Array.from(selectedFiles).filter(f =>
      f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );

    if (pdfFiles.length === 0) {
      toast({ title: "No PDFs found", description: "Please select PDF files.", variant: "destructive" });
      return;
    }

    pdfFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const results: FileResult[] = pdfFiles.map(f => ({
      fileName: f.name,
      status: "pending" as const,
    }));
    setFiles(results);
    setProcessing(true);
    setCompleted(0);

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-deposit-pdf`;
    let perfectCount = 0;
    let partialCount = 0;
    let unrelatedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < pdfFiles.length; i++) {
      results[i] = { ...results[i], status: "processing" };
      setFiles([...results]);

      try {
        const formData = new FormData();
        formData.append("file", pdfFiles[i]);

        const resp = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: formData,
        });

        const data = await resp.json();

        if (!resp.ok) {
          results[i] = { ...results[i], status: "error", message: data.error || `HTTP ${resp.status}` };
          errorCount++;
        } else if (data.status === "skipped") {
          results[i] = { ...results[i], status: "skipped", message: data.message, depositNumber: data.batch_id };
        } else if (data.status === "perfect") {
          results[i] = {
            ...results[i], status: "perfect", depositNumber: data.batch_id,
            matchedCount: data.matched_count, unmatchedCount: 0,
            message: `✓ All ${data.matched_count} receipts matched — batch created`,
          };
          perfectCount++;
        } else if (data.status === "partial") {
          results[i] = {
            ...results[i], status: "partial", depositNumber: data.batch_id,
            matchedCount: data.matched_count, unmatchedCount: data.unmatched_count,
            message: `${data.matched_count}/${data.matched_count + data.unmatched_count} matched — NOT batched`,
          };
          partialCount++;
        } else if (data.status === "unrelated") {
          results[i] = {
            ...results[i], status: "unrelated", depositNumber: data.batch_id,
            matchedCount: 0, unmatchedCount: data.unmatched_count,
            message: `No matching receipts — unrelated deposit`,
          };
          unrelatedCount++;
        }
      } catch (err: any) {
        results[i] = { ...results[i], status: "error", message: err.message || "Network error" };
        errorCount++;
      }

      setCompleted(i + 1);
      setFiles([...results]);

      if (i < pdfFiles.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    setProcessing(false);
    queryClient.invalidateQueries({ queryKey: ["batches"] });
    queryClient.invalidateQueries({ queryKey: ["receipts"] });

    toast({
      title: "Import Complete",
      description: `${perfectCount} batches created, ${partialCount} partial, ${unrelatedCount} unrelated, ${errorCount} errors`,
    });
  }, [session, queryClient]);

  const totalFiles = files.length;
  const perfectFiles = files.filter(f => f.status === "perfect").length;
  const partialFiles = files.filter(f => f.status === "partial").length;
  const unrelatedFiles = files.filter(f => f.status === "unrelated").length;
  const errorFiles = files.filter(f => f.status === "error").length;
  const skippedFiles = files.filter(f => f.status === "skipped").length;

  const getIcon = (status: FileResult["status"]) => {
    switch (status) {
      case "pending": return <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
      case "processing": return <Loader2 className="h-3.5 w-3.5 text-accent animate-spin shrink-0" />;
      case "perfect": return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
      case "partial": return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
      case "unrelated": return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
      case "skipped": return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
      case "error": return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Import AppFolio Bank Deposits</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Upload Bank Deposit PDFs. Perfect matches create batches. Partial & unrelated deposits are flagged only.
        </p>
      </div>

      {/* Upload area */}
      <div
        className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-accent/50 transition-colors cursor-pointer"
        onClick={() => !processing && inputRef.current?.click()}
      >
        <input
          ref={inputRef} type="file" accept=".pdf" multiple
          // @ts-ignore
          webkitdirectory=""
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <FolderOpen className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm font-medium text-foreground">
          {processing ? "Processing..." : "Select folder with Bank Deposit PDFs"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">All PDFs in the folder will be processed</p>
        {!processing && (
          <div className="flex gap-2 justify-center mt-4">
            <Button variant="outline" size="sm" onClick={(e) => {
              e.stopPropagation();
              const input = document.createElement("input");
              input.type = "file"; input.accept = ".pdf"; input.multiple = true;
              input.onchange = () => handleFiles(input.files);
              input.click();
            }}>
              <Upload className="h-3.5 w-3.5 mr-1.5" />Select Files
            </Button>
            <Button variant="default" size="sm" onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}>
              <FolderOpen className="h-3.5 w-3.5 mr-1.5" />Select Folder
            </Button>
          </div>
        )}
      </div>

      {/* Progress */}
      {totalFiles > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {processing
                ? `Processing ${completed}/${totalFiles}...`
                : `Done — ${perfectFiles} batched, ${partialFiles} partial, ${unrelatedFiles} unrelated, ${skippedFiles} skipped, ${errorFiles} errors`}
            </span>
            <span className="vault-mono text-xs text-muted-foreground">
              {Math.round((completed / totalFiles) * 100)}%
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-1.5">
            <motion.div
              className="bg-accent h-1.5 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${(completed / totalFiles) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>

          {/* File list */}
          <div className="border border-border rounded-lg divide-y divide-border max-h-[50vh] overflow-y-auto">
            <AnimatePresence>
              {files.map((f) => (
                <motion.div
                  key={f.fileName}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-3 px-3 py-2 text-xs"
                >
                  {getIcon(f.status)}
                  <span className="font-medium text-foreground truncate min-w-0">{f.fileName}</span>
                  {f.depositNumber && (
                    <span className="vault-mono text-accent shrink-0">{f.depositNumber}</span>
                  )}
                  <span className="text-muted-foreground truncate ml-auto">{f.message || ""}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
