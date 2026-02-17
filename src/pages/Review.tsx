import { useState } from "react";
import { mockReceipts } from "@/lib/mockData";
import { Receipt } from "@/lib/types";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Edit3,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ReviewPage() {
  const reviewable = mockReceipts.filter((r) => r.status === "needs_review" || r.status === "exception");
  const [currentIdx, setCurrentIdx] = useState(0);
  const receipt = reviewable[currentIdx];

  if (!receipt) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <CheckCircle2 className="h-12 w-12 text-vault-emerald mb-4" />
        <h2 className="text-xl font-bold text-foreground">All caught up!</h2>
        <p className="text-sm text-muted-foreground mt-1">No receipts pending review.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Review Receipts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {currentIdx + 1} of {reviewable.length} pending review
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
            disabled={currentIdx === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentIdx((i) => Math.min(reviewable.length - 1, i + 1))}
            disabled={currentIdx === reviewable.length - 1}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Document Preview */}
        <motion.div
          key={receipt.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="vault-card p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Document Preview
            </h3>
            <span className="text-xs vault-mono text-muted-foreground">{receipt.fileName}</span>
          </div>
          <div className="rounded-lg bg-muted/50 border border-border flex items-center justify-center h-[500px]">
            <div className="text-center text-muted-foreground">
              <Eye className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Document preview</p>
              <p className="text-xs mt-1">{receipt.fileName}</p>
            </div>
          </div>
        </motion.div>

        {/* Editable Fields */}
        <motion.div
          key={receipt.id + "-fields"}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          className="vault-card p-4 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Edit3 className="h-4 w-4" />
              Extracted Fields
            </h3>
            <StatusBadge status={receipt.status} />
          </div>

          <div className="space-y-3">
            <FieldRow label="Receipt ID" value={receipt.id} confidence={1} readOnly />
            <FieldRow label="Property / Building" value={receipt.property} confidence={receipt.confidence.property} required />
            <FieldRow label="Unit" value={receipt.unit} confidence={receipt.confidence.unit} required />
            <FieldRow label="Tenant" value={receipt.tenant} confidence={receipt.confidence.tenant} required />
            <FieldRow label="Receipt Date" value={receipt.receiptDate} confidence={receipt.confidence.receiptDate} required />
            <FieldRow label="Rent Month" value={receipt.rentMonth} confidence={0.85} />
            <FieldRow label="Amount" value={`$${receipt.amount.toFixed(2)}`} confidence={receipt.confidence.amount} required />
            <FieldRow label="Payment Type" value={receipt.paymentType} confidence={receipt.confidence.paymentType} />
            <FieldRow label="Reference" value={receipt.reference} confidence={0.9} />
            <FieldRow label="Memo / Remarks" value={receipt.memo} confidence={0.88} />
          </div>

          <div className="flex gap-2 pt-4 border-t border-border">
            <Button variant="default" className="flex-1">
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Mark as Ready
            </Button>
            <Button variant="outline">
              <Save className="h-4 w-4 mr-2" />
              Save Draft
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  value,
  confidence,
  required,
  readOnly,
}: {
  label: string;
  value: string;
  confidence: number;
  required?: boolean;
  readOnly?: boolean;
}) {
  const isLow = confidence < 0.8;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">
          {label}
          {required && <span className="text-vault-red ml-0.5">*</span>}
        </label>
        <ConfidenceBadge score={confidence} />
      </div>
      <input
        type="text"
        defaultValue={value}
        readOnly={readOnly}
        className={`
          w-full h-9 rounded-md border px-3 text-sm font-medium transition-colors
          ${readOnly ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-background text-foreground"}
          ${isLow ? "border-vault-amber ring-1 ring-vault-amber/30" : "border-input"}
          focus:outline-none focus:ring-2 focus:ring-ring
        `}
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

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "needs_review":
      return <span className="vault-badge-warning">Needs Review</span>;
    case "exception":
      return <span className="vault-badge-error flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Exception</span>;
    default:
      return <span className="vault-badge-neutral">{status}</span>;
  }
}
