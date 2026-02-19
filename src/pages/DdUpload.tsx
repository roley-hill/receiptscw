import { useState, useRef, useCallback } from "react";
import ExcelJS from "exceljs";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Upload,
  FileArchive,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Download,
  Loader2,
  X,
  Building2,
  Plus,
  Trash2,
} from "lucide-react";

// Exact AppFolio import template columns (in order)
export const APPFOLIO_COLUMNS = [
  "Unit Name",
  "Unit Address1",
  "Unit Address2",
  "Unit City",
  "Unit State",
  "Unit Postal Code",
  "Unit Tags",
  "Market Rent",
  "Square Feet",
  "Bedrooms",
  "Bathrooms",
  "Cats Allowed",
  "Dogs Allowed",
  "Primary Tenant First Name",
  "Primary Tenant Last Name",
  "Primary Tenant Company Name",
  "Primary Tenant Move In",
  "Primary Tenant Move Out",
  "Lease From",
  "Lease To",
  "Unit Rent Charge",
  "Unit Rent Frequency",
  "Unit Rent Start Date",
  "Unit Rent End Date",
  "Primary Tenant Email Address",
  "Primary Tenant Phone Number #1",
  "Primary Tenant Phone Label #1",
  "Primary Tenant Phone Notes #1",
  "Tenant Tags",
  "Tenant Address1",
  "Tenant Address2",
  "Tenant City",
  "Tenant State",
  "Tenant Postal Code",
  "Roommate First #1",
  "Roommate Last #1",
  "Roommate Email #1",
  "Roommate #1 Phone #1",
  "Roommate #1 Phone Label #1",
  "Roommate Move In #1",
  "Roommate Move Out #1",
  "Addt Recurring GL Account #1",
  "Addt Recurring Start Date #1",
  "Addt Recurring End Date #1",
  "Addt Recurring Charge Amount #1",
  "Addt Recurring Frequency #1",
  "3300: Prepayment Amount",
  "3300: Prepayment Date",
  "3201: Security Deposits - Residential Amount",
  "3201: Security Deposits - Residential Date",
  "3202: Security Deposits - Pets Amount",
  "3202: Security Deposits - Pets Date",
] as const;

type AppFolioRow = Record<string, string>;
type ProcessingStatus = "idle" | "uploading" | "extracting" | "done" | "error";

interface ExtractionResult {
  property_name: string;
  rows: AppFolioRow[];
  summary: {
    rows_found: number;
    source_files: string[];
    warnings: string[];
  };
}

// Column width hints for display
const WIDE_COLS = new Set([
  "Unit Address1", "Primary Tenant First Name", "Primary Tenant Last Name",
  "Primary Tenant Email Address", "Primary Tenant Phone Number #1",
  "Roommate First #1", "Roommate Last #1", "Roommate Email #1",
  "Addt Recurring GL Account #1",
]);

function emptyRow(): AppFolioRow {
  const row: AppFolioRow = {};
  APPFOLIO_COLUMNS.forEach((col) => { row[col] = ""; });
  return row;
}

