import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Building2,
  FolderOpen,
  FileArchive,
  Loader2,
  CheckCircle2,
  AlertCircle,
  MapPin,
  X,
  Edit2,
  ChevronRight,
  File,
  FolderIcon,
  ScanLine,
  Cpu,
  FolderSymlink,
  Plus,
  ArrowRight,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NominatimResult {
  place_id: number;
  display_name: string;
  address: {
    road?: string;
    house_number?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
  };
}

type FileStep = "queued" | "uploading" | "ocr" | "classifying" | "done" | "error";

interface FileRow {
  id: string;
  file: File;
  step: FileStep;
  error?: string;
  renamed_to?: string;
  category?: string;
  building_slug?: string;
  unit?: string;
  confidence?: number;
  method?: "ocr" | "ai" | "ocr+ai";
}

interface SortedFile {
  method?: "ocr" | "ai" | "ocr+ai";
  original_name: string;
  renamed_to: string;
  category: string;
  building_slug: string;
  unit: string;
  storage_path: string;
  confidence: number;
}

type Phase = "setup" | "files-ready" | "confirm-address" | "processing" | "done" | "error";

const CATEGORY_LABELS: Record<string, string> = {
  lease: "Lease",
  "rent-roll": "Rent Roll",
  notice: "Notice",
  estoppel: "Estoppel",
  other: "Other",
};

const CATEGORY_COLORS: Record<string, string> = {
  lease: "bg-blue-500/10 text-blue-700 border-blue-200",
  "rent-roll": "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  notice: "bg-amber-500/10 text-amber-700 border-amber-200",
  estoppel: "bg-purple-500/10 text-purple-700 border-purple-200",
  other: "bg-muted text-muted-foreground border-border",
};

const STEP_ICON: Record<FileStep, React.ReactNode> = {
  queued:      <div className="w-2 h-2 rounded-full bg-muted-foreground/25 mx-auto" />,
  uploading:   <Loader2 className="h-4 w-4 animate-spin text-primary" />,
  ocr:         <ScanLine className="h-4 w-4 animate-pulse text-amber-500" />,
  classifying: <Cpu className="h-4 w-4 animate-pulse text-violet-500" />,
  done:        <CheckCircle2 className="h-4 w-4 text-primary" />,
  error:       <AlertCircle className="h-4 w-4 text-destructive" />,
};

