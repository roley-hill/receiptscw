import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface PdfViewerProps {
  url: string;
  className?: string;
}

export default function PdfViewer({ url, className }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(1);

  // Drag-to-pan state
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

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
        if (!cancelled) { setError(true); setLoading(false); }
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
      const scale = 1.5 * zoom;
      const viewport = p.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      p.render({ canvasContext: ctx, viewport });
    });

    return () => { cancelled = true; };
  }, [pdf, page, zoom]);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 4));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const handleZoomReset = () => setZoom(1);

  const zoomToPoint = useCallback((newZoom: number, clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const clickX = (clientX - rect.left + container.scrollLeft) / (container.scrollWidth || 1);
    const clickY = (clientY - rect.top + container.scrollTop) / (container.scrollHeight || 1);
    setZoom(newZoom);
    requestAnimationFrame(() => {
      container.scrollLeft = clickX * container.scrollWidth - rect.width / 2;
      container.scrollTop = clickY * container.scrollHeight - rect.height / 2;
    });
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (zoom >= 2) {
      setZoom(1);
      return;
    }
    zoomToPoint(Math.min(zoom + 0.5, 4), e.clientX, e.clientY);
  }, [zoom, zoomToPoint]);

  // Ctrl+scroll wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.25 : 0.25;
      setZoom((prev) => {
        const next = Math.min(Math.max(prev + delta, 0.5), 4);
        if (next === prev) return prev;
        // Scroll to keep pointer position stable
        const rect = container.getBoundingClientRect();
        const fracX = (e.clientX - rect.left + container.scrollLeft) / (container.scrollWidth || 1);
        const fracY = (e.clientY - rect.top + container.scrollTop) / (container.scrollHeight || 1);
        requestAnimationFrame(() => {
          container.scrollLeft = fracX * container.scrollWidth - (e.clientX - rect.left);
          container.scrollTop = fracY * container.scrollHeight - (e.clientY - rect.top);
        });
        return next;
      });
    };
    container.addEventListener("wheel", handler, { passive: false });
    return () => container.removeEventListener("wheel", handler);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return;
    const container = containerRef.current;
    if (!container) return;
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    };
  }, [zoom]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const container = containerRef.current;
    if (!container) return;
    e.preventDefault();
    container.scrollLeft = dragStart.current.scrollLeft - (e.clientX - dragStart.current.x);
    container.scrollTop = dragStart.current.scrollTop - (e.clientY - dragStart.current.y);
  }, [isDragging]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

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
      <div className="flex items-center gap-1 mb-2">
        <Button variant="ghost" size="sm" onClick={handleZoomOut} disabled={zoom <= 0.5} className="h-7 w-7 p-0">
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground w-12 text-center font-mono">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="sm" onClick={handleZoomIn} disabled={zoom >= 4} className="h-7 w-7 p-0">
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        {zoom !== 1 && (
          <Button variant="ghost" size="sm" onClick={handleZoomReset} className="h-7 w-7 p-0">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div
        ref={containerRef}
        className="overflow-auto max-h-[600px] rounded-lg border border-border bg-muted/30"
        style={{ cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        <canvas ref={canvasRef} className="mx-auto" style={{ maxWidth: zoom > 1 ? "none" : "100%" }} />
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
