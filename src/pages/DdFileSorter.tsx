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
  Upload,
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
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AddressSuggestion {
  address: string;
  city: string;
  state: string;
  postal_code: string;
  confidence: number;
}

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
  id: string; // local uuid
  file: File;
  step: FileStep;
  error?: string;
  // result fields
  original_name?: string;
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

type Phase = "setup" | "confirm-address" | "processing" | "done" | "error";

const CATEGORY_LABELS: Record<string, string> = {
  lease: "Lease",
  "rent-roll": "Rent Roll",
  notice: "Notice",
  estoppel: "Estoppel",
  other: "Other",
};

const CATEGORY_COLORS: Record<string, string> = {
  lease: "bg-blue-500/10 text-blue-600 border-blue-200",
  "rent-roll": "bg-emerald-500/10 text-emerald-600 border-emerald-200",
  notice: "bg-amber-500/10 text-amber-600 border-amber-200",
  estoppel: "bg-purple-500/10 text-purple-600 border-purple-200",
  other: "bg-muted text-muted-foreground border-border",
};

const STEP_LABELS: Record<FileStep, string> = {
  queued: "Queued",
  uploading: "Uploading…",
  ocr: "Scanning…",
  classifying: "Classifying…",
  done: "Done",
  error: "Error",
};

// ── Address Autocomplete ──────────────────────────────────────────────────────

