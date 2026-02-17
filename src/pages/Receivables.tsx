import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchReceipts, markAppfolioRecorded, getFilePreviewUrl, createDepositBatch } from "@/lib/api";
import { motion } from "framer-motion";
import { Download, Filter, FileText, Layers, X, ZoomIn, ZoomOut, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DbReceipt } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PdfViewer from "@/components/PdfViewer";

/* ─── Zoom wrapper ─── */
function ZoomablePreview({ children }: { children: React.ReactNode }) {
  const [zoom, setZoom] = useState(1);
  return (
    <div>
      <div className="flex items-center gap-1 mb-2">
        <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))} disabled={zoom <= 0.5} className="h-7 w-7 p-0">
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground w-12 text-center vault-mono">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.min(z + 0.25, 3))} disabled={zoom >= 3} className="h-7 w-7 p-0">
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        {zoom !== 1 && (
          <Button variant="ghost" size="sm" onClick={() => setZoom(1)} className="h-7 w-7 p-0">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="overflow-auto max-h-[60vh] rounded-lg border border-border bg-muted/50">
        <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: `${100 / zoom}%` }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ─── Spreadsheet table ─── */
function SpreadsheetPreview({ csv }: { csv: string }) {
  const lines = csv.split("\n").filter((l) => l.trim());
  const rows: string[][] = [];
  for (const line of lines) {
    if (line.startsWith("=== Sheet:")) continue;
    rows.push(line.split(",").map((c) => c.trim()));
  }
  if (rows.length === 0) return <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">{csv}</pre>;
  const headerRow = rows[0];
  const dataRows = rows.slice(1);
  return (
    <div className="overflow-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted sticky top-0">
          <tr>{headerRow.map((h, i) => <th key={i} className="px-3 py-2 text-left font-semibold text-foreground border-b border-border whitespace-nowrap">{h || `Col ${i + 1}`}</th>)}</tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "bg-background" : "bg-muted/30"}>
              {headerRow.map((_, ci) => <td key={ci} className="px-3 py-1.5 text-muted-foreground border-b border-border/50 whitespace-nowrap">{row[ci] || ""}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Email HTML preview ─── */
function EmailPreview({ raw }: { raw: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const htmlContent = raw.includes("<html") || raw.includes("<body") || raw.includes("<table")
      ? raw
      : `<pre style="font-family:monospace;white-space:pre-wrap;padding:16px;margin:0;">${raw.replace(/</g, "&lt;")}</pre>`;
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;font-size:13px;color:#333;background:#fff;} table{border-collapse:collapse;width:100%} td,th{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:12px} img{max-width:100%;height:auto}</style></head><body>${htmlContent}</body></html>`);
    doc.close();
    const resize = () => {
      try { setHeight(Math.max(300, doc.body.scrollHeight + 32)); } catch {}
    };
    setTimeout(resize, 200);
    setTimeout(resize, 600);
  }, [raw]);

  return <iframe ref={iframeRef} className="w-full rounded-lg border-0" style={{ height, minHeight: 300 }} title="Email Preview" />;
}

/* ─── Floating attachment content renderer ─── */
function AttachmentContent({ url, fileName, originalText }: { url: string; fileName: string; originalText: string | null }) {
  const fileExt = fileName?.split(".").pop()?.toLowerCase();
  const isImage = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif"].includes(fileExt || "");
  const isPdf = fileExt === "pdf";
  const isXlsx = ["xlsx", "xls"].includes(fileExt || "");
  const isEml = fileExt === "eml";

  if (isPdf) return <PdfViewer url={url} />;

  if (isImage) {
    return (
      <ZoomablePreview>
        <div className="p-4 flex items-center justify-center min-h-[300px]">
          <img src={url} alt={fileName} className="max-w-full object-contain" />
        </div>
      </ZoomablePreview>
    );
  }

  if (isXlsx && originalText) {
    return (
      <ZoomablePreview>
        <div className="p-4">
          <SpreadsheetPreview csv={originalText} />
        </div>
      </ZoomablePreview>
    );
  }

  if (isEml && originalText?.startsWith("PDF_ATTACHMENT:")) {
    const pdfPath = originalText.replace("PDF_ATTACHMENT:", "");
    return <EmlPdfAttachment pdfPath={pdfPath} />;
  }

  if (isEml && originalText) {
    return (
      <ZoomablePreview>
        <EmailPreview raw={originalText} />
      </ZoomablePreview>
    );
  }

  // Fallback: show extracted text if available
  if (originalText) {
    return (
      <ZoomablePreview>
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono p-4 max-h-[60vh] overflow-auto">{originalText}</pre>
      </ZoomablePreview>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] text-muted-foreground text-sm gap-2">
      <FileText className="h-10 w-10" />
      <p>Preview not available for this file type.</p>
    </div>
  );
}

function EmlPdfAttachment({ pdfPath }: { pdfPath: string }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    getFilePreviewUrl(pdfPath)
      .then((u) => { setPdfUrl(u); setLoading(false); })
      .catch(() => setLoading(false));
  }, [pdfPath]);
  if (loading) return <div className="flex items-center justify-center min-h-[300px]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!pdfUrl) return <p className="text-sm text-muted-foreground text-center py-8">Could not load PDF attachment</p>;
  return <PdfViewer url={pdfUrl} />;
}

/* ─── Main page ─── */
export default function Receivables() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: allReceipts = [], isLoading } = useQuery({
    queryKey: ["receipts"],
    queryFn: fetchReceipts,
  });

  const [selectedProperty, setSelectedProperty] = useState<string>("all");
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchProperty, setBatchProperty] = useState("");
  const [depositPeriod, setDepositPeriod] = useState("");

  // Attachment preview state
  const [previewReceipt, setPreviewReceipt] = useState<DbReceipt | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const finalized = allReceipts.filter((r) => r.status === "finalized");
  const properties = [...new Set(finalized.map((r) => r.property).filter(Boolean))];
  const filtered = selectedProperty === "all" ? finalized : finalized.filter((r) => r.property === selectedProperty);

  const grouped = filtered.reduce((acc, r) => {
    if (!acc[r.property]) acc[r.property] = [];
    acc[r.property].push(r);
    return acc;
  }, {} as Record<string, DbReceipt[]>);

  const grandTotal = filtered.reduce((sum, r) => sum + Number(r.amount), 0);
  const recordedReceipts = filtered.filter((r) => (r as any).appfolio_recorded);
  const recordedTotal = recordedReceipts.reduce((sum, r) => sum + Number(r.amount), 0);

  const toggleMutation = useMutation({
    mutationFn: ({ id, recorded }: { id: string; recorded: boolean }) =>
      markAppfolioRecorded(id, recorded, user!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["receipts"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const batchMutation = useMutation({
    mutationFn: ({ property, ids, period }: { property: string; ids: string[]; period: string }) =>
      createDepositBatch(property, ids, period, user!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      setBatchDialogOpen(false);
      toast({ title: "Deposit batch created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleViewAttachment = async (receipt: DbReceipt) => {
    if (!receipt.file_path) return;
    setPreviewReceipt(receipt);
    setPreviewLoading(true);
    setPreviewUrl(null);
    try {
      const url = await getFilePreviewUrl(receipt.file_path);
      setPreviewUrl(url);
    } catch {
      toast({ title: "Error", description: "Could not load attachment", variant: "destructive" });
      setPreviewReceipt(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewReceipt(null);
    setPreviewUrl(null);
  };

  const handleDownloadAttachment = () => {
    if (!previewUrl) return;
    const a = document.createElement("a");
    a.href = previewUrl;
    a.download = previewReceipt?.file_name || "attachment";
    a.target = "_blank";
    a.click();
  };

  const openBatchDialog = (property: string) => {
    const propertyRecorded = finalized.filter((r) => r.property === property && (r as any).appfolio_recorded && !r.batch_id);
    if (propertyRecorded.length === 0) {
      toast({ title: "No eligible receipts", description: "Mark receipts as recorded in AppFolio first.", variant: "destructive" });
      return;
    }
    setBatchProperty(property);
    setDepositPeriod("");
    setBatchDialogOpen(true);
  };

  const handleCreateBatch = () => {
    const ids = finalized
      .filter((r) => r.property === batchProperty && (r as any).appfolio_recorded && !r.batch_id)
      .map((r) => r.id);
    if (ids.length === 0) return;
    batchMutation.mutate({ property: batchProperty, ids, period: depositPeriod });
  };

  const downloadCSV = (onlyRecorded: boolean) => {
    const rows = onlyRecorded ? recordedReceipts : filtered;
    if (rows.length === 0) return;
    const headers = ["Property", "Unit", "Tenant", "Receipt Date", "Amount", "Reference", "Receipt ID", "Payment Type", "Transfer Status"];
    const csv = [
      headers.join(","),
      ...rows.map((r) =>
        [r.property, r.unit, r.tenant, r.receipt_date || "", Number(r.amount).toFixed(2), r.reference || "", r.receipt_id, r.payment_type || "", r.transfer_status].join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receivables-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 max-w-7xl relative">
      {/* Floating Attachment Preview */}
      {(previewReceipt) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={closePreview}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-background border border-border rounded-xl shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium text-foreground truncate">{previewReceipt.file_name || "Attachment"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleDownloadAttachment} disabled={!previewUrl}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                </Button>
                <Button variant="ghost" size="sm" onClick={closePreview} className="h-8 w-8 p-0">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {/* Content */}
            <div className="flex-1 overflow-auto p-4">
              {previewLoading ? (
                <div className="flex items-center justify-center min-h-[300px]">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : previewUrl ? (
                <AttachmentContent
                  url={previewUrl}
                  fileName={previewReceipt.file_name || ""}
                  originalText={previewReceipt.original_text}
                />
              ) : (
                <div className="flex items-center justify-center min-h-[300px] text-muted-foreground text-sm">
                  Could not load preview.
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Property Receivables & Deposits</h1>
          <p className="text-sm text-muted-foreground mt-1">Finalized receipts grouped by property. Mark as recorded in AppFolio before batching.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadCSV(true)} disabled={recordedReceipts.length === 0}>
            <Download className="h-4 w-4 mr-2" /> CSV (Recorded)
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadCSV(false)}>
            <Download className="h-4 w-4 mr-2" /> CSV (All)
          </Button>
        </div>
      </div>

      <div className="vault-card p-4 flex items-center gap-4">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select value={selectedProperty} onChange={(e) => setSelectedProperty(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
          <option value="all">All Properties</option>
          {properties.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="vault-card p-8 text-center text-muted-foreground text-sm">No finalized receipts. Review and finalize receipts first.</div>
      ) : (
        Object.entries(grouped).map(([property, receipts]) => {
          const subtotal = receipts.reduce((s, r) => s + Number(r.amount), 0);
          const recorded = receipts.filter((r) => (r as any).appfolio_recorded);
          const recordedAmt = recorded.reduce((s, r) => s + Number(r.amount), 0);
          const unbatched = recorded.filter((r) => !r.batch_id);
          return (
            <motion.div key={property} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="vault-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">{property}</h3>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-muted-foreground">{recorded.length}/{receipts.length} recorded</span>
                  <span className="vault-mono font-bold text-foreground">${subtotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                  <Button variant="default" size="sm" onClick={() => openBatchDialog(property)} disabled={unbatched.length === 0}>
                    <Layers className="h-3.5 w-3.5 mr-1" /> Create Batch ({unbatched.length})
                  </Button>
                </div>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-10">Recorded</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unit</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tenant</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt Date</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reference</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt ID</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transfer</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Attachment</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.sort((a, b) => (a.unit || "").localeCompare(b.unit || "")).map((r) => (
                    <tr key={r.id} className="vault-table-row">
                      <td className="px-4 py-2.5">
                        <Checkbox
                          checked={(r as any).appfolio_recorded || false}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: r.id, recorded: !!checked })}
                          disabled={toggleMutation.isPending}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-sm vault-mono text-foreground">{r.unit}</td>
                      <td className="px-4 py-2.5 text-sm font-medium text-foreground">{r.tenant}</td>
                      <td className="px-4 py-2.5 text-sm vault-mono text-muted-foreground">{r.receipt_date || "—"}</td>
                      <td className="px-4 py-2.5 text-sm text-right vault-mono font-semibold text-foreground">${Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-2.5 text-sm vault-mono text-muted-foreground">{r.reference || "—"}</td>
                      <td className="px-4 py-2.5 text-xs vault-mono text-vault-blue">{r.receipt_id}</td>
                      <td className="px-4 py-2.5">{r.transfer_status === "transferred" ? <span className="vault-badge-success">Transferred</span> : <span className="vault-badge-neutral">Pending</span>}</td>
                      <td className="px-4 py-2.5 text-center">
                        {r.file_path ? (
                          <Button variant="ghost" size="sm" onClick={() => handleViewAttachment(r)} title="Preview source document">
                            <FileText className="h-4 w-4 text-vault-blue" />
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-3 border-t border-border bg-muted/20 flex items-center justify-between text-xs">
                <div className="flex gap-6">
                  <span className="text-muted-foreground">Recorded: <span className="vault-mono font-medium text-foreground">${recordedAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></span>
                  <span className="text-muted-foreground">Unrecorded: <span className="vault-mono font-medium text-foreground">${(subtotal - recordedAmt).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></span>
                </div>
              </div>
            </motion.div>
          );
        })
      )}

      {grandTotal > 0 && (
        <div className="vault-card px-4 py-4 flex items-center justify-between">
          <span className="text-sm font-bold text-foreground">Grand Total</span>
          <div className="flex items-center gap-6">
            <span className="text-sm text-muted-foreground">{recordedReceipts.length}/{filtered.length} recorded</span>
            <span className="text-sm text-muted-foreground">Recorded: <span className="vault-mono font-bold text-foreground">${recordedTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></span>
            <span className="text-lg vault-mono font-bold text-foreground">${grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      )}

      <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Deposit Batch — {batchProperty}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This will batch {finalized.filter((r) => r.property === batchProperty && (r as any).appfolio_recorded && !r.batch_id).length} recorded, unbatched receipts for <strong>{batchProperty}</strong>.
            </p>
            <div>
              <Label htmlFor="depositPeriod">Deposit Period</Label>
              <Input id="depositPeriod" placeholder="e.g. Feb 2026" value={depositPeriod} onChange={(e) => setDepositPeriod(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateBatch} disabled={batchMutation.isPending}>
              <Layers className="h-4 w-4 mr-2" /> Create Batch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
