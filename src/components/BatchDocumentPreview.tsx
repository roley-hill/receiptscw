import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, FileText, Loader2, Eye, FileBarChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { AttachmentContent } from "@/components/FilePreview";
import PdfViewer from "@/components/PdfViewer";
import { getFilePreviewUrl } from "@/lib/api";
import { generateBatchPDF } from "@/lib/batchReports";

interface BatchDocumentPreviewProps {
  receipts: any[];
  batch: any;
  onClose: () => void;
}

type SidebarItem = {
  id: string;
  label: string;
  sublabel: string;
  detail: string;
  type: "report" | "document";
  filePath?: string;
  fileName?: string;
  originalText?: string | null;
};

export default function BatchDocumentPreview({ receipts, batch, onClose }: BatchDocumentPreviewProps) {
  // Build sidebar items: PDF report first, then source documents (deduplicated by file_path)
  const items: SidebarItem[] = useMemo(() => {
    const list: SidebarItem[] = [
      {
        id: "__report__",
        label: "Batch Report (PDF)",
        sublabel: batch.batch_id,
        detail: `${receipts.length} receipts`,
        type: "report",
      },
    ];
    const seenPaths = new Set<string>();
    for (const r of receipts) {
      if (!r.file_path || seenPaths.has(r.file_path)) continue;
      seenPaths.add(r.file_path);
      list.push({
        id: r.id,
        label: r.tenant,
        sublabel: `${r.unit}  ·  $${Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
        detail: r.file_name || "document",
        type: "document",
        filePath: r.file_path,
        fileName: r.file_name,
        originalText: r.original_text ?? null,
      });
    }
    return list;
  }, [receipts, batch]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reportBlobUrl, setReportBlobUrl] = useState<string | null>(null);

  // Cache signed URLs to avoid redundant network requests
  const urlCache = useRef<Map<string, string>>(new Map());

  const current = items[currentIndex];
  const currentFilePath = current?.type === "document" ? current.filePath : null;

  // Generate report PDF blob URL once
  useEffect(() => {
    try {
      const doc = generateBatchPDF(batch, receipts);
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      setReportBlobUrl(url);
      return () => URL.revokeObjectURL(url);
    } catch {
      setReportBlobUrl(null);
    }
  }, [batch, receipts]);

  // Load file URL for document items — depend on stable primitives, not objects
  useEffect(() => {
    if (!currentFilePath) {
      setFileUrl(null);
      setLoading(false);
      return;
    }

    // Check cache first
    const cached = urlCache.current.get(currentFilePath);
    if (cached) {
      setFileUrl(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFileUrl(null);

    getFilePreviewUrl(currentFilePath)
      .then((url) => {
        if (cancelled) return;
        urlCache.current.set(currentFilePath, url);
        setFileUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFileUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [currentFilePath]);

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
            <span className="text-sm font-medium text-foreground truncate">Deposit Package Preview</span>
            <span className="text-xs text-muted-foreground vault-mono">
              {currentIndex + 1} / {items.length}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Navigation sidebar + preview */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-56 shrink-0 border-r border-border bg-muted/20 overflow-y-auto">
            {items.map((item, i) => (
              <button
                key={item.id}
                onClick={() => setCurrentIndex(i)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors text-xs ${
                  i === currentIndex
                    ? "bg-accent/20 border-l-2 border-l-accent"
                    : "hover:bg-muted/50"
                }`}
              >
                <div className="font-medium text-foreground truncate flex items-center gap-1.5">
                  {item.type === "report" ? (
                    <FileBarChart className="h-3 w-3 text-accent shrink-0" />
                  ) : (
                    <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                  {item.label}
                </div>
                <div className="text-muted-foreground vault-mono mt-0.5">{item.sublabel}</div>
                <div className="text-muted-foreground truncate mt-0.5">{item.detail}</div>
              </button>
            ))}
          </div>

          {/* Main preview area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Info bar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/10 shrink-0">
              <div className="text-xs text-muted-foreground truncate">
                <span className="font-medium text-foreground">{current?.label}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={currentIndex === 0} onClick={() => setCurrentIndex((i) => i - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={currentIndex === items.length - 1} onClick={() => setCurrentIndex((i) => i + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Preview */}
            <div className="flex-1 overflow-auto p-4">
              <AnimatePresence mode="wait">
                <motion.div
                  key={current?.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {current?.type === "report" ? (
                    reportBlobUrl ? (
                      <PdfViewer url={reportBlobUrl} />
                    ) : (
                      <div className="flex flex-col items-center justify-center min-h-[400px] text-muted-foreground text-sm gap-2">
                        <FileBarChart className="h-10 w-10" />
                        <p>Could not generate report preview.</p>
                      </div>
                    )
                  ) : loading ? (
                    <div className="flex items-center justify-center min-h-[400px]">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : fileUrl ? (
                    <AttachmentContent
                      url={fileUrl}
                      fileName={current?.fileName || ""}
                      originalText={current?.originalText ?? null}
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
