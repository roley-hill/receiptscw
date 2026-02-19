import { useState, useRef } from "react";
import ExcelJS from "exceljs";
import { supabase } from "@/integrations/supabase/client";
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
} from "lucide-react";

type ProcessingStatus = "idle" | "uploading" | "extracting" | "done" | "error";

interface AppFolioUnit {
  unit_number: string;
  bedrooms: string;
  bathrooms: string;
  sqft: string;
  unit_type: string;
  market_rent: string;
}

interface AppFolioTenant {
  unit_number: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  lease_start: string;
  lease_end: string;
  move_in: string;
  rent_amount: string;
  status: string;
}

interface AppFolioCharge {
  unit_number: string;
  tenant_name: string;
  charge_type: string;
  amount: string;
  frequency: string;
  effective_date: string;
}

interface AppFolioDeposit {
  unit_number: string;
  tenant_name: string;
  deposit_type: string;
  amount: string;
}

interface ExtractionResult {
  property_name: string;
  units: AppFolioUnit[];
  tenants: AppFolioTenant[];
  charges: AppFolioCharge[];
  deposits: AppFolioDeposit[];
  summary: {
    units_found: number;
    tenants_found: number;
    charges_found: number;
    deposits_found: number;
    source_files: string[];
    warnings: string[];
  };
}

export default function DdUpload() {
  const { session } = useAuth();
  const [status, setStatus] = useState<ProcessingStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setResult(null);
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
      setProgress(100);
      setStatus("done");
      toast.success(`Extracted data from ${data.summary?.source_files?.length || 0} documents`);
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Unknown error");
      toast.error(err.message || "Extraction failed");
    }
  };

  const downloadXlsx = async () => {
    if (!result) return;

    const workbook = new ExcelJS.Workbook();

    const addSheet = (name: string, headers: string[], rows: Record<string, string>[]) => {
      if (rows.length === 0) return;
      const ws = workbook.addWorksheet(name);
      ws.addRow(headers);
      ws.getRow(1).font = { bold: true };
      rows.forEach((row) => ws.addRow(headers.map((h) => row[h] ?? "")));
      ws.columns.forEach((col) => { col.width = 20; });
    };

    addSheet(
      "Units",
      ["Unit Number", "Unit Type", "Bedrooms", "Bathrooms", "Square Feet", "Market Rent"],
      result.units.map((u) => ({
        "Unit Number": u.unit_number,
        "Unit Type": u.unit_type,
        "Bedrooms": u.bedrooms,
        "Bathrooms": u.bathrooms,
        "Square Feet": u.sqft,
        "Market Rent": u.market_rent,
      }))
    );

    addSheet(
      "Tenants",
      ["Unit Number", "First Name", "Last Name", "Email", "Phone", "Lease Start", "Lease End", "Move In Date", "Rent Amount", "Status"],
      result.tenants.map((t) => ({
        "Unit Number": t.unit_number,
        "First Name": t.first_name,
        "Last Name": t.last_name,
        "Email": t.email,
        "Phone": t.phone,
        "Lease Start": t.lease_start,
        "Lease End": t.lease_end,
        "Move In Date": t.move_in,
        "Rent Amount": t.rent_amount,
        "Status": t.status,
      }))
    );

    addSheet(
      "Charges",
      ["Unit Number", "Tenant Name", "Charge Type", "Amount", "Frequency", "Effective Date"],
      result.charges.map((c) => ({
        "Unit Number": c.unit_number,
        "Tenant Name": c.tenant_name,
        "Charge Type": c.charge_type,
        "Amount": c.amount,
        "Frequency": c.frequency,
        "Effective Date": c.effective_date,
      }))
    );

    addSheet(
      "Security Deposits",
      ["Unit Number", "Tenant Name", "Deposit Type", "Amount"],
      result.deposits.map((d) => ({
        "Unit Number": d.unit_number,
        "Tenant Name": d.tenant_name,
        "Deposit Type": d.deposit_type,
        "Amount": d.amount,
      }))
    );

    const buf = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.property_name || "DD_Extract"}_AppFolio_Import.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setStatus("idle");
    setResult(null);
    setSelectedFile(null);
    setErrorMsg("");
    setProgress(0);
    (window as any).__ddFolderFiles = undefined;
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Building2 className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Due Diligence — AppFolio Import</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Upload a DD folder or ZIP to extract tenant, unit, charge, and deposit data ready for AppFolio import.
        </p>
      </div>

      {/* Upload Area */}
      <div className="vault-card p-6 space-y-4">
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
              <><Upload className="h-4 w-4" /> Extract & Generate XLSX</>
            )}
          </Button>
          {result && (
            <Button variant="outline" onClick={downloadXlsx} className="gap-2">
              <Download className="h-4 w-4" /> Download AppFolio XLSX
            </Button>
          )}
        </div>
      </div>

      {/* Error */}
      {status === "error" && (
        <div className="vault-card p-4 flex items-start gap-3">
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
          <div className="vault-card p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                Extraction complete — {result.property_name || "Property"}
              </p>
              <p className="text-xs text-muted-foreground">
                Processed {result.summary.source_files.length} source file(s)
              </p>
            </div>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Units", value: result.summary.units_found },
              { label: "Tenants", value: result.summary.tenants_found },
              { label: "Charges", value: result.summary.charges_found },
              { label: "Deposits", value: result.summary.deposits_found },
            ].map((s) => (
              <div key={s.label} className="vault-card p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Warnings */}
          {result.summary.warnings?.length > 0 && (
            <div className="vault-card p-4 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Warnings</p>
              {result.summary.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <AlertCircle className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Tenants preview table */}
          {result.tenants.length > 0 && (
            <div className="vault-card">
              <div className="p-4 border-b border-border">
                <h3 className="text-sm font-semibold text-foreground">Tenants Preview</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left p-3 font-medium text-muted-foreground">Unit</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Name</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Lease Start</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Lease End</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Rent</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.tenants.slice(0, 10).map((t, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="p-3 font-mono">{t.unit_number}</td>
                        <td className="p-3">{t.first_name} {t.last_name}</td>
                        <td className="p-3">{t.lease_start}</td>
                        <td className="p-3">{t.lease_end}</td>
                        <td className="p-3 text-right">{t.rent_amount}</td>
                        <td className="p-3">
                          <Badge variant="outline" className="text-[10px]">{t.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.tenants.length > 10 && (
                  <p className="text-xs text-muted-foreground p-3">
                    +{result.tenants.length - 10} more rows in downloaded XLSX
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Source files */}
          <div className="vault-card p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Source Files Processed</p>
            <div className="flex flex-wrap gap-2">
              {result.summary.source_files.map((f, i) => (
                <Badge key={i} variant="secondary" className="text-xs font-normal">{f}</Badge>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
