import { useState, useEffect, useRef, useCallback } from "react";
import ExcelJS from "exceljs";
import { FileText, ZoomIn, ZoomOut, RotateCcw, Loader2, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import PdfViewer from "@/components/PdfViewer";
import { getFilePreviewUrl } from "@/lib/api";

/* ─── Zoom wrapper ─── */
export function ZoomablePreview({ children }: { children: React.ReactNode }) {
  const [zoom, setZoom] = useState(1);
  return (
    <div>
      <div className="flex items-center gap-1 mb-2">
        <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))} disabled={zoom <= 0.5} className="h-7 w-7 p-0"><ZoomOut className="h-3.5 w-3.5" /></Button>
        <span className="text-xs text-muted-foreground w-12 text-center vault-mono">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.min(z + 0.25, 3))} disabled={zoom >= 3} className="h-7 w-7 p-0"><ZoomIn className="h-3.5 w-3.5" /></Button>
        {zoom !== 1 && <Button variant="ghost" size="sm" onClick={() => setZoom(1)} className="h-7 w-7 p-0"><RotateCcw className="h-3.5 w-3.5" /></Button>}
      </div>
      <div className="overflow-auto max-h-[60vh] rounded-lg border border-border bg-muted/50">
        <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: `${100 / zoom}%` }}>{children}</div>
      </div>
    </div>
  );
}

