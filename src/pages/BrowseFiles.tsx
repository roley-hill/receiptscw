import { useState } from "react";
import { properties } from "@/lib/mockData";
import { FolderOpen, File, ChevronRight, ChevronDown } from "lucide-react";

interface TreeNode {
  name: string;
  type: "folder" | "file";
  children?: TreeNode[];
}

const fileTree: TreeNode = {
  name: "Receipts",
  type: "folder",
  children: [
    {
      name: "2024-01",
      type: "folder",
      children: properties.map((p) => ({
        name: p,
        type: "folder" as const,
        children: [
          {
            name: "101",
            type: "folder" as const,
            children: [
              { name: "original", type: "folder" as const, children: [{ name: "receipt_jan.pdf", type: "file" as const }] },
              { name: "processed", type: "folder" as const, children: [{ name: "receipt_jan_extracted.json", type: "file" as const }] },
            ],
          },
          {
            name: "102",
            type: "folder" as const,
            children: [
              { name: "original", type: "folder" as const, children: [{ name: "ach_receipt.pdf", type: "file" as const }] },
            ],
          },
        ],
      })),
    },
  ],
};

export default function BrowseFiles() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Browse Files</h1>
        <p className="text-sm text-muted-foreground mt-1">Structured file hierarchy for all receipts and reports.</p>
      </div>
      <div className="vault-card p-4">
        <TreeView node={fileTree} depth={0} />
      </div>
    </div>
  );
}

function TreeView({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const isFolder = node.type === "folder";

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
            <FolderOpen className="h-4 w-4 text-vault-amber" />
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <File className="h-4 w-4 text-vault-blue" />
          </>
        )}
        <span className={`${isFolder ? "font-medium text-foreground" : "text-muted-foreground"}`}>{node.name}</span>
      </button>
      {isFolder && open && node.children?.map((child, i) => (
        <TreeView key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}
