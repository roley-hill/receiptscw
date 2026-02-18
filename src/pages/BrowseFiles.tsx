import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchReceipts, type DbReceipt } from "@/lib/api";
import { FolderOpen, File, ChevronRight, ChevronDown, User } from "lucide-react";

interface TreeNode {
  name: string;
  type: "folder" | "file";
  children?: TreeNode[];
  receipt?: DbReceipt;
}

function buildTree(receipts: DbReceipt[]): TreeNode {
  const finalized = receipts.filter((r) => r.status === "finalized");

  // Group by property → tenant → files
  const byProperty: Record<string, Record<string, DbReceipt[]>> = {};
  for (const r of finalized) {
    const prop = r.property || "(No Property)";
    const tenant = r.tenant || "(No Tenant)";
    if (!byProperty[prop]) byProperty[prop] = {};
    if (!byProperty[prop][tenant]) byProperty[prop][tenant] = [];
    byProperty[prop][tenant].push(r);
  }

  const propertyNodes: TreeNode[] = Object.entries(byProperty)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prop, tenants]) => ({
      name: prop,
      type: "folder" as const,
      children: Object.entries(tenants)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tenant, recs]) => ({
          name: tenant,
          type: "folder" as const,
          children: recs
            .sort((a, b) => (a.receipt_date || "").localeCompare(b.receipt_date || ""))
            .map((r) => ({
              name: r.file_name || `${r.receipt_id} — $${Number(r.amount).toFixed(2)}`,
              type: "file" as const,
              receipt: r,
            })),
        })),
    }));

  return {
    name: "Finalized Receipts",
    type: "folder",
    children: propertyNodes,
  };
}

export default function BrowseFiles() {
  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ["receipts"],
    queryFn: fetchReceipts,
  });

  const tree = useMemo(() => buildTree(receipts), [receipts]);
  const finalizedCount = receipts.filter((r) => r.status === "finalized").length;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Browse Files</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isLoading ? "Loading..." : `${finalizedCount} finalized receipts organized by property and tenant.`}
        </p>
      </div>
      <div className="vault-card p-4">
        {isLoading ? (
          <div className="text-center py-8 text-sm text-muted-foreground">Loading receipts...</div>
        ) : finalizedCount === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">No finalized receipts yet.</div>
        ) : (
          <TreeView node={tree} depth={0} />
        )}
      </div>
    </div>
  );
}

function TreeView({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const isFolder = node.type === "folder";
  const childCount = isFolder ? (node.children?.length || 0) : 0;

  return (
    <div>
      <button
        onClick={() => isFolder && setOpen(!open)}
        className={`flex items-center gap-2 py-1.5 px-2 rounded-md text-sm hover:bg-muted/50 transition-colors w-full text-left ${
          isFolder ? "cursor-pointer" : "cursor-default"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isFolder ? (
          <>
            {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            {depth === 2 ? <User className="h-4 w-4 text-accent" /> : <FolderOpen className="h-4 w-4 text-primary" />}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <File className="h-4 w-4 text-muted-foreground" />
          </>
        )}
        <span className={`${isFolder ? "font-medium text-foreground" : "text-muted-foreground"}`}>{node.name}</span>
        {isFolder && <span className="ml-auto text-xs text-muted-foreground">{childCount}</span>}
      </button>
      {isFolder && open && node.children?.map((child, i) => (
        <TreeView key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}
