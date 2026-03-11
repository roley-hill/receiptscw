import { AlertTriangle } from "lucide-react";

export function TenantStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "current") return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20">Current</span>;
  if (s === "notice") return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20">Notice</span>;
  if (s === "evict") return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-500/15 text-red-600 dark:text-red-400 ring-1 ring-red-500/20">Evict</span>;
  if (s === "past") return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground ring-1 ring-border">Past</span>;
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground ring-1 ring-border">{status}</span>;
}

export function ChargeTypeBadge({ chargeType }: { chargeType: string }) {
  const ct = chargeType.toLowerCase();
  if (ct === "tenant charge") return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-blue-500/15 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/20">Tenant Charge</span>;
  if (ct === "subsidy") return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-purple-500/15 text-purple-600 dark:text-purple-400 ring-1 ring-purple-500/20">Subsidy</span>;
  if (ct === "combined") return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 ring-1 ring-cyan-500/20">Combined</span>;
  if (ct === "utility") return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-orange-500/15 text-orange-600 dark:text-orange-400 ring-1 ring-orange-500/20">Utility</span>;
  if (ct === "fee") return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/20">Fee</span>;
  if (ct === "partial") return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20">Partial</span>;
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground ring-1 ring-border">{chargeType}</span>;
}

export function AppfolioPaidBadge({ recordedDate }: { recordedDate?: string }) {
  const dateLabel = recordedDate
    ? (() => {
        const d = new Date(recordedDate + "T00:00:00");
        return ` ${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
      })()
    : "";
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20" title={`Already recorded as paid in AppFolio${recordedDate ? ` on ${recordedDate}` : ""}`}>
      ✓ Paid in AF{dateLabel}
    </span>
  );
}

export function UnverifiedBadge({ field }: { field: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20" title={`${field} not found in AppFolio — using receipt data`}>
      <AlertTriangle className="h-2.5 w-2.5" />
      Unverified
    </span>
  );
}
