import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { Upload as UploadIcon, FolderOpen, FileText, Image, AlertCircle, CheckCircle2, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadReceiptFile } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface UploadedFile {
  name: string;
  size: number;
  type: string;
  file: File;
  status: "pending" | "processing" | "done" | "error";
  error?: string;
  receiptId?: string;
}

export default function UploadPage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { session } = useAuth();
  const queryClient = useQueryClient();

  const handleFiles = (fileList: FileList) => {
    const accepted = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/jpg"];
    const newFiles: UploadedFile[] = Array.from(fileList)
      .filter((f) => accepted.some((t) => f.type.startsWith(t.split("/")[0]) || f.type === t))
      .map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type,
        file: f,
        status: "pending" as const,
      }));
    if (newFiles.length === 0) {
      toast.error("No supported files found. Upload PDF, JPG, or PNG files.");
      return;
    }
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const startExtraction = async () => {
    if (!session?.access_token) {
      toast.error("Not authenticated");
      return;
    }
    setIsProcessing(true);
    const pending = files.filter((f) => f.status === "pending");

    for (let i = 0; i < pending.length; i++) {
      const f = pending[i];
      setFiles((prev) =>
        prev.map((pf) => (pf.name === f.name && pf.status === "pending" ? { ...pf, status: "processing" } : pf))
      );

      try {
        const result = await uploadReceiptFile(f.file, session.access_token);
        setFiles((prev) =>
          prev.map((pf) =>
            pf.name === f.name && pf.status === "processing"
              ? { ...pf, status: "done", receiptId: result.receipt?.receipt_id }
              : pf
          )
        );
      } catch (err: any) {
        setFiles((prev) =>
          prev.map((pf) =>
            pf.name === f.name && pf.status === "processing"
              ? { ...pf, status: "error", error: err.message }
              : pf
          )
        );
      }
    }

    setIsProcessing(false);
    queryClient.invalidateQueries({ queryKey: ["receipts"] });
    toast.success("Extraction complete!");
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) return <Image className="h-4 w-4 text-vault-blue" />;
    return <FileText className="h-4 w-4 text-vault-emerald" />;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "done").length;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Upload Receipts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload rent receipt files. AI will extract data automatically. Supported: PDF, JPG, PNG.
        </p>
      </div>

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
          <p className="text-sm font-medium text-foreground">Drop receipt files here</p>
          <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG — files will be processed with AI extraction</p>
        </div>
        <Button variant="outline" size="sm" className="mt-2">
          <FolderOpen className="h-4 w-4 mr-2" /> Browse Files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.heic"
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </motion.div>

      {files.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              {files.length} file{files.length !== 1 ? "s" : ""} · {doneCount} extracted · {pendingCount} pending
            </h2>
            {pendingCount > 0 && (
              <Button variant="default" size="sm" onClick={startExtraction} disabled={isProcessing}>
                {isProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {isProcessing ? "Extracting..." : "Start Extraction"}
              </Button>
            )}
          </div>
          <div className="vault-card divide-y divide-border">
            {files.map((file, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                {getFileIcon(file.type)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(file.size)}
                    {file.receiptId && <span className="ml-2 vault-mono text-vault-emerald">→ {file.receiptId}</span>}
                    {file.error && <span className="ml-2 text-vault-red">{file.error}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {file.status === "done" && <CheckCircle2 className="h-4 w-4 text-vault-emerald" />}
                  {file.status === "processing" && <Loader2 className="h-4 w-4 text-vault-blue animate-spin" />}
                  {file.status === "error" && <AlertCircle className="h-4 w-4 text-vault-red" />}
                  {file.status === "pending" && (
                    <button onClick={(e) => { e.stopPropagation(); removeFile(i); }} className="p-1 rounded hover:bg-muted">
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
