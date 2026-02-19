import { useState, useRef, useCallback, forwardRef } from "react";
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

interface ProcessResult {
  deal_id: string;
  package_id: string;
  deal_name: string;
  property_address: string;
  total_files: number;
  files: SortedFile[];
}

type Phase = "setup" | "detecting" | "confirm-address" | "processing" | "done" | "error";

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
    const state = a.state || "";
    const postal_code = a.postcode || "";
    onChange(street);
    onSelect({ address: street, city, state, postal_code });
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

// ── File Tree View ────────────────────────────────────────────────────────────

function FileTreeView({ files }: { files: SortedFile[] }) {
  // Group by building_slug → category → files
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
                        <p className="text-xs text-foreground font-mono truncate" title={f.renamed_to}>
                          {f.renamed_to}
                        </p>
                        <p className="text-xs text-muted-foreground/60 truncate" title={f.original_name}>
                          ← {f.original_name}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-xs shrink-0 ${CATEGORY_COLORS[f.category] || CATEGORY_COLORS.other}`}
                      >
                        {CATEGORY_LABELS[f.category] || f.category}
                      </Badge>
                      {f.method && (
                        <Badge
                          variant="outline"
                          className={`text-xs shrink-0 font-mono ${
                            f.method === "ocr"
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-200"
                              : f.method === "ai"
                              ? "bg-violet-500/10 text-violet-600 border-violet-200"
                              : "bg-amber-500/10 text-amber-600 border-amber-200"
                          }`}
                          title={
                            f.method === "ocr" ? "Classified via OCR — no AI used"
                            : f.method === "ai" ? "Classified via AI (scanned/image PDF)"
                            : "Text extracted via OCR, classified via AI"
                          }
                        >
                          {f.method === "ocr" ? "OCR" : f.method === "ai" ? "AI" : "OCR+AI"}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground/50 shrink-0">
                        {Math.round((f.confidence || 0) * 100)}%
                      </span>
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
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  // Setup fields
  const [dealName, setDealName] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectionLabel, setSelectionLabel] = useState("");

  // Address confirmation state
  const [detectedAddress, setDetectedAddress] = useState<AddressSuggestion | null>(null);
  const [editingAddress, setEditingAddress] = useState(false);
  const [confirmedAddress, setConfirmedAddress] = useState({
    address: "",
    city: "",
    state: "",
    postal_code: "",
  });

  // Result
  const [result, setResult] = useState<ProcessResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFiles([file]);
    setSelectionLabel(file.name);
    (window as any).__ddSortFolderFiles = undefined;
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const folderName = list[0]?.webkitRelativePath?.split("/")[0] || "folder";
    (window as any).__ddSortFolderFiles = list;
    setSelectedFiles(list);
    setSelectionLabel(`${folderName}/ (${list.length} files)`);
  };

  const reset = () => {
    setPhase("setup");
    setProgress(0);
    setErrorMsg("");
    setSelectedFiles([]);
    setSelectionLabel("");
    setDetectedAddress(null);
    setEditingAddress(false);
    setConfirmedAddress({ address: "", city: "", state: "", postal_code: "" });
    setResult(null);
    (window as any).__ddSortFolderFiles = undefined;
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dd-sort`;
  const authHeader = { Authorization: `Bearer ${session?.access_token}` };

  // Phase 1: detect address
  const analyzeFiles = async () => {
    if (!selectedFiles.length || !dealName.trim()) return;
    setPhase("detecting");
    setProgress(20);
    try {
      const fd = new FormData();
      fd.append("action", "detect_address");
      // Send first 3 files
      selectedFiles.slice(0, 3).forEach((f) => fd.append("files", f, f.webkitRelativePath || f.name));

      const resp = await fetch(baseUrl, { method: "POST", headers: authHeader, body: fd });
      setProgress(60);
      if (!resp.ok) {
        const e = await resp.json();
        throw new Error(e.error || "Address detection failed");
      }
      const data: AddressSuggestion = await resp.json();
      setDetectedAddress(data);
      setConfirmedAddress({
        address: data.address,
        city: data.city,
        state: data.state,
        postal_code: data.postal_code,
      });
      setProgress(100);
      setPhase("confirm-address");
    } catch (err: any) {
      setErrorMsg(err.message);
      setPhase("error");
    }
  };

  // Phase 2: process all files
  const processFiles = async () => {
    if (!confirmedAddress.address.trim()) {
      toast.error("Please confirm the property address first.");
      return;
    }
    setPhase("processing");
    setProgress(10);
    try {
      const fd = new FormData();
      fd.append("action", "process");
      fd.append("deal_name", dealName);
      fd.append("property_address", confirmedAddress.address);
      fd.append("address_city", confirmedAddress.city);
      fd.append("address_state", confirmedAddress.state);
      fd.append("address_postal_code", confirmedAddress.postal_code);
      if (session?.user?.id) fd.append("user_id", session.user.id);

      selectedFiles.forEach((f) => fd.append("files", f, f.webkitRelativePath || f.name));

      setProgress(30);
      const resp = await fetch(baseUrl, { method: "POST", headers: authHeader, body: fd });
      setProgress(80);

      if (!resp.ok) {
        const e = await resp.json();
        throw new Error(e.error || "Processing failed");
      }
      const data: ProcessResult = await resp.json();
      setResult(data);
      setProgress(100);
      setPhase("done");
      toast.success(`${data.total_files} file${data.total_files !== 1 ? "s" : ""} sorted and stored`);
    } catch (err: any) {
      setErrorMsg(err.message);
      setPhase("error");
    }
  };

  // Category summary for result
  const categorySummary = result
    ? result.files.reduce<Record<string, number>>((acc, f) => {
        acc[f.category] = (acc[f.category] || 0) + 1;
        return acc;
      }, {})
    : {};

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <FolderIcon className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Due Diligence — File Sorter</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Upload a DD folder or ZIP. Scans the property address using OCR (no AI for text-based PDFs), renames every file using a standardized convention, and sorts them into category subfolders.
        </p>
      </div>

      {/* ── Step 1: Deal name + file selection ─────────────────────────────── */}
      <div className="vault-card p-6 space-y-5">
        <h2 className="text-sm font-semibold text-foreground">1 · Deal Setup</h2>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Deal Name</label>
          <Input
            placeholder="e.g. Vanowen Portfolio Acquisition"
            value={dealName}
            onChange={(e) => setDealName(e.target.value)}
            disabled={phase !== "setup"}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">DD Package</label>
          <div className="grid grid-cols-2 gap-3">
            <label className={`group cursor-pointer ${phase !== "setup" ? "opacity-50 pointer-events-none" : ""}`}>
              <input ref={fileInputRef} type="file" accept=".zip,.rar,.tar,.gz" className="hidden" onChange={handleFileSelect} />
              <div className="border-2 border-dashed border-border group-hover:border-primary/50 rounded-lg p-5 text-center transition-colors">
                <FileArchive className="h-7 w-7 text-muted-foreground group-hover:text-primary mx-auto mb-2 transition-colors" />
                <p className="text-sm font-medium text-foreground">Upload ZIP</p>
                <p className="text-xs text-muted-foreground mt-0.5">Zipped DD package</p>
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
                <p className="text-xs text-muted-foreground mt-0.5">Select folder directly</p>
              </div>
            </label>
          </div>
        </div>

        {selectionLabel && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm text-foreground flex-1 truncate">{selectionLabel}</span>
            {phase === "setup" && (
              <button onClick={reset} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {(phase === "detecting" || phase === "processing") && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {phase === "detecting" ? "Scanning documents for property address…" : "Renaming and classifying files…"}
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}

        {phase === "setup" && (
          <Button
            onClick={analyzeFiles}
            disabled={!selectedFiles.length || !dealName.trim()}
            className="gap-2"
          >
            <Upload className="h-4 w-4" /> Analyze Package
          </Button>
        )}
      </div>

      {/* ── Step 2: Address confirmation bubble ─────────────────────────────── */}
      {(phase === "confirm-address" || phase === "processing" || phase === "done") && (
        <div className="vault-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">2 · Confirm Property Address</h2>

          {detectedAddress && !editingAddress && (
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
                <p className="text-sm font-medium text-foreground">
                  {confirmedAddress.address}
                </p>
                {confirmedAddress.city && (
                  <p className="text-sm text-muted-foreground">
                    {confirmedAddress.city}, {confirmedAddress.state} {confirmedAddress.postal_code}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-3">
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={processFiles}
                    disabled={phase === "processing" || phase === "done"}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Confirm & Sort Files
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => setEditingAddress(true)}
                    disabled={phase === "processing" || phase === "done"}
                  >
                    <Edit2 className="h-3.5 w-3.5" /> Edit Address
                  </Button>
                </div>
              </div>
            </div>
          )}

          {(editingAddress || !detectedAddress) && phase === "confirm-address" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Street Address</label>
                <AddressAutocomplete
                  value={confirmedAddress.address}
                  onChange={(v) => setConfirmedAddress((prev) => ({ ...prev, address: v }))}
                  onSelect={(r) => setConfirmedAddress(r)}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1 space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">City</label>
                  <Input
                    value={confirmedAddress.city}
                    onChange={(e) => setConfirmedAddress((p) => ({ ...p, city: e.target.value }))}
                    placeholder="City"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">State</label>
                  <Input
                    value={confirmedAddress.state}
                    onChange={(e) => setConfirmedAddress((p) => ({ ...p, state: e.target.value }))}
                    placeholder="CA"
                    maxLength={2}
                    className="uppercase"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">ZIP</label>
                  <Input
                    value={confirmedAddress.postal_code}
                    onChange={(e) => setConfirmedAddress((p) => ({ ...p, postal_code: e.target.value }))}
                    placeholder="90000"
                    maxLength={5}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={processFiles}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Confirm & Sort Files
                </Button>
                {detectedAddress && (
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditingAddress(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* No address detected — show manual form immediately */}
          {!detectedAddress && phase !== "confirm-address" && null}
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {phase === "error" && (
        <div className="vault-card p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-destructive">Something went wrong</p>
            <p className="text-xs text-muted-foreground mt-0.5">{errorMsg}</p>
          </div>
          <Button size="sm" variant="outline" onClick={reset} className="shrink-0 h-8 text-xs">
            Start Over
          </Button>
        </div>
      )}

      {/* ── Step 3: Results ──────────────────────────────────────────────────── */}
      {phase === "done" && result && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="vault-card p-4">
            <div className="flex items-center gap-3 mb-3">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">{result.deal_name}</p>
                <p className="text-xs text-muted-foreground">{result.property_address}</p>
              </div>
              <Button size="sm" variant="outline" onClick={reset} className="h-8 text-xs">
                New Package
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(categorySummary).map(([cat, count]) => (
                <Badge
                  key={cat}
                  variant="outline"
                  className={`text-xs ${CATEGORY_COLORS[cat] || CATEGORY_COLORS.other}`}
                >
                  {CATEGORY_LABELS[cat] || cat}: {count}
                </Badge>
              ))}
              <Badge variant="secondary" className="text-xs">
                {result.total_files} total
              </Badge>
            </div>
          </div>

          {/* File tree */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
              Sorted File Tree
            </p>
            <FileTreeView files={result.files} />
          </div>
        </div>
      )}
    </div>
  );
}
