import { useUploadStore } from "@/hooks/useUploadStore";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Loader2, AlertCircle, X, Upload, Ban } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export default function UploadProgressFloat() {
  const { files, clearCompleted, isProcessing, cancelExtraction } = useUploadStore();
  const location = useLocation();

  // Don't show on upload page itself
  if (location.pathname === "/upload") return null;
  if (files.length === 0) return null;

  const doneCount = files.filter((f) => f.status === "done").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const processingCount = files.filter((f) => f.status === "processing").length;
  const totalCount = files.length;
  const progress = totalCount > 0 ? ((doneCount + errorCount) / totalCount) * 100 : 0;
  const allDone = processingCount === 0 && files.every((f) => f.status === "done" || f.status === "error");

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-border bg-card shadow-lg overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            {processingCount > 0 ? (
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
            ) : (
              <Upload className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm font-medium text-foreground">
              {processingCount > 0 ? "Extracting..." : "Upload Complete"}
            </span>
          </div>
          {isProcessing && (
            <button onClick={cancelExtraction} className="p-1 rounded hover:bg-destructive/10" title="Cancel extraction">
              <Ban className="h-3.5 w-3.5 text-destructive" />
            </button>
          )}
          {allDone && (
            <button onClick={clearCompleted} className="p-1 rounded hover:bg-muted" title="Dismiss">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
        <div className="px-4 pb-2">
          <Progress value={progress} className="h-1.5" />
        </div>
        <div className="px-4 pb-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" /> {doneCount}
          </span>
          {errorCount > 0 && (
            <span className="flex items-center gap-1">
              <AlertCircle className="h-3 w-3 text-destructive" /> {errorCount}
            </span>
          )}
          <span>{totalCount} total</span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