const STEP_LABEL: Record<FileStep, string> = {
  queued: "Waiting",
  uploading: "Uploading…",
  ocr: "Scanning…",
  classifying: "Classifying…",
  done: "Done",
  error: "Error",
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Address Autocomplete ──────────────────────────────────────────────────────

function AddressAutocomplete({
  value,
  onChange,
  onSelect,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (r: { address: string; city: string; state: string; postal_code: string }) => void;
}) {
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 5) { setResults([]); setOpen(false); return; }
    setLoading(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=6&countrycodes=us`;
      const resp = await fetch(url, { headers: { "Accept-Language": "en-US" } });
      const data: NominatimResult[] = await resp.json();
      setResults(data);
      setOpen(data.length > 0);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  const handleChange = (v: string) => {
    onChange(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(v), 400);
  };

  const pick = (r: NominatimResult) => {
    const a = r.address;
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    onChange(street);
    onSelect({ address: street, city: a.city || a.town || a.village || "", state: a.state || "", postal_code: a.postcode || "" });
    setOpen(false);
    setResults([]);
  };

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Start typing a street address…"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg overflow-hidden">
          {results.map((r) => (
            <button
              key={r.place_id}
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted/60 transition-colors border-b border-border/50 last:border-0"
              onMouseDown={() => pick(r)}
            >
              {r.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── File Status Row ───────────────────────────────────────────────────────────

function FileStatusRow({ row, onRemove }: { row: FileRow; onRemove?: () => void }) {
  const isActive = row.step === "uploading" || row.step === "ocr" || row.step === "classifying";

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 last:border-0">
      {/* Step icon */}
      <div className="shrink-0 w-6 flex items-center justify-center">
        {STEP_ICON[row.step]}
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        {row.step === "done" ? (
          <>
            <p className="text-xs font-mono text-foreground truncate" title={row.renamed_to}>{row.renamed_to}</p>
            <p className="text-xs text-muted-foreground/60 truncate">← {row.file.name}</p>
          </>
        ) : (
          <>
            <p className="text-xs text-foreground truncate">{row.file.name}</p>
            <p className="text-xs text-muted-foreground/50">
              {isActive ? STEP_LABEL[row.step] : row.step === "error" ? (row.error || "Error") : formatBytes(row.file.size)}
            </p>
          </>
        )}
      </div>

      {/* Status / badges */}
      <div className="flex items-center gap-1.5 shrink-0">
        {row.step === "queued" && onRemove && (
          <button onClick={onRemove} className="text-muted-foreground/40 hover:text-muted-foreground p-0.5 rounded">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {row.step === "done" && row.category && (
          <Badge variant="outline" className={`text-xs ${CATEGORY_COLORS[row.category] || CATEGORY_COLORS.other}`}>
            {CATEGORY_LABELS[row.category] || row.category}
          </Badge>
        )}
        {row.step === "done" && row.method && (
          <Badge variant="outline" className={`text-xs font-mono ${
            row.method === "ocr" ? "bg-emerald-500/10 text-emerald-700 border-emerald-200"
            : row.method === "ai" ? "bg-violet-500/10 text-violet-700 border-violet-200"
            : "bg-amber-500/10 text-amber-700 border-amber-200"
          }`}>
            {row.method === "ocr" ? "OCR" : row.method === "ai" ? "AI" : "OCR+AI"}
          </Badge>
        )}
        {row.step === "done" && row.confidence != null && (
          <span className="text-xs text-muted-foreground/40">{Math.round(row.confidence * 100)}%</span>
        )}
        {(row.step === "uploading" || row.step === "ocr" || row.step === "classifying") && (
          <span className="text-xs text-muted-foreground">{STEP_LABEL[row.step]}</span>
        )}
      </div>
    </div>
  );
}

// ── File Tree (done view) ─────────────────────────────────────────────────────

function FileTreeView({ files }: { files: SortedFile[] }) {
  const tree: Record<string, Record<string, SortedFile[]>> = {};
  for (const f of files) {
    const b = f.building_slug || "deal-wide";
    if (!tree[b]) tree[b] = {};
    if (!tree[b][f.category]) tree[b][f.category] = [];
    tree[b][f.category].push(f);
  }
  return (
    <div className="space-y-3">
      {Object.entries(tree).map(([building, cats]) => (
        <div key={building} className="vault-card overflow-hidden">
          <div className="flex items-center gap-2 p-3 bg-muted/40 border-b border-border">
            <Building2 className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold font-mono">{building}</span>
          </div>
          <div className="p-2 space-y-2">
            {Object.entries(cats).map(([cat, catFiles]) => (
              <div key={cat}>
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <FolderIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{CATEGORY_LABELS[cat] || cat}</span>
                  <span className="text-xs text-muted-foreground/50">({catFiles.length})</span>
                </div>
                <div className="ml-4 space-y-0.5">
                  {catFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/30">
                      <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                      <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono truncate">{f.renamed_to}</p>
                        <p className="text-xs text-muted-foreground/50 truncate">← {f.original_name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DdFileSorter() {
  const { session } = useAuth();
  const [phase, setPhase] = useState<Phase>("setup");
  const [errorMsg, setErrorMsg] = useState("");

  // Setup
  const [dealName, setDealName] = useState("");

  // File rows — shown immediately after selection
  const [fileRows, setFileRows] = useState<FileRow[]>([]);

  // Address
  const [detectingAddress, setDetectingAddress] = useState(false);
  const [detectedAddress, setDetectedAddress] = useState<{ address: string; city: string; state: string; postal_code: string; confidence: number } | null>(null);
  const [editingAddress, setEditingAddress] = useState(false);
  const [confirmedAddress, setConfirmedAddress] = useState({ address: "", city: "", state: "", postal_code: "" });

  // Processing
  const [processedCount, setProcessedCount] = useState(0);
  const [sortedFiles, setSortedFiles] = useState<SortedFile[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dd-sort`;
  const authHeader = { Authorization: `Bearer ${session?.access_token}` };

  // ── Helpers ────────────────────────────────────────────────────────────────

  const updateRow = (id: string, updates: Partial<FileRow>) =>
    setFileRows(rows => rows.map(r => r.id === id ? { ...r, ...updates } : r));

  const buildRows = (files: File[]): FileRow[] =>
    files.map(f => ({ id: crypto.randomUUID(), file: f, step: "queued" as FileStep }));

  // ── File selection → immediately show files ────────────────────────────────

  const handleFilesAdded = (files: File[]) => {
    if (!files.length) return;
    const rows = buildRows(files);
    setFileRows(rows);
    setPhase("files-ready");
    // Auto-detect address from first PDF in the background
    const firstPdf = files.find(f => f.name.toLowerCase().endsWith(".pdf")) ?? files[0];
    detectAddressInBackground(firstPdf);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    handleFilesAdded(files);
  };

  const handleFolderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    handleFilesAdded(files);
  };

  // ── Address detection (background, non-blocking) ───────────────────────────

  const detectAddressInBackground = async (file: File) => {
    setDetectingAddress(true);
    try {
      const fd = new FormData();
      fd.append("action", "detect_address");
      fd.append("files", file, file.webkitRelativePath || file.name);
      const resp = await fetch(baseUrl, { method: "POST", headers: authHeader, body: fd });
      if (resp.ok) {
        const data = await resp.json();
        setDetectedAddress(data);
        setConfirmedAddress({ address: data.address, city: data.city, state: data.state, postal_code: data.postal_code });
      }
    } catch { /* silently fail — user can enter manually */ }
    finally { setDetectingAddress(false); }
  };

  // ── Remove a queued file ───────────────────────────────────────────────────

  const removeFile = (id: string) => {
    setFileRows(rows => {
      const next = rows.filter(r => r.id !== id);
      if (next.length === 0) reset();
      return next;
    });
  };

  // ── Confirm address + start processing ────────────────────────────────────

  const startProcessing = async () => {
    if (!confirmedAddress.address.trim()) {
      toast.error("Please enter the property address first.");
      return;
    }
    if (!dealName.trim()) {
      toast.error("Please enter a deal name first.");
      return;
    }

    const files = fileRows.map(r => r.file);
    setPhase("processing");

    try {
      // Create deal + package
      const fd = new FormData();
      fd.append("action", "create_deal");
      fd.append("deal_name", dealName);
      fd.append("property_address", confirmedAddress.address);
      fd.append("address_city", confirmedAddress.city);
      fd.append("address_state", confirmedAddress.state);
      fd.append("address_postal_code", confirmedAddress.postal_code);
      fd.append("total_files", String(files.length));
      if (session?.user?.id) fd.append("user_id", session.user.id);

      const dealResp = await fetch(baseUrl, { method: "POST", headers: authHeader, body: fd });
      if (!dealResp.ok) {
        const e = await dealResp.json();
        throw new Error(e.error || "Failed to create deal");
      }
      const { deal_id, package_id, deal_slug, storage_prefix } = await dealResp.json();

      // Process each file one at a time
      const results: SortedFile[] = [];
      let doneCount = 0;

      for (const row of fileRows) {
        updateRow(row.id, { step: "uploading" });
        await new Promise(r => setTimeout(r, 50));
        updateRow(row.id, { step: "ocr" });

        const ffd = new FormData();
        ffd.append("action", "process_file");
        ffd.append("deal_id", deal_id);
        ffd.append("package_id", package_id);
        ffd.append("deal_slug", deal_slug);
        ffd.append("storage_prefix", storage_prefix);
        ffd.append("property_address", confirmedAddress.address);
        ffd.append("file", row.file, row.file.webkitRelativePath || row.file.name);

        try {
          const classifyTimer = setTimeout(() => updateRow(row.id, { step: "classifying" }), 600);
          const resp = await fetch(baseUrl, { method: "POST", headers: authHeader, body: ffd });
          clearTimeout(classifyTimer);

          if (!resp.ok) {
            const e = await resp.json();
            updateRow(row.id, { step: "error", error: e.error || "Processing failed" });
          } else {
            const data = await resp.json();
            updateRow(row.id, {
              step: "done",
              renamed_to: data.renamed_to,
              category: data.category,
              building_slug: data.building_slug,
              unit: data.unit,
              confidence: data.confidence,
              method: data.method,
            });
            results.push({ ...data, original_name: row.file.name, storage_path: data.storage_path });
          }
        } catch (fileErr: any) {
          updateRow(row.id, { step: "error", error: fileErr.message });
        }

        doneCount++;
        setProcessedCount(doneCount);
      }

      setSortedFiles(results);

      // Finalize
      const ffin = new FormData();
      ffin.append("action", "finalize_package");
      ffin.append("package_id", package_id);
      ffin.append("processed_files", String(doneCount));
      await fetch(baseUrl, { method: "POST", headers: authHeader, body: ffin });

      setPhase("done");
      toast.success(`${results.length} file${results.length !== 1 ? "s" : ""} sorted and stored`);
    } catch (err: any) {
      setErrorMsg(err.message);
      setPhase("error");
    }
  };

  // ── Reset ──────────────────────────────────────────────────────────────────

  const reset = () => {
    setPhase("setup");
    setErrorMsg("");
    setDealName("");
    setFileRows([]);
    setDetectedAddress(null);
    setDetectingAddress(false);
    setEditingAddress(false);
    setConfirmedAddress({ address: "", city: "", state: "", postal_code: "" });
    setProcessedCount(0);
    setSortedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const totalFiles = fileRows.length;
  const progress = totalFiles > 0 ? Math.round((processedCount / totalFiles) * 100) : 0;
  const isProcessing = phase === "processing";
  const addressReady = confirmedAddress.address.trim().length > 0;

  const categorySummary = sortedFiles.reduce<Record<string, number>>((acc, f) => {
    acc[f.category] = (acc[f.category] || 0) + 1;
    return acc;
  }, {});

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <FolderSymlink className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">DD File Sorter</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Upload a DD folder or files — each is scanned, renamed, and sorted into the correct category.
        </p>
      </div>

      {/* ── Setup: Deal name + file picker ──────────────────────────────────── */}
      <div className="vault-card p-5 space-y-4">
        {/* Deal name */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Deal Name</label>
          <Input
            placeholder="e.g. Vanowen Portfolio"
            value={dealName}
            onChange={(e) => setDealName(e.target.value)}
            disabled={isProcessing || phase === "done"}
          />
        </div>

        {/* File pickers — always visible in setup/files-ready */}
        {(phase === "setup" || phase === "files-ready") && (
          <div className="grid grid-cols-2 gap-3">
            <label className="group cursor-pointer">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc,.xlsx,.xls"
                multiple
                className="hidden"
                onChange={handleFileInput}
              />
              <div className="border-2 border-dashed border-border group-hover:border-primary/50 rounded-lg p-4 text-center transition-colors">
                <FileArchive className="h-6 w-6 text-muted-foreground group-hover:text-primary mx-auto mb-1.5 transition-colors" />
                <p className="text-sm font-medium text-foreground">Select Files</p>
                <p className="text-xs text-muted-foreground mt-0.5">PDFs, Word, Excel</p>
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
                onChange={handleFolderInput}
              />
              <div className="border-2 border-dashed border-border group-hover:border-primary/50 rounded-lg p-4 text-center transition-colors">
                <FolderOpen className="h-6 w-6 text-muted-foreground group-hover:text-primary mx-auto mb-1.5 transition-colors" />
                <p className="text-sm font-medium text-foreground">Select Folder</p>
                <p className="text-xs text-muted-foreground mt-0.5">Entire DD folder</p>
              </div>
            </label>
          </div>
        )}
      </div>

      {/* ── File list — shown immediately after selection ────────────────────── */}
      {fileRows.length > 0 && (
        <div className="vault-card overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Files</span>
              <Badge variant="secondary" className="text-xs">{totalFiles}</Badge>
            </div>
            {isProcessing && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{processedCount} / {totalFiles}</span>
                <Progress value={progress} className="w-24 h-1.5" />
              </div>
            )}
            {phase === "done" && (
              <span className="text-xs text-primary font-medium flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> All done
              </span>
            )}
          </div>

          {/* Rows */}
          <div>
            {fileRows.map(row => (
              <FileStatusRow
                key={row.id}
                row={row}
                onRemove={row.step === "queued" && !isProcessing ? () => removeFile(row.id) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Address panel — appears below files once detected/entered ───────── */}
      {(phase === "files-ready" || phase === "confirm-address" || phase === "processing" || phase === "done") && fileRows.length > 0 && (
        <div className="vault-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Property Address</h2>
            {detectingAddress && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Auto-detecting…
              </span>
            )}
            {!detectingAddress && detectedAddress && !editingAddress && addressReady && (
              <button
                onClick={() => setEditingAddress(true)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Edit2 className="h-3 w-3" /> Edit
              </button>
            )}
          </div>

          {/* Show detected address as a filled-in suggestion */}
          {!editingAddress && addressReady ? (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/15">
              <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{confirmedAddress.address}</p>
                {confirmedAddress.city && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {confirmedAddress.city}, {confirmedAddress.state} {confirmedAddress.postal_code}
                  </p>
                )}
                {detectedAddress?.confidence != null && (
                  <p className="text-xs text-muted-foreground/50 mt-0.5">
                    {detectedAddress.confidence >= 0.7 ? "Detected automatically" : "Low confidence — please verify"}
                    {" "}· {Math.round(detectedAddress.confidence * 100)}%
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <AddressAutocomplete
                value={confirmedAddress.address}
                onChange={(v) => setConfirmedAddress(p => ({ ...p, address: v }))}
                onSelect={(r) => { setConfirmedAddress(r); setEditingAddress(false); }}
              />
              <div className="grid grid-cols-3 gap-2">
                <Input value={confirmedAddress.city} onChange={(e) => setConfirmedAddress(p => ({ ...p, city: e.target.value }))} placeholder="City" />
                <Input value={confirmedAddress.state} onChange={(e) => setConfirmedAddress(p => ({ ...p, state: e.target.value }))} placeholder="State" maxLength={2} className="uppercase" />
                <Input value={confirmedAddress.postal_code} onChange={(e) => setConfirmedAddress(p => ({ ...p, postal_code: e.target.value }))} placeholder="ZIP" maxLength={5} />
              </div>
              {editingAddress && (
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEditingAddress(false)}>Done</Button>
              )}
            </div>
          )}

          {/* Sort button */}
          {!isProcessing && phase !== "done" && (
            <Button
              onClick={startProcessing}
              disabled={!addressReady || !dealName.trim() || fileRows.length === 0}
              className="w-full gap-2"
            >
              Sort {totalFiles} File{totalFiles !== 1 ? "s" : ""} <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────────────── */}
      {phase === "error" && (
        <div className="vault-card p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-destructive">Something went wrong</p>
            <p className="text-xs text-muted-foreground mt-0.5">{errorMsg}</p>
          </div>
          <Button size="sm" variant="outline" onClick={reset} className="shrink-0 h-8 text-xs">Start Over</Button>
        </div>
      )}

      {/* ── Done: summary + tree ──────────────────────────────────────────────── */}
      {phase === "done" && sortedFiles.length > 0 && (
        <div className="space-y-4">
          <div className="vault-card p-4">
            <div className="flex items-center gap-3 mb-3">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold">{dealName}</p>
                <p className="text-xs text-muted-foreground">{confirmedAddress.address}</p>
              </div>
              <Button size="sm" variant="outline" onClick={reset} className="h-8 text-xs gap-1.5">
                <Plus className="h-3.5 w-3.5" /> New Package
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(categorySummary).map(([cat, count]) => (
                <Badge key={cat} variant="outline" className={`text-xs ${CATEGORY_COLORS[cat] || CATEGORY_COLORS.other}`}>
                  {CATEGORY_LABELS[cat] || cat}: {count}
                </Badge>
              ))}
              <Badge variant="secondary" className="text-xs">{sortedFiles.length} total</Badge>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">Sorted File Tree</p>
            <FileTreeView files={sortedFiles} />
          </div>
        </div>
      )}
    </div>
  );
}
