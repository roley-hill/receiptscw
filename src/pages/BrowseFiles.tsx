import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchReceipts, getFilePreviewUrl, type DbReceipt } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { FolderOpen, File, ChevronRight, ChevronDown, User, Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilePreviewOverlay } from "@/components/FilePreview";
import { toast } from "sonner";
import JSZip from "jszip";

interface TreeNode {
  name: string;
  type: "folder" | "file";
  children?: TreeNode[];
  receipt?: DbReceipt;
}

function collectReceipts(node: TreeNode): DbReceipt[] {
  if (node.type === "file" && node.receipt) return [node.receipt];
  return node.children?.flatMap(collectReceipts) ?? [];
}

function buildTree(receipts: DbReceipt[]): TreeNode {
  const finalized = receipts.filter((r) => r.status === "finalized");
  const byProperty: Record<string, Record<string, DbReceipt[]>> = {};
  for (const r of finalized) {
    const prop = r.property || "(No Property)";
    const tenant = r.tenant || "(No Tenant)";
    if (!byProperty[prop]) byProperty[prop] = {};
    if (!byProperty[prop][tenant]) byProperty[prop][tenant] = [];
    byProperty[prop][tenant].push(r);
  }

  return {
    name: "Finalized Receipts",
    type: "folder",
    children: Object.entries(byProperty)
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
      })),
  };
}

async function downloadReceipts(receipts: DbReceipt[], zipName: string) {
  const withFiles = receipts.filter((r) => r.file_path);
  if (withFiles.length === 0) {
    toast.error("No downloadable files found");
    return;
  }

  if (withFiles.length === 1) {
    const url = await getFilePreviewUrl(withFiles[0].file_path!);
    const a = document.createElement("a");
    a.href = url;
    a.download = withFiles[0].file_name || "receipt";
    a.target = "_blank";
    a.click();
    return;
  }

  toast.info(`Preparing ${withFiles.length} files for download...`);
  const zip = new JSZip();
  
  await Promise.all(
    withFiles.map(async (r) => {
      try {
        const url = await getFilePreviewUrl(r.file_path!);
        const resp = await fetch(url);
        const blob = await resp.blob();
        zip.file(r.file_name || `${r.receipt_id}.pdf`, blob);
      } catch {
        // skip failed files
      }
    })
  );

  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${zipName}.zip`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Downloaded ${withFiles.length} files`);
}

export default function BrowseFiles() {
  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ["receipts"],
    queryFn: fetchReceipts,
  });

  const [previewReceipt, setPreviewReceipt] = useState<DbReceipt | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const tree = useMemo(() => buildTree(receipts), [receipts]);
  const finalizedCount = receipts.filter((r) => r.status === "finalized").length;

  const openPreview = useCallback(async (receipt: DbReceipt) => {
    setPreviewReceipt(receipt);
    setPreviewLoading(true);
    setPreviewUrl(null);
    if (receipt.file_path) {
      try {
        const url = await getFilePreviewUrl(receipt.file_path);
        setPreviewUrl(url);
      } catch {}
    }
    setPreviewLoading(false);
  }, []);

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
          <TreeView node={tree} depth={0} onPreview={openPreview} onDownload={downloadReceipts} />
        )}
      </div>

      {previewReceipt && (
        <FilePreviewOverlay
          fileName={previewReceipt.file_name || previewReceipt.receipt_id}
          fileUrl={previewUrl}
          loading={previewLoading}
          originalText={previewReceipt.original_text}
          onClose={() => setPreviewReceipt(null)}
        />
      )}
    </div>
  );
}

interface TreeViewProps {
  node: TreeNode;
  depth: number;
  onPreview: (r: DbReceipt) => void;
  onDownload: (receipts: DbReceipt[], name: string) => void;
}

function TreeView({ node, depth, onPreview, onDownload }: TreeViewProps) {
  const [open, setOpen] = useState(depth < 1);
  const isFolder = node.type === "folder";
  const childCount = isFolder ? (node.children?.length || 0) : 0;

  return (
    <div>
      <div className="flex items-center group">
        <button
          onClick={() => {
            if (isFolder) setOpen(!open);
            else if (node.receipt) onPreview(node.receipt);
          }}
          className={`flex items-center gap-2 py-1.5 px-2 rounded-md text-sm hover:bg-muted/50 transition-colors flex-1 text-left cursor-pointer`}
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
          <span className={`${isFolder ? "font-medium text-foreground" : "text-muted-foreground"} truncate`}>{node.name}</span>
          {isFolder && <span className="ml-auto text-xs text-muted-foreground shrink-0">{childCount}</span>}
        </button>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pr-2 shrink-0">
          {node.type === "file" && node.receipt && (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onPreview(node.receipt!)} title="Preview">
                <Eye className="h-3.5 w-3.5" />
              </Button>
              {node.receipt.file_path && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDownload([node.receipt!], node.receipt!.file_name || "receipt")} title="Download">
                  <Download className="h-3.5 w-3.5" />
                </Button>
              )}
            </>
          )}
          {isFolder && depth > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                const recs = collectReceipts(node);
                onDownload(recs, node.name.replace(/[^a-zA-Z0-9]/g, "_"));
              }}
              title={`Download all (${collectReceipts(node).length})`}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {isFolder && open && node.children?.map((child, i) => (
        <TreeView key={i} node={child} depth={depth + 1} onPreview={onPreview} onDownload={onDownload} />
      ))}
    </div>
  );
}