function AddressAutocomplete({
  value,
  onChange,
  onSelect,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (result: { address: string; city: string; state: string; postal_code: string }) => void;
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
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (v: string) => {
    onChange(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(v), 400);
  };

  const pick = (r: NominatimResult) => {
    const a = r.address;
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    const city = a.city || a.town || a.village || "";
    onChange(street);
    onSelect({ address: street, city, state: a.state || "", postal_code: a.postcode || "" });
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
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
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

function FileStatusRow({ row }: { row: FileRow }) {
  const isActive = row.step === "uploading" || row.step === "ocr" || row.step === "classifying";

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-0 transition-colors ${row.step === "done" ? "bg-muted/20" : ""}`}>
      {/* Step icon */}
      <div className="shrink-0 w-7 h-7 flex items-center justify-center">
        {row.step === "queued" && <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />}
        {row.step === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        {row.step === "ocr" && <ScanLine className="h-4 w-4 animate-pulse text-amber-500" />}
        {row.step === "classifying" && <Cpu className="h-4 w-4 animate-pulse text-violet-500" />}
        {row.step === "done" && <CheckCircle2 className="h-4 w-4 text-primary" />}
        {row.step === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        {row.step === "done" ? (
          <>
            <p className="text-xs font-mono text-foreground truncate" title={row.renamed_to}>{row.renamed_to}</p>
            <p className="text-xs text-muted-foreground/60 truncate" title={row.file.name}>← {row.file.name}</p>
          </>
        ) : (
          <>
            <p className="text-xs text-foreground truncate">{row.file.name}</p>
            {isActive && <p className="text-xs text-muted-foreground">{STEP_LABELS[row.step]}</p>}
            {row.step === "queued" && <p className="text-xs text-muted-foreground/50">Waiting…</p>}
            {row.step === "error" && <p className="text-xs text-destructive truncate">{row.error}</p>}
          </>
        )}
      </div>

      {/* Category badge */}
      {row.step === "done" && row.category && (
        <Badge variant="outline" className={`text-xs shrink-0 ${CATEGORY_COLORS[row.category] || CATEGORY_COLORS.other}`}>
          {CATEGORY_LABELS[row.category] || row.category}
        </Badge>
      )}

      {/* Method badge */}
      {row.step === "done" && row.method && (
        <Badge
          variant="outline"
          className={`text-xs shrink-0 font-mono ${
            row.method === "ocr" ? "bg-emerald-500/10 text-emerald-600 border-emerald-200"
            : row.method === "ai" ? "bg-violet-500/10 text-violet-600 border-violet-200"
            : "bg-amber-500/10 text-amber-600 border-amber-200"
          }`}
        >
          {row.method === "ocr" ? "OCR" : row.method === "ai" ? "AI" : "OCR+AI"}
        </Badge>
      )}

      {/* Confidence */}
      {row.step === "done" && row.confidence != null && (
        <span className="text-xs text-muted-foreground/50 shrink-0">{Math.round(row.confidence * 100)}%</span>
      )}
    </div>
  );
}

// ── File Tree (results view) ──────────────────────────────────────────────────

function FileTreeView({ files }: { files: SortedFile[] }) {
  const tree: Record<string, Record<string, SortedFile[]>> = {};
  for (const f of files) {
    const b = f.building_slug || "deal-wide";
    if (!tree[b]) tree[b] = {};
    const c = f.category || "other";
    if (!tree[b][c]) tree[b][c] = [];
    tree[b][c].push(f);
  }

  return (
    <div className="space-y-3">
      {Object.entries(tree).map(([building, cats]) => (
        <div key={building} className="vault-card overflow-hidden">
          <div className="flex items-center gap-2 p-3 bg-muted/40 border-b border-border">
            <Building2 className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground font-mono">{building}</span>
          </div>
          <div className="p-2 space-y-2">
            {Object.entries(cats).map(([cat, catFiles]) => (
              <div key={cat}>
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <FolderIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {CATEGORY_LABELS[cat] || cat}
                  </span>
                  <span className="text-xs text-muted-foreground/60">({catFiles.length})</span>
                </div>
                <div className="ml-4 space-y-1">
                  {catFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/30 group">
                      <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                      <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground font-mono truncate">{f.renamed_to}</p>
                        <p className="text-xs text-muted-foreground/60 truncate">← {f.original_name}</p>
                      </div>
                      <Badge variant="outline" className={`text-xs shrink-0 ${CATEGORY_COLORS[f.category] || CATEGORY_COLORS.other}`}>
                        {CATEGORY_LABELS[f.category] || f.category}
                      </Badge>
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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectionLabel, setSelectionLabel] = useState("");

  // Address
  const [detectedAddress, setDetectedAddress] = useState<AddressSuggestion | null>(null);
  const [editingAddress, setEditingAddress] = useState(false);
  const [detectingAddress, setDetectingAddress] = useState(false);
  const [confirmedAddress, setConfirmedAddress] = useState({ address: "", city: "", state: "", postal_code: "" });

  // Per-file processing
  const [fileRows, setFileRows] = useState<FileRow[]>([]);
  const [processedCount, setProcessedCount] = useState(0);
  const [sortedFiles, setSortedFiles] = useState<SortedFile[]>([]);
  const [dealId, setDealId] = useState("");
  const [packageId, setPackageId] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dd-sort`;
  const authHeader = { Authorization: `Bearer ${session?.access_token}` };

  // ── File selection ─────────────────────────────────────────────────────────

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFiles([file]);
    setSelectionLabel(file.name);
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const folderName = list[0]?.webkitRelativePath?.split("/")[0] || "folder";
    setSelectedFiles(list);
    setSelectionLabel(`${folderName}/ (${list.length} files)`);
  };

  const reset = () => {
    setPhase("setup");
    setErrorMsg("");
    setSelectedFiles([]);
    setSelectionLabel("");
    setDetectedAddress(null);
    setEditingAddress(false);
    setDetectingAddress(false);
    setConfirmedAddress({ address: "", city: "", state: "", postal_code: "" });
    setFileRows([]);
    setProcessedCount(0);
    setSortedFiles([]);
    setDealId("");
    setPackageId("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  // ── Step 1: Detect address from first file ─────────────────────────────────

  const analyzeAddress = async () => {
    if (!selectedFiles.length || !dealName.trim()) return;
    setDetectingAddress(true);
    try {
      const fd = new FormData();
      fd.append("action", "detect_address");
      // Use first PDF-ish file for address detection
      const firstPdf = selectedFiles.find(f => f.name.toLowerCase().endsWith(".pdf")) ?? selectedFiles[0];
      fd.append("files", firstPdf, firstPdf.webkitRelativePath || firstPdf.name);

      const resp = await fetch(baseUrl, { method: "POST", headers: authHeader, body: fd });
      if (!resp.ok) {
        const e = await resp.json();
        throw new Error(e.error || "Address detection failed");
      }
      const data: AddressSuggestion = await resp.json();
      setDetectedAddress(data);
      setConfirmedAddress({ address: data.address, city: data.city, state: data.state, postal_code: data.postal_code });
      setPhase("confirm-address");
    } catch (err: any) {
      setErrorMsg(err.message);
      setPhase("error");
    } finally {
      setDetectingAddress(false);
    }
  };

  // ── Step 2: Create deal, then process files one-by-one ────────────────────

  const updateRow = (id: string, updates: Partial<FileRow>) => {
    setFileRows(rows => rows.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const startProcessing = async () => {
    if (!confirmedAddress.address.trim()) {
      toast.error("Please confirm the property address first.");
      return;
    }

    // Build initial file rows (queued)
    const rows: FileRow[] = selectedFiles.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      step: "queued" as FileStep,
    }));
    setFileRows(rows);
    setPhase("processing");

    try {
      // 1. Create deal + package
      const fd = new FormData();
      fd.append("action", "create_deal");
      fd.append("deal_name", dealName);
      fd.append("property_address", confirmedAddress.address);
      fd.append("address_city", confirmedAddress.city);
      fd.append("address_state", confirmedAddress.state);
      fd.append("address_postal_code", confirmedAddress.postal_code);
      fd.append("total_files", String(selectedFiles.length));
      if (session?.user?.id) fd.append("user_id", session.user.id);

      const dealResp = await fetch(baseUrl, { method: "POST", headers: authHeader, body: fd });
      if (!dealResp.ok) {
        const e = await dealResp.json();
        throw new Error(e.error || "Failed to create deal");
      }
      const { deal_id, package_id, deal_slug, storage_prefix } = await dealResp.json();
      setDealId(deal_id);
      setPackageId(package_id);

      // 2. Process each file one at a time
      const results: SortedFile[] = [];
      let doneCount = 0;

      for (const row of rows) {
        // uploading → ocr → classifying → done
        updateRow(row.id, { step: "uploading" });
        await new Promise(r => setTimeout(r, 60)); // let UI re-render

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
          // Show classifying step visually
          const classifyTimeout = setTimeout(() => updateRow(row.id, { step: "classifying" }), 800);
          const resp = await fetch(baseUrl, { method: "POST", headers: authHeader, body: ffd });
          clearTimeout(classifyTimeout);

          if (!resp.ok) {
            const e = await resp.json();
            updateRow(row.id, { step: "error", error: e.error || "Processing failed" });
          } else {
            const data = await resp.json();
            updateRow(row.id, {
              step: "done",
              original_name: data.original_name,
              renamed_to: data.renamed_to,
              category: data.category,
              building_slug: data.building_slug,
              unit: data.unit,
              confidence: data.confidence,
              method: data.method,
            });
            results.push({ ...data, storage_path: data.storage_path });
          }
        } catch (fileErr: any) {
          updateRow(row.id, { step: "error", error: fileErr.message });
        }

        doneCount++;
        setProcessedCount(doneCount);
      }

      setSortedFiles(results);

      // 3. Finalize package
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

  // ── Computed ───────────────────────────────────────────────────────────────

  const totalFiles = selectedFiles.length;
  const progress = totalFiles > 0 ? Math.round((processedCount / totalFiles) * 100) : 0;
  const isProcessing = phase === "processing";

  const categorySummary = sortedFiles.reduce<Record<string, number>>((acc, f) => {
    acc[f.category] = (acc[f.category] || 0) + 1;
    return acc;
  }, {});

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <FolderSymlink className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Due Diligence — File Sorter</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Upload a DD folder or individual files. Each file is scanned, classified, renamed, and sorted into the correct folder — one at a time.
        </p>
      </div>

      {/* ── Step 1: Deal setup ──────────────────────────────────────────────── */}
      <div className="vault-card p-6 space-y-5">
        <h2 className="text-sm font-semibold text-foreground">1 · Deal Setup</h2>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Deal Name</label>
          <Input
            placeholder="e.g. Vanowen Portfolio Acquisition"
            value={dealName}
            onChange={(e) => setDealName(e.target.value)}
            disabled={phase !== "setup" && phase !== "confirm-address"}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">DD Package</label>
          <div className="grid grid-cols-2 gap-3">
            <label className={`group cursor-pointer ${phase !== "setup" ? "opacity-50 pointer-events-none" : ""}`}>
              <input ref={fileInputRef} type="file" accept=".zip,.pdf,.docx" multiple className="hidden" onChange={handleFileSelect} />
              <div className="border-2 border-dashed border-border group-hover:border-primary/50 rounded-lg p-5 text-center transition-colors">
                <FileArchive className="h-7 w-7 text-muted-foreground group-hover:text-primary mx-auto mb-2 transition-colors" />
                <p className="text-sm font-medium text-foreground">Upload Files</p>
                <p className="text-xs text-muted-foreground mt-0.5">Select individual files</p>
              </div>
            </label>
            <label className={`group cursor-pointer ${phase !== "setup" ? "opacity-50 pointer-events-none" : ""}`}>
              <input
                ref={folderInputRef}
                type="file"
                // @ts-ignore
                webkitdirectory="true"
                multiple
                className="hidden"
                onChange={handleFolderSelect}
              />
              <div className="border-2 border-dashed border-border group-hover:border-primary/50 rounded-lg p-5 text-center transition-colors">
                <FolderOpen className="h-7 w-7 text-muted-foreground group-hover:text-primary mx-auto mb-2 transition-colors" />
                <p className="text-sm font-medium text-foreground">Upload Folder</p>
                <p className="text-xs text-muted-foreground mt-0.5">Select entire folder</p>
              </div>
            </label>
          </div>
        </div>

        {selectionLabel && phase === "setup" && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm text-foreground flex-1 truncate">{selectionLabel}</span>
            <button onClick={reset} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {phase === "setup" && (
          <Button
            onClick={analyzeAddress}
            disabled={!selectedFiles.length || !dealName.trim() || detectingAddress}
            className="gap-2"
          >
            {detectingAddress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {detectingAddress ? "Detecting address…" : "Analyze Package"}
          </Button>
        )}
      </div>

      {/* ── Step 2: Address confirmation ────────────────────────────────────── */}
      {(phase === "confirm-address" || phase === "processing" || phase === "done") && (
        <div className="vault-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">2 · Confirm Property Address</h2>

          {detectedAddress && !editingAddress ? (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/20">
              <div className="p-1.5 rounded-lg bg-primary/10 shrink-0 mt-0.5">
                <MapPin className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">
                  Detected address
                  {detectedAddress.confidence >= 0.7 && (
                    <span className="ml-2 text-primary/60">({Math.round(detectedAddress.confidence * 100)}% confident)</span>
                  )}
                </p>
                <p className="text-sm font-medium text-foreground">{confirmedAddress.address}</p>
                {confirmedAddress.city && (
                  <p className="text-sm text-muted-foreground">{confirmedAddress.city}, {confirmedAddress.state} {confirmedAddress.postal_code}</p>
                )}
                {phase === "confirm-address" && (
                  <div className="flex items-center gap-2 mt-3">
                    <Button size="sm" className="h-7 text-xs gap-1.5" onClick={startProcessing}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Confirm & Sort Files
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setEditingAddress(true)}>
                      <Edit2 className="h-3.5 w-3.5" /> Edit Address
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : phase === "confirm-address" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Street Address</label>
                <AddressAutocomplete
                  value={confirmedAddress.address}
                  onChange={(v) => setConfirmedAddress(p => ({ ...p, address: v }))}
                  onSelect={(r) => setConfirmedAddress(r)}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1 space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">City</label>
                  <Input value={confirmedAddress.city} onChange={(e) => setConfirmedAddress(p => ({ ...p, city: e.target.value }))} placeholder="City" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">State</label>
                  <Input value={confirmedAddress.state} onChange={(e) => setConfirmedAddress(p => ({ ...p, state: e.target.value }))} placeholder="CA" maxLength={2} className="uppercase" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">ZIP</label>
                  <Input value={confirmedAddress.postal_code} onChange={(e) => setConfirmedAddress(p => ({ ...p, postal_code: e.target.value }))} placeholder="90000" maxLength={5} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={startProcessing}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Confirm & Sort Files
                </Button>
                {detectedAddress && (
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditingAddress(false)}>Cancel</Button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ── Step 3: Per-file processing pipeline ────────────────────────────── */}
      {(phase === "processing" || phase === "done") && fileRows.length > 0 && (
        <div className="vault-card overflow-hidden">
          {/* Header + progress */}
          <div className="p-4 border-b border-border bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-foreground">3 · Processing Files</h2>
              <span className="text-xs text-muted-foreground">
                {processedCount} / {totalFiles} files
              </span>
            </div>
            <Progress value={isProcessing ? progress : 100} className="h-1.5" />
          </div>

          {/* File rows */}
          <div>
            {fileRows.map(row => (
              <FileStatusRow key={row.id} row={row} />
            ))}
          </div>
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

      {/* ── Done: Summary + file tree ─────────────────────────────────────────── */}
      {phase === "done" && (
        <div className="space-y-4">
          <div className="vault-card p-4">
            <div className="flex items-center gap-3 mb-3">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">{dealName}</p>
                <p className="text-xs text-muted-foreground">{confirmedAddress.address}</p>
              </div>
              <Button size="sm" variant="outline" onClick={reset} className="h-8 text-xs gap-1.5">
                <Plus className="h-3.5 w-3.5" /> New Package
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
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
