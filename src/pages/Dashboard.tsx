import { mockReceipts, mockBatches } from "@/lib/mockData";
import { motion } from "framer-motion";
import {
  Upload,
  ClipboardCheck,
  FileText,
  Layers,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  CheckCircle2,
} from "lucide-react";
import { Link } from "react-router-dom";

const stats = [
  {
    label: "Total Receipts",
    value: mockReceipts.length,
    icon: FileText,
    color: "text-vault-blue",
    bg: "bg-vault-blue-light",
  },
  {
    label: "Needs Review",
    value: mockReceipts.filter((r) => r.status === "needs_review").length,
    icon: ClipboardCheck,
    color: "text-vault-amber",
    bg: "bg-vault-amber-light",
  },
  {
    label: "Exceptions",
    value: mockReceipts.filter((r) => r.status === "exception").length,
    icon: AlertTriangle,
    color: "text-vault-red",
    bg: "bg-vault-red-light",
  },
  {
    label: "Finalized",
    value: mockReceipts.filter((r) => r.status === "finalized").length,
    icon: CheckCircle2,
    color: "text-vault-emerald",
    bg: "bg-vault-emerald-light",
  },
];

const propertyTotals = mockReceipts
  .filter((r) => r.status === "finalized")
  .reduce((acc, r) => {
    acc[r.property] = (acc[r.property] || 0) + r.amount;
    return acc;
  }, {} as Record<string, number>);

const quickActions = [
  { label: "Upload Receipts", icon: Upload, to: "/upload", desc: "Batch upload receipt files" },
  { label: "Review Queue", icon: ClipboardCheck, to: "/review", desc: `${mockReceipts.filter(r => r.status === "needs_review").length} receipts pending` },
  { label: "Receivables Report", icon: FileText, to: "/receivables", desc: "Property totals & exports" },
  { label: "Deposit Batches", icon: Layers, to: "/batches", desc: `${mockBatches.length} active batches` },
];

export default function Dashboard() {
  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Receipt intake pipeline overview — January 2024</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.3 }}
            className="vault-stat"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{stat.label}</p>
                <p className="text-2xl font-bold text-foreground vault-mono mt-1">{stat.value}</p>
              </div>
              <div className={`h-10 w-10 rounded-lg ${stat.bg} flex items-center justify-center`}>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Actions */}
        <div className="lg:col-span-1 space-y-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Quick Actions</h2>
          <div className="space-y-2">
            {quickActions.map((action, i) => (
              <motion.div
                key={action.label}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.05, duration: 0.3 }}
              >
                <Link
                  to={action.to}
                  className="vault-card flex items-center gap-3 p-4 hover:border-accent transition-colors group"
                >
                  <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center group-hover:bg-accent group-hover:text-accent-foreground transition-colors">
                    <action.icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{action.label}</p>
                    <p className="text-xs text-muted-foreground">{action.desc}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-accent transition-colors" />
                </Link>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Property Totals */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-4">Property Totals (Finalized)</h2>
          <div className="vault-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Property</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipts</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transferred</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(propertyTotals).map(([property, total]) => {
                  const propReceipts = mockReceipts.filter((r) => r.property === property && r.status === "finalized");
                  const transferred = propReceipts.filter((r) => r.transferStatus === "transferred");
                  return (
                    <tr key={property} className="vault-table-row">
                      <td className="px-4 py-3 text-sm font-medium text-foreground">{property}</td>
                      <td className="px-4 py-3 text-sm text-right vault-mono font-semibold text-foreground">
                        ${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-sm text-right vault-mono text-muted-foreground">{propReceipts.length}</td>
                      <td className="px-4 py-3 text-right">
                        {transferred.length > 0 ? (
                          <span className="vault-badge-success">{transferred.length} transferred</span>
                        ) : (
                          <span className="vault-badge-neutral">pending</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30">
                  <td className="px-4 py-3 text-sm font-bold text-foreground">Grand Total</td>
                  <td className="px-4 py-3 text-sm text-right vault-mono font-bold text-foreground">
                    ${Object.values(propertyTotals).reduce((a, b) => a + b, 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-sm text-right vault-mono text-muted-foreground">
                    {mockReceipts.filter((r) => r.status === "finalized").length}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-4">Recent Receipts</h2>
        <div className="vault-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tenant</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Property</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unit</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transfer</th>
              </tr>
            </thead>
            <tbody>
              {mockReceipts.slice(0, 6).map((r) => (
                <tr key={r.id} className="vault-table-row">
                  <td className="px-4 py-3 text-xs vault-mono text-muted-foreground">{r.id}</td>
                  <td className="px-4 py-3 text-sm font-medium text-foreground">{r.tenant}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{r.property}</td>
                  <td className="px-4 py-3 text-sm vault-mono text-muted-foreground">{r.unit}</td>
                  <td className="px-4 py-3 text-sm text-right vault-mono font-semibold text-foreground">
                    ${r.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3">
                    <TransferBadge status={r.transferStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "finalized":
      return <span className="vault-badge-success">Finalized</span>;
    case "needs_review":
      return <span className="vault-badge-warning">Needs Review</span>;
    case "exception":
      return <span className="vault-badge-error">Exception</span>;
    default:
      return <span className="vault-badge-neutral">{status}</span>;
  }
}

function TransferBadge({ status }: { status: string }) {
  switch (status) {
    case "transferred":
      return <span className="vault-badge-success">Transferred</span>;
    case "reversed":
      return <span className="vault-badge-error">Reversed</span>;
    default:
      return <span className="vault-badge-neutral">Pending</span>;
  }
}
