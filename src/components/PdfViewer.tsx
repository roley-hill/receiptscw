import { useEffect, useRef, useState } from "react";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as pdfjsLib from "pdfjs-dist";

// Use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs`;

interface PdfViewerProps {
  url: string;
  className?: string;
}

export default function PdfViewer({ url, className }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    pdfjsLib
      .getDocument(url)
      .promise.then((doc) => {
        if (cancelled) return;
        setPdf(doc);
        setTotalPages(doc.numPages);
        setPage(1);
        setLoading(false);
      })
      .catch((err) => {
        console.error("PDF load error:", err);
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;

    pdf.getPage(page).then((p) => {
      if (cancelled) return;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      const scale = 1.5;
      const viewport = p.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      p.render({ canvasContext: ctx, viewport });
    });

    return () => { cancelled = true; };
  }, [pdf, page]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center min-h-[400px] ${className}`}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center min-h-[400px] text-sm text-muted-foreground ${className}`}>
        Could not load PDF preview.
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="overflow-auto max-h-[600px] rounded-lg border border-border bg-muted/30">
        <canvas ref={canvasRef} className="mx-auto" style={{ maxWidth: "100%" }} />
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
