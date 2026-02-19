import { useState, useEffect } from "react";
import { X, ChevronLeft, ChevronRight, FileText, Loader2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { AttachmentContent } from "@/components/FilePreview";
import { getFilePreviewUrl } from "@/lib/api";

interface BatchDocumentPreviewProps {
  receipts: any[];
  batchId: string;
  onClose: () => void;
}

export default function BatchDocumentPreview({ receipts, batchId, onClose }: BatchDocumentPreviewProps) {
  // Only receipts with file_path
  const docsReceipts = receipts.filter((r) => r.file_path);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const current = docsReceipts[currentIndex];

  useEffect(() => {
    if (!current?.file_path) {
      setFileUrl(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFileUrl(null);
    getFilePreviewUrl(current.file_path)
      .then((url) => setFileUrl(url))
      .catch(() => setFileUrl(null))
      .finally(() => setLoading(false));
  }, [current?.file_path]);

  if (docsReceipts.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-background border border-border rounded-xl shadow-2xl p-8 text-center text-muted-foreground text-sm" onClick={(e) => e.stopPropagation()}>
          No source documents found in this batch.
          <div className="mt-4"><Button variant="outline" size="sm" onClick={onClose}>Close</Button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-background border border-border rounded-xl shadow-2xl w-[92vw] max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Eye className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium text-foreground truncate">
              Batch Documents
            </span>
            <span className="text-xs text-muted-foreground vault-mono">
              {currentIndex + 1} / {docsReceipts.length}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Navigation sidebar + preview */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar: scrollable document list */}
          <div className="w-56 shrink-0 border-r border-border bg-muted/20 overflow-y-auto">
            {docsReceipts.map((r, i) => (
              <button
                key={r.id}
                onClick={() => setCurrentIndex(i)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors text-xs ${
                  i === currentIndex
                    ? "bg-accent/20 border-l-2 border-l-accent"
                    : "hover:bg-muted/50"
                }`}
              >
                <div className="font-medium text-foreground truncate">{r.tenant}</div>
                <div className="text-muted-foreground vault-mono mt-0.5 flex items-center justify-between">
                  <span>{r.unit}</span>
                  <span>${Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="text-muted-foreground truncate mt-0.5">
                  <FileText className="h-3 w-3 inline mr-1" />
                  {r.file_name || "document"}
                </div>
              </button>
            ))}
          </div>

          {/* Main preview area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Current doc info bar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/10 shrink-0">
              <div className="text-xs text-muted-foreground truncate">
                <span className="font-medium text-foreground">{current?.tenant}</span>
                {" · "}
                <span className="vault-mono">{current?.unit}</span>
                {" · "}
                <span className="vault-mono">{current?.receipt_id}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((i) => i - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={currentIndex === docsReceipts.length - 1}
                  onClick={() => setCurrentIndex((i) => i + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Document preview */}
            <div className="flex-1 overflow-auto p-4">
              <AnimatePresence mode="wait">
                <motion.div
                  key={current?.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {loading ? (
                    <div className="flex items-center justify-center min-h-[400px]">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : fileUrl ? (
                    <AttachmentContent
                      url={fileUrl}
                      fileName={current?.file_name || ""}
                      originalText={current?.original_text ?? null}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center min-h-[400px] text-muted-foreground text-sm gap-2">
                      <FileText className="h-10 w-10" />
                      <p>Could not load preview.</p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
