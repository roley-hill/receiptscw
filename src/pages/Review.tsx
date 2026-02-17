import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchReceipts, updateReceipt, getFilePreviewUrl } from "@/lib/api";
import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight, Eye, Edit3, Save, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import PdfViewer from "@/components/PdfViewer";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function ReviewPage() {
  const { data: allReceipts = [], isLoading } = useQuery({
    queryKey: ["receipts"],
    queryFn: fetchReceipts,
  });
  const queryClient = useQueryClient();
  const reviewable = allReceipts.filter((r) => r.status === "needs_review" || r.status === "exception");
  const [currentIdx, setCurrentIdx] = useState(0);
  const receipt = reviewable[currentIdx];
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleEdit = (field: string, value: string) => {
    setEdits((prev) => ({ ...prev, [field]: value }));
  };

  const getVal = (field: string, fallback: string) => edits[field] ?? fallback;

  const handleFinalize = async () => {
    if (!receipt) return;
    setSaving(true);
    try {
      await updateReceipt(receipt.id, {
        property: getVal("property", receipt.property),
        unit: getVal("unit", receipt.unit),
        tenant: getVal("tenant", receipt.tenant),
        receipt_date: getVal("receipt_date", receipt.receipt_date || "") || null,
        rent_month: getVal("rent_month", receipt.rent_month || ""),
        amount: parseFloat(getVal("amount", String(receipt.amount))) || receipt.amount,
        payment_type: getVal("payment_type", receipt.payment_type || ""),
        reference: getVal("reference", receipt.reference || ""),
        memo: getVal("memo", receipt.memo || ""),
        status: "finalized" as const,
        finalized_at: new Date().toISOString(),
      });
      toast.success("Receipt finalized!");
      setEdits({});
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
    } catch (err: any) {
      toast.error(err.message);
    }
    setSaving(false);
  };

  const handleSaveDraft = async () => {
    if (!receipt) return;
    setSaving(true);
    try {
      await updateReceipt(receipt.id, {
        property: getVal("property", receipt.property),
        unit: getVal("unit", receipt.unit),
        tenant: getVal("tenant", receipt.tenant),
        receipt_date: getVal("receipt_date", receipt.receipt_date || "") || null,
        rent_month: getVal("rent_month", receipt.rent_month || ""),
        amount: parseFloat(getVal("amount", String(receipt.amount))) || receipt.amount,
        payment_type: getVal("payment_type", receipt.payment_type || ""),
        reference: getVal("reference", receipt.reference || ""),
        memo: getVal("memo", receipt.memo || ""),
      });
      toast.success("Draft saved");
      setEdits({});
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
    } catch (err: any) {
      toast.error(err.message);
    }
    setSaving(false);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!receipt) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <CheckCircle2 className="h-12 w-12 text-vault-emerald mb-4" />
        <h2 className="text-xl font-bold text-foreground">All caught up!</h2>
        <p className="text-sm text-muted-foreground mt-1">No receipts pending review.</p>
      </div>
    );
  }

  const conf = (receipt.confidence_scores as any) || {};

  return (
    <div className="space-y-4 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Review Receipts</h1>
          <p className="text-sm text-muted-foreground mt-1">{currentIdx + 1} of {reviewable.length} pending review</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setCurrentIdx((i) => Math.max(0, i - 1)); setEdits({}); }} disabled={currentIdx === 0}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setCurrentIdx((i) => Math.min(reviewable.length - 1, i + 1)); setEdits({}); }} disabled={currentIdx === reviewable.length - 1}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div key={receipt.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="vault-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Eye className="h-4 w-4" />Document Preview</h3>
            <span className="text-xs vault-mono text-muted-foreground">{receipt.file_name || "No file"}</span>
          </div>
          <FilePreview filePath={receipt.file_path} fileName={receipt.file_name} originalText={receipt.original_text} />
        </motion.div>

        <motion.div key={receipt.id + "-fields"} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="vault-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Edit3 className="h-4 w-4" />Extracted Fields</h3>
            {receipt.status === "needs_review" && <span className="vault-badge-warning">Needs Review</span>}
            {receipt.status === "exception" && <span className="vault-badge-error flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Exception</span>}
          </div>
          <div className="space-y-3">
            <FieldRow label="Receipt ID" value={receipt.receipt_id} confidence={1} readOnly />
            <FieldRow label="Property / Building" value={getVal("property", receipt.property)} confidence={conf.property || 0} required onChange={(v) => handleEdit("property", v)} />
            <FieldRow label="Unit" value={getVal("unit", receipt.unit)} confidence={conf.unit || 0} required onChange={(v) => handleEdit("unit", v)} />
            <FieldRow label="Tenant" value={getVal("tenant", receipt.tenant)} confidence={conf.tenant || 0} required onChange={(v) => handleEdit("tenant", v)} />
            <FieldRow label="Receipt Date" value={getVal("receipt_date", receipt.receipt_date || "")} confidence={conf.receiptDate || 0} required onChange={(v) => handleEdit("receipt_date", v)} />
            <FieldRow label="Rent Month" value={getVal("rent_month", receipt.rent_month || "")} confidence={0.85} onChange={(v) => handleEdit("rent_month", v)} />
            <FieldRow label="Amount" value={getVal("amount", String(receipt.amount))} confidence={conf.amount || 0} required onChange={(v) => handleEdit("amount", v)} />
            <FieldRow label="Payment Type" value={getVal("payment_type", receipt.payment_type || "")} confidence={conf.paymentType || 0} onChange={(v) => handleEdit("payment_type", v)} />
            <FieldRow label="Reference" value={getVal("reference", receipt.reference || "")} confidence={0.9} onChange={(v) => handleEdit("reference", v)} />
            <FieldRow label="Memo / Remarks" value={getVal("memo", receipt.memo || "")} confidence={0.88} onChange={(v) => handleEdit("memo", v)} />
          </div>
          <div className="flex gap-2 pt-4 border-t border-border">
            <Button variant="default" className="flex-1" onClick={handleFinalize} disabled={saving}>
              <CheckCircle2 className="h-4 w-4 mr-2" /> Mark as Finalized
            </Button>
            <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>
              <Save className="h-4 w-4 mr-2" /> Save Draft
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function FilePreview({ filePath, fileName, originalText }: { filePath: string | null; fileName: string | null; originalText: string | null }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fileExt = fileName?.split(".").pop()?.toLowerCase();
  const isImage = ["jpg", "jpeg", "png", "webp", "heic"].includes(fileExt || "");
  const isPdf = fileExt === "pdf";
  const isXlsx = ["xlsx", "xls"].includes(fileExt || "");
  const isEml = fileExt === "eml";

  useEffect(() => {
    if (!filePath) return;
    setLoading(true);
    setError(false);
    getFilePreviewUrl(filePath)
      .then((url) => { setPreviewUrl(url); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [filePath]);

  if (loading) {
    return (
      <div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[400px] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Image preview
  if (isImage && previewUrl && !error) {
    return (
      <div className="rounded-lg bg-muted/50 border border-border overflow-hidden min-h-[400px] flex items-center justify-center">
        <img src={previewUrl} alt={fileName || "Receipt"} className="max-w-full max-h-[600px] object-contain" />
      </div>
    );
  }

  // PDF: open in new tab (iframes are blocked in sandboxed preview)
  if (isPdf && previewUrl && !error) {
    return (
      <div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[400px]">
        <PdfViewer url={previewUrl} />
        {originalText && (
          <div className="w-full mt-4 border-t border-border pt-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">Extracted Text</p>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono max-h-[300px] overflow-auto">{originalText}</pre>
          </div>
        )}
      </div>
    );
  }

  // XLSX: render as table from extracted CSV text
  if (isXlsx && originalText) {
    return (
      <div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[400px]">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{fileName}</p>
        </div>
        <SpreadsheetPreview csv={originalText} />
        {previewUrl && !error && (
          <div className="mt-3 text-right">
            <Button variant="ghost" size="sm" onClick={() => window.open(previewUrl, "_blank")}>
              <Eye className="h-3 w-3 mr-1" /> Download Original
            </Button>
          </div>
        )}
      </div>
    );
  }

  // EML with PDF attachment: render PDF viewer
  if (isEml && originalText?.startsWith("PDF_ATTACHMENT:")) {
    const pdfPath = originalText.replace("PDF_ATTACHMENT:", "");
    return <EmlPdfPreview pdfPath={pdfPath} fileName={fileName} emlPreviewUrl={previewUrl} error={error} />;
  }

  // EML: render formatted email preview
  if (isEml && originalText) {
    return (
      <div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[400px]">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{fileName}</p>
        </div>
        <EmailPreview raw={originalText} />
        {previewUrl && !error && (
          <div className="mt-3 text-right">
            <Button variant="ghost" size="sm" onClick={() => window.open(previewUrl, "_blank")}>
              <Eye className="h-3 w-3 mr-1" /> Download Original
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Fallback for other file types
  return (
    <div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[400px]">
      <div className="flex flex-col items-center justify-center gap-3 py-4">
        <FileText className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{fileName || "Unknown file"}</p>
        {previewUrl && !error && (
          <Button variant="outline" size="sm" onClick={() => window.open(previewUrl, "_blank")}>
            <Eye className="h-4 w-4 mr-2" /> Download Source File
          </Button>
        )}
      </div>
      {originalText && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Extracted Text</p>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono max-h-[300px] overflow-auto">{originalText}</pre>
        </div>
      )}
    </div>
  );
}

function SpreadsheetPreview({ csv }: { csv: string }) {
  // Parse CSV text (may have sheet headers like "=== Sheet: Name ===")
  const lines = csv.split("\n").filter((l) => l.trim());
  const rows: string[][] = [];
  for (const line of lines) {
    if (line.startsWith("=== Sheet:")) continue; // skip sheet headers
    // Simple CSV split (handles most cases)
    rows.push(line.split(",").map((c) => c.trim()));
  }
  if (rows.length === 0) {
    return <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono max-h-[500px] overflow-auto">{csv}</pre>;
  }
  const headerRow = rows[0];
  const dataRows = rows.slice(1);
  return (
    <div className="overflow-auto max-h-[500px] rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted sticky top-0">
          <tr>
            {headerRow.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-foreground border-b border-border whitespace-nowrap">{h || `Col ${i + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "bg-background" : "bg-muted/30"}>
              {headerRow.map((_, ci) => (
                <td key={ci} className="px-3 py-1.5 text-muted-foreground border-b border-border/50 whitespace-nowrap">{row[ci] || ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmlPdfPreview({ pdfPath, fileName, emlPreviewUrl, error }: { pdfPath: string; fileName: string | null; emlPreviewUrl: string | null; error: boolean }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getFilePreviewUrl(pdfPath)
      .then((url) => { setPdfUrl(url); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, [pdfPath]);

  if (loading) {
    return (
      <div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[400px] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[400px]">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{fileName} <span className="text-xs text-muted-foreground">(PDF attachment)</span></p>
      </div>
      {pdfUrl ? (
        <PdfViewer url={pdfUrl} />
      ) : (
        <p className="text-sm text-muted-foreground">Could not load PDF attachment</p>
      )}
      {emlPreviewUrl && !error && (
        <div className="mt-3 text-right">
          <Button variant="ghost" size="sm" onClick={() => window.open(emlPreviewUrl, "_blank")}>
            <Eye className="h-3 w-3 mr-1" /> Download Original EML
          </Button>
        </div>
      )}
    </div>
  );
}

function EmailPreview({ raw }: { raw: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(500);

  // Try to extract usable HTML from the stored content
  const getHtmlContent = (text: string): string => {
    // If it starts with an HTML doctype or tag, it's already extracted HTML
    const trimmed = text.trimStart();
    if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
      return text;
    }
    // If it contains significant HTML structure (tables, divs, body), use it
    if (/<body[\s>]/i.test(text) && (/<table[\s>]/i.test(text) || /<div[\s>]/i.test(text))) {
      return text;
    }
    // Client-side fallback: try to parse MIME parts for HTML
    const parts = text.split(/--[\w\-\.]+/);
    for (const part of parts) {
      if (!/content-type:\s*text\/html/i.test(part)) continue;
      const encodingMatch = part.match(/content-transfer-encoding:\s*(\S+)/i);
      const encoding = encodingMatch?.[1]?.toLowerCase() || "7bit";
      const blankLine = part.indexOf("\r\n\r\n");
      const blankLine2 = part.indexOf("\n\n");
      const bodyStart = blankLine > 0 ? blankLine + 4 : (blankLine2 > 0 ? blankLine2 + 2 : -1);
      if (bodyStart < 0) continue;
      let body = part.substring(bodyStart).trim();
      if (encoding === "base64") {
        try { body = atob(body.replace(/\s/g, "")); } catch { continue; }
      } else if (encoding === "quoted-printable") {
        body = body
          .replace(/=\r?\n/g, "")
          .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      }
      if (body.length > 50) return body;
    }
    // Last resort: wrap as plain text
    const stripped = text.replace(/^[\s\S]*?\n\n/, ""); // remove headers
    return `<html><body style="font-family:sans-serif;padding:16px;font-size:14px;white-space:pre-wrap;background:#fff;color:#333">${stripped.substring(0, 10000).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</body></html>`;
  };

  useEffect(() => {
    if (!iframeRef.current) return;
    const htmlContent = getHtmlContent(raw);
    const doc = iframeRef.current.contentDocument;
    if (doc) {
      doc.open();
      doc.write(htmlContent);
      doc.close();
      // Auto-size iframe after a moment
      setTimeout(() => {
        try {
          const h = doc.documentElement?.scrollHeight || doc.body?.scrollHeight;
          if (h && h > 100) setIframeHeight(Math.min(h + 20, 900));
        } catch { /* cross-origin safety */ }
      }, 200);
    }
  }, [raw]);

  return (
    <div>
      <iframe
        ref={iframeRef}
        title="Email preview"
        sandbox="allow-same-origin"
        className="w-full rounded-md border border-border bg-white"
        style={{ height: `${iframeHeight}px`, minHeight: "400px" }}
      />
    </div>
  );
}

function FieldRow({ label, value, confidence, required, readOnly, onChange }: {
  label: string; value: string; confidence: number; required?: boolean; readOnly?: boolean; onChange?: (v: string) => void;
}) {
  const isLow = confidence < 0.8;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">{label}{required && <span className="text-vault-red ml-0.5">*</span>}</label>
        <ConfidenceBadge score={confidence} />
      </div>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        className={`w-full h-9 rounded-md border px-3 text-sm font-medium transition-colors
          ${readOnly ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-background text-foreground"}
          ${isLow && !readOnly ? "border-vault-amber ring-1 ring-vault-amber/30" : "border-input"}
          focus:outline-none focus:ring-2 focus:ring-ring`}
      />
    </div>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  if (pct >= 90) return <span className="vault-badge-success vault-mono text-[10px]">{pct}%</span>;
  if (pct >= 75) return <span className="vault-badge-warning vault-mono text-[10px]">{pct}%</span>;
  return <span className="vault-badge-error vault-mono text-[10px]">{pct}%</span>;
}
