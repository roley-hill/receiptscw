import { useState } from "react";
import { mockReceipts, properties } from "@/lib/mockData";
import { Receipt } from "@/lib/types";
import { motion } from "framer-motion";
import { Copy, Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function EntryView() {
  const finalized = mockReceipts.filter((r) => r.status === "finalized");
  const grouped = finalized.reduce((acc, r) => {
    if (!acc[r.property]) acc[r.property] = {};
    if (!acc[r.property][r.unit]) acc[r.property][r.unit] = [];
    acc[r.property][r.unit].push(r);
    return acc;
  }, {} as Record<string, Record<string, Receipt[]>>);

  const [expandedProperty, setExpandedProperty] = useState<string | null>(properties[0]);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(finalized[0] || null);
  const [copied, setCopied] = useState<string | null>(null);

  const copyField = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const copyAll = (r: Receipt) => {
    const text = `${r.tenant}\t${r.amount.toFixed(2)}\t${r.receiptDate}\t${r.reference}\t${r.memo}\t${r.paymentType}`;
    navigator.clipboard.writeText(text);
    setCopied("all");
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-4 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">AppFolio Entry View</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tenant-by-tenant data for manual AppFolio entry. Copy fields or full packs.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Navigation Tree */}
        <div className="vault-card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Building → Unit → Tenant</h3>
          </div>
          <div className="divide-y divide-border max-h-[600px] overflow-auto">
            {Object.entries(grouped).map(([property, units]) => (
              <div key={property}>
                <button
                  onClick={() => setExpandedProperty(expandedProperty === property ? null : property)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                >
                  <span>{property}</span>
                  <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expandedProperty === property ? "rotate-90" : ""}`} />
                </button>
                {expandedProperty === property && (
                  <div className="bg-muted/20">
                    {Object.entries(units).map(([unit, receipts]) =>
                      receipts.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setSelectedReceipt(r)}
                          className={`w-full flex items-center gap-3 px-6 py-2.5 text-sm transition-colors ${
                            selectedReceipt?.id === r.id
                              ? "bg-accent/10 text-accent font-medium border-l-2 border-accent"
                              : "text-foreground hover:bg-muted/50 border-l-2 border-transparent"
                          }`}
                        >
                          <span className="vault-mono text-xs text-muted-foreground">{unit}</span>
                          <span className="truncate">{r.tenant}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Receipt Detail */}
        <div className="lg:col-span-2">
          {selectedReceipt ? (
            <motion.div
              key={selectedReceipt.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="vault-card p-5 space-y-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-foreground">{selectedReceipt.tenant}</h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedReceipt.property} · Unit {selectedReceipt.unit} · {selectedReceipt.rentMonth}
                  </p>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => copyAll(selectedReceipt)}
                >
                  {copied === "all" ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                  Copy All
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <CopyableField label="Tenant" value={selectedReceipt.tenant} fieldKey="tenant" copied={copied} onCopy={copyField} />
                <CopyableField label="Amount" value={`$${selectedReceipt.amount.toFixed(2)}`} fieldKey="amount" copied={copied} onCopy={copyField} mono />
                <CopyableField label="Receipt Date" value={selectedReceipt.receiptDate} fieldKey="date" copied={copied} onCopy={copyField} mono />
                <CopyableField label="Reference" value={selectedReceipt.reference} fieldKey="ref" copied={copied} onCopy={copyField} mono />
                <CopyableField label="Payment Type" value={selectedReceipt.paymentType} fieldKey="ptype" copied={copied} onCopy={copyField} />
                <CopyableField label="Remarks / Memo" value={selectedReceipt.memo} fieldKey="memo" copied={copied} onCopy={copyField} />
              </div>

              <div className="text-xs text-muted-foreground pt-2 border-t border-border vault-mono">
                Receipt ID: {selectedReceipt.id} · File: {selectedReceipt.fileName}
              </div>
            </motion.div>
          ) : (
            <div className="vault-card flex items-center justify-center h-60 text-muted-foreground text-sm">
              Select a tenant from the tree
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CopyableField({
  label,
  value,
  fieldKey,
  copied,
  onCopy,
  mono,
}: {
  label: string;
  value: string;
  fieldKey: string;
  copied: string | null;
  onCopy: (key: string, value: string) => void;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <div className={`flex-1 h-9 rounded-md border border-input bg-muted/30 px-3 flex items-center text-sm ${mono ? "vault-mono" : "font-medium"} text-foreground`}>
          {value}
        </div>
        <button
          onClick={() => onCopy(fieldKey, value)}
          className="h-9 w-9 rounded-md border border-input flex items-center justify-center hover:bg-muted transition-colors"
        >
          {copied === fieldKey ? (
            <Check className="h-3.5 w-3.5 text-vault-emerald" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
      </div>
    </div>
  );
}