export function SpreadsheetPreview({ csv, rows: structuredRows }: { csv?: string; rows?: string[][] }) {
  let headerRow: string[];
  let dataRows: string[][];

  if (structuredRows && structuredRows.length > 0) {
    // Use pre-parsed structured rows (no delimiter issues)
    headerRow = structuredRows[0];
    dataRows = structuredRows.slice(1);
  } else if (csv) {
    // Legacy CSV path — use tab delimiter first, fall back to comma
    const lines = csv.split("\n").filter((l) => l.trim());
    const parsed: string[][] = [];
    for (const line of lines) {
      if (line.startsWith("=== Sheet:")) continue;
      // Use tab as primary delimiter (safe for amounts with commas)
      parsed.push(line.includes("\t") ? line.split("\t").map((c) => c.trim()) : line.split(",").map((c) => c.trim()));
    }
    if (parsed.length === 0) return <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">{csv}</pre>;
    headerRow = parsed[0];
    dataRows = parsed.slice(1);
  } else {
    return null;
  }

  return (
    <div className="overflow-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted sticky top-0"><tr>{headerRow.map((h, i) => <th key={i} className="px-3 py-2 text-left font-semibold text-foreground border-b border-border whitespace-nowrap">{h || `Col ${i + 1}`}</th>)}</tr></thead>
        <tbody>{dataRows.map((row, ri) => <tr key={ri} className={ri % 2 === 0 ? "bg-background" : "bg-muted/30"}>{headerRow.map((_, ci) => <td key={ci} className="px-3 py-1.5 text-muted-foreground border-b border-border/50 whitespace-nowrap">{row[ci] || ""}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function EmailPreview({ raw }: { raw: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);
  useEffect(() => {
    const iframe = iframeRef.current; if (!iframe) return;
    const htmlContent = raw.includes("<html") || raw.includes("<body") || raw.includes("<table") ? raw : `<pre style="font-family:monospace;white-space:pre-wrap;padding:16px;margin:0;">${raw.replace(/</g, "&lt;")}</pre>`;
    const doc = iframe.contentDocument; if (!doc) return;
    doc.open(); doc.write(`<!DOCTYPE html><html><head><style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;font-size:13px;color:#333;background:#fff;} table{border-collapse:collapse;width:100%} td,th{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:12px} img{max-width:100%;height:auto}</style></head><body>${htmlContent}</body></html>`); doc.close();
    const resize = () => { try { setHeight(Math.max(300, doc.body.scrollHeight + 32)); } catch {} };
    setTimeout(resize, 200); setTimeout(resize, 600);
  }, [raw]);
  return <iframe ref={iframeRef} className="w-full rounded-lg border-0" style={{ height, minHeight: 300 }} title="Email Preview" />;
}

export function EmlPdfAttachment({ pdfPath }: { pdfPath: string }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { getFilePreviewUrl(pdfPath).then((u) => { setPdfUrl(u); setLoading(false); }).catch(() => setLoading(false)); }, [pdfPath]);
  if (loading) return <div className="flex items-center justify-center min-h-[300px]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!pdfUrl) return <p className="text-sm text-muted-foreground text-center py-8">Could not load PDF attachment</p>;
  return <PdfViewer url={pdfUrl} />;
}

export function EmlImageAttachment({ imgPath }: { imgPath: string }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { getFilePreviewUrl(imgPath).then((u) => { setImgUrl(u); setLoading(false); }).catch(() => setLoading(false)); }, [imgPath]);
  if (loading) return <div className="flex items-center justify-center min-h-[300px]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!imgUrl) return <p className="text-sm text-muted-foreground text-center py-8">Could not load image attachment</p>;
  return <ZoomablePreview><div className="p-4 flex items-center justify-center min-h-[300px]"><img src={imgUrl} alt="Email attachment" className="max-w-full object-contain" /></div></ZoomablePreview>;
}

/* ─── XLSX fetcher: downloads and parses XLSX from URL ─── */
function XlsxFetchPreview({ url }: { url: string }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then(async (buf) => {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        const parts: string[] = [];
        wb.eachSheet((sheet) => {
          parts.push(`=== Sheet: ${sheet.name} ===`);
          const rows: string[] = [];
          sheet.eachRow((row) => {
            const cells = (row.values as any[]).slice(1).map((v) =>
              v === null || v === undefined ? "" : String(typeof v === "object" && v.result !== undefined ? v.result : v)
            );
            rows.push(cells.join(","));
          });
          parts.push(rows.join("\n"));
        });
        setCsv(parts.join("\n"));
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [url]);

  if (loading) return <div className="flex items-center justify-center min-h-[300px]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (error || !csv) return <p className="text-sm text-muted-foreground text-center py-8">Could not parse spreadsheet.</p>;
  return <ZoomablePreview><div className="p-4"><SpreadsheetPreview csv={csv} /></div></ZoomablePreview>;
}

export function AttachmentContent({ url, fileName, originalText }: { url: string; fileName: string; originalText: string | null }) {
  const fileExt = fileName?.split(".").pop()?.toLowerCase();
  const isImage = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif"].includes(fileExt || "");
  const isPdf = fileExt === "pdf";
  const isXlsx = ["xlsx", "xls"].includes(fileExt || "");
  const isEml = fileExt === "eml";
  if (isPdf) return <PdfViewer url={url} />;
  if (isImage) return <ZoomablePreview><div className="p-4 flex items-center justify-center min-h-[300px]"><img src={url} alt={fileName} className="max-w-full object-contain" /></div></ZoomablePreview>;
  if (isXlsx && originalText) return <ZoomablePreview><div className="p-4"><SpreadsheetPreview csv={originalText} /></div></ZoomablePreview>;
  if (isXlsx) return <XlsxFetchPreview url={url} />;
  if (isEml && originalText?.startsWith("PDF_ATTACHMENT:")) { const pdfPath = originalText.replace("PDF_ATTACHMENT:", ""); return <EmlPdfAttachment pdfPath={pdfPath} />; }
  if (isEml && originalText?.startsWith("IMAGE_ATTACHMENT:")) { const imgPath = originalText.replace("IMAGE_ATTACHMENT:", ""); return <EmlImageAttachment imgPath={imgPath} />; }
  if (isEml && originalText) return <ZoomablePreview><EmailPreview raw={originalText} /></ZoomablePreview>;
  if (originalText) return <ZoomablePreview><pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono p-4 max-h-[60vh] overflow-auto">{originalText}</pre></ZoomablePreview>;
  return <div className="flex flex-col items-center justify-center min-h-[300px] text-muted-foreground text-sm gap-2"><FileText className="h-10 w-10" /><p>Preview not available.</p></div>;
}

interface FilePreviewOverlayProps {
  fileName: string;
  fileUrl: string | null;
  loading: boolean;
  originalText?: string | null;
  onClose: () => void;
}

export function FilePreviewOverlay({ fileName, fileUrl, loading, originalText, onClose }: FilePreviewOverlayProps) {
  // Derive the actual download name from the file URL path (which reflects the real file type)
  // rather than the original upload name (which may be .eml while the stored file is .pdf)
  const getDownloadFileName = () => {
    if (fileUrl) {
      try {
        const urlPath = new URL(fileUrl).pathname;
        const urlFileName = urlPath.split("/").pop()?.split("?")[0];
        if (urlFileName) return decodeURIComponent(urlFileName);
      } catch { /* fall through */ }
    }
    return fileName || "attachment";
  };

  const handleDownload = async () => {
    if (!fileUrl) return;
    try {
      const response = await fetch(fileUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = getDownloadFileName();
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(fileUrl, "_blank");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-background border border-border rounded-xl shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium text-foreground truncate">{fileName || "Attachment"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleDownload} disabled={!fileUrl}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Download
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center min-h-[300px]">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : fileUrl ? (
            <AttachmentContent url={fileUrl} fileName={fileName || ""} originalText={originalText ?? null} />
          ) : (
            <div className="flex items-center justify-center min-h-[300px] text-muted-foreground text-sm">
              Could not load preview.
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