export default function DdUpload() {
  const { session } = useAuth();
  const [status, setStatus] = useState<ProcessingStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [rows, setRows] = useState<AppFolioRow[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setResult(null);
      setRows([]);
      setStatus("idle");
      setErrorMsg("");
      (window as any).__ddFolderFiles = undefined;
    }
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    const folderName = fileList[0]?.webkitRelativePath?.split("/")[0] || "folder";
    (window as any).__ddFolderFiles = fileList;
    setSelectedFile(new File([], `${folderName}/ (${fileList.length} files)`));
    setResult(null);
    setRows([]);
    setStatus("idle");
    setErrorMsg("");
  };

  const processUpload = async () => {
    if (!selectedFile || !session?.access_token) return;
    setStatus("uploading");
    setProgress(10);
    setErrorMsg("");

    try {
      const formData = new FormData();
      const folderFiles: File[] | undefined = (window as any).__ddFolderFiles;

      if (folderFiles && folderFiles.length > 0) {
        folderFiles.forEach((f) => {
          formData.append("files", f, f.webkitRelativePath || f.name);
        });
        formData.append("upload_type", "folder");
      } else {
        formData.append("file", selectedFile);
        formData.append("upload_type", "zip");
      }

      setProgress(30);
      setStatus("extracting");

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dd-extract`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: formData,
        }
      );

      setProgress(80);

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Extraction failed");
      }

      const data: ExtractionResult = await resp.json();
      setResult(data);
      setRows(data.rows.map((r) => {
        const normalized: AppFolioRow = {};
        APPFOLIO_COLUMNS.forEach((col) => { normalized[col] = r[col] ?? ""; });
        return normalized;
      }));
      setProgress(100);
      setStatus("done");
      toast.success(`Extracted ${data.rows.length} rows from ${data.summary?.source_files?.length || 0} documents`);
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Unknown error");
      toast.error(err.message || "Extraction failed");
    }
  };

  const updateCell = useCallback((rowIdx: number, col: string, value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx], [col]: value };
      return next;
    });
  }, []);

  const addRow = () => {
    setRows((prev) => [...prev, emptyRow()]);
  };

  const deleteRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const downloadXlsx = async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("AppFolio Import");

    // Header row
    ws.addRow(APPFOLIO_COLUMNS as unknown as string[]);
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE8F0FE" },
    };

    // Data rows
    rows.forEach((row) => {
      ws.addRow(APPFOLIO_COLUMNS.map((col) => row[col] ?? ""));
    });

    // Column widths
    ws.columns.forEach((col, i) => {
      const name = APPFOLIO_COLUMNS[i] || "";
      col.width = WIDE_COLS.has(name) ? 28 : 18;
    });

    const buf = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result?.property_name || "DD_Extract"}_AppFolio_Import.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setStatus("idle");
    setResult(null);
    setRows([]);
    setSelectedFile(null);
    setErrorMsg("");
    setProgress(0);
    (window as any).__ddFolderFiles = undefined;
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Building2 className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Due Diligence — AppFolio Import</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Upload a DD folder or ZIP to extract and edit tenant/unit data, then download the AppFolio import XLSX.
        </p>
      </div>

      {/* Upload Area */}
      <div className="vault-card p-6 space-y-4 max-w-3xl">
        <h2 className="text-sm font-semibold text-foreground">Select DD Package</h2>

        <div className="grid grid-cols-2 gap-3">
          <label className="group cursor-pointer">
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.rar,.tar,.gz"
              className="hidden"
              onChange={handleFileSelect}
            />
            <div className="border-2 border-dashed border-border group-hover:border-primary/50 rounded-lg p-6 text-center transition-colors">
              <FileArchive className="h-8 w-8 text-muted-foreground group-hover:text-primary mx-auto mb-2 transition-colors" />
              <p className="text-sm font-medium text-foreground">Upload ZIP File</p>
              <p className="text-xs text-muted-foreground mt-1">Select a zipped DD package</p>
            </div>
          </label>

          <label className="group cursor-pointer">
            <input
              ref={folderInputRef}
              type="file"
              // @ts-ignore
              webkitdirectory="true"
              multiple
              className="hidden"
              onChange={handleFolderSelect}
            />
            <div className="border-2 border-dashed border-border group-hover:border-primary/50 rounded-lg p-6 text-center transition-colors">
              <FolderOpen className="h-8 w-8 text-muted-foreground group-hover:text-primary mx-auto mb-2 transition-colors" />
              <p className="text-sm font-medium text-foreground">Upload Folder</p>
              <p className="text-xs text-muted-foreground mt-1">Select a DD folder directly</p>
            </div>
          </label>
        </div>

        {selectedFile && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm text-foreground flex-1 truncate">{selectedFile.name}</span>
            <button onClick={reset} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {(status === "uploading" || status === "extracting") && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {status === "uploading" ? "Uploading documents…" : "AI extracting structured data…"}
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        <div className="flex gap-3">
          <Button
            onClick={processUpload}
            disabled={!selectedFile || status === "uploading" || status === "extracting"}
            className="gap-2"
          >
            {status === "uploading" || status === "extracting" ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
            ) : (
              <><Upload className="h-4 w-4" /> Extract Data</>
            )}
          </Button>
          {rows.length > 0 && (
            <Button variant="outline" onClick={downloadXlsx} className="gap-2">
              <Download className="h-4 w-4" /> Download AppFolio XLSX
            </Button>
          )}
        </div>
      </div>

      {/* Error */}
      {status === "error" && (
        <div className="vault-card p-4 flex items-start gap-3 max-w-3xl">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Extraction failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {result && status === "done" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 vault-card p-4 max-w-3xl">
            <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                {result.property_name} — {rows.length} row{rows.length !== 1 ? "s" : ""} extracted
              </p>
              <p className="text-xs text-muted-foreground">
                From {result.summary.source_files.length} source file(s). Edit cells directly below.
              </p>
            </div>
          </div>

          {/* Warnings */}
          {result.summary.warnings?.length > 0 && (
            <div className="vault-card p-4 space-y-1 max-w-3xl">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Warnings</p>
              {result.summary.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <AlertCircle className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Editable Spreadsheet */}
      {rows.length > 0 && (
        <div className="vault-card overflow-hidden">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">AppFolio Import Data</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Click any cell to edit. {rows.length} row{rows.length !== 1 ? "s" : ""} · {APPFOLIO_COLUMNS.length} columns
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={addRow} className="gap-1.5 h-8 text-xs">
                <Plus className="h-3.5 w-3.5" /> Add Row
              </Button>
              <Button size="sm" onClick={downloadXlsx} className="gap-1.5 h-8 text-xs">
                <Download className="h-3.5 w-3.5" /> Download XLSX
              </Button>
            </div>
          </div>

          {/* Spreadsheet grid */}
          <div className="overflow-auto" style={{ maxHeight: "70vh" }}>
            <table className="text-xs border-collapse" style={{ minWidth: "max-content" }}>
              <thead className="sticky top-0 z-20">
                <tr>
                  {/* Row number header */}
                  <th className="sticky left-0 z-30 bg-muted border-b border-r border-border w-10 min-w-[2.5rem] text-center text-muted-foreground font-medium p-0">
                    <div className="px-2 py-2">#</div>
                  </th>
                  {APPFOLIO_COLUMNS.map((col) => (
                    <th
                      key={col}
                      className="bg-muted border-b border-r border-border text-left font-medium text-muted-foreground whitespace-nowrap"
                      style={{ minWidth: WIDE_COLS.has(col) ? 180 : 120 }}
                    >
                      <div className="px-2 py-2 truncate max-w-[220px]" title={col}>{col}</div>
                    </th>
                  ))}
                  {/* Delete col header */}
                  <th className="sticky right-0 z-30 bg-muted border-b border-l border-border w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIdx) => (
                  <tr
                    key={rowIdx}
                    className="group hover:bg-muted/30"
                  >
                    {/* Row number */}
                    <td className="sticky left-0 z-10 bg-background group-hover:bg-muted/30 border-b border-r border-border text-center text-muted-foreground select-none">
                      <div className="px-2 py-1">{rowIdx + 1}</div>
                    </td>

                    {APPFOLIO_COLUMNS.map((col) => (
                      <td
                        key={col}
                        className="border-b border-r border-border p-0 relative"
                        style={{ minWidth: WIDE_COLS.has(col) ? 180 : 120 }}
                        onClick={() => setEditingCell({ row: rowIdx, col })}
                      >
                        {editingCell?.row === rowIdx && editingCell?.col === col ? (
                          <input
                            autoFocus
                            className="w-full h-full px-2 py-1 bg-accent/30 border border-primary outline-none text-foreground"
                            style={{ minWidth: WIDE_COLS.has(col) ? 180 : 120 }}
                            value={row[col]}
                            onChange={(e) => updateCell(rowIdx, col, e.target.value)}
                            onBlur={() => setEditingCell(null)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "Tab") {
                                e.preventDefault();
                                setEditingCell(null);
                              }
                              if (e.key === "Escape") setEditingCell(null);
                            }}
                          />
                        ) : (
                          <div
                            className="px-2 py-1 cursor-text whitespace-nowrap overflow-hidden text-ellipsis text-foreground"
                            style={{ maxWidth: WIDE_COLS.has(col) ? 220 : 140 }}
                            title={row[col]}
                          >
                            {row[col] || <span className="text-muted-foreground/40">—</span>}
                          </div>
                        )}
                      </td>
                    ))}

                    {/* Delete row button */}
                    <td className="sticky right-0 z-10 bg-background group-hover:bg-muted/30 border-b border-l border-border p-0">
                      <button
                        onClick={() => deleteRow(rowIdx)}
                        className="w-10 h-full flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors py-1"
                        title="Delete row"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Source files */}
      {result && (
        <div className="vault-card p-4 max-w-3xl">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Source Files Processed</p>
          <div className="flex flex-wrap gap-2">
            {result.summary.source_files.map((f, i) => (
              <Badge key={i} variant="secondary" className="text-xs font-normal">{f}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
