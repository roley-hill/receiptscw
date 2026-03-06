import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Building2, Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronRight, Upload, FileText, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

type OwnershipEntity = {
  id: string;
  name: string;
  created_at: string;
};

type Property = {
  id: string;
  address: string;
  normalized_address: string;
  ownership_entity_id: string | null;
};

/* ─── CSV Parsing helpers ─── */

/** Strip phone numbers and labels from owner string */
function cleanOwnerName(raw: string): string {
  // Remove "- Phone: ..." or "- Mobile: ..." suffixes
  let name = raw.replace(/\s*-\s*(Phone|Mobile|Fax|Tel):\s*[^\n,]*/gi, "").trim();
  // Remove standalone phone patterns like (310) 954-6655 or +972529691198
  name = name.replace(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "").trim();
  name = name.replace(/\+\d{10,}/g, "").trim();
  // Clean trailing/leading commas and whitespace
  name = name.replace(/^[,\s]+|[,\s]+$/g, "").trim();
  return name;
}

type CsvMapping = {
  propertyAddress: string;
  /** All address variants parsed from the CSV (e.g. both sides of " - ") */
  addressVariants: string[];
  ownerName: string;
  selected: boolean;
};

function parsePropertyDirectoryCsv(text: string): CsvMapping[] {
  const results: CsvMapping[] = [];
  const lines = text.split("\n");

  // Find header line
  let headerIdx = -1;
  let ownerColIdx = -1;
  let propertyColIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.toLowerCase().includes("property") && line.toLowerCase().includes("owner")) {
      headerIdx = i;
      // Parse header columns respecting CSV quoting
      const cols = parseCsvLine(line);
      propertyColIdx = cols.findIndex(c => c.toLowerCase().trim() === "property");
      ownerColIdx = cols.findIndex(c => c.toLowerCase().includes("owner"));
      break;
    }
  }

  if (headerIdx === -1 || ownerColIdx === -1 || propertyColIdx === -1) return results;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.toLowerCase().startsWith("total")) continue;
    // Skip blank lines
    const cols = parseCsvLine(line);
    const rawProperty = cols[propertyColIdx]?.trim() || "";
    const rawOwner = cols[ownerColIdx]?.trim() || "";
    if (!rawProperty || !rawOwner) continue;

    // Extract all address variants from compound names like "14652 Blythe St. (Rear) - 14652-R Blythe Street Panorama City, CA 91402"
    const addressVariants = rawProperty.includes(" - ")
      ? rawProperty.split(" - ").map(s => s.trim()).filter(Boolean)
      : [rawProperty];
    const propertyAddress = addressVariants[0];

    const ownerName = cleanOwnerName(rawOwner);
    if (!ownerName) continue;

    results.push({ propertyAddress, addressVariants, ownerName, selected: true });
  }
  return results;
}

/** Simple CSV line parser that handles quoted fields */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** Normalize an address for fuzzy matching */
function normalizeAddr(s: string): string {
  return s.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
}

/** Check if any of the CSV address variants match a database property address */
function matchesProperty(variants: string[], dbAddress: string): boolean {
  const normalizedDb = normalizeAddr(dbAddress);
  return variants.some(v => {
    const nv = normalizeAddr(v);
    return normalizedDb.startsWith(nv) || nv.startsWith(normalizedDb);
  });
}

export default function OwnershipEntities() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(new Set());
  const [showUnassigned, setShowUnassigned] = useState(false);

  // Bulk upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvMappings, setCsvMappings] = useState<CsvMapping[] | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const { data: entities = [], isLoading: entitiesLoading } = useQuery({
    queryKey: ["ownership_entities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ownership_entities")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as OwnershipEntity[];
    },
  });

  const { data: properties = [] } = useQuery({
    queryKey: ["properties"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .order("address");
      if (error) throw error;
      return data as Property[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("ownership_entities").insert({ name });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ownership_entities"] });
      setNewName("");
      toast({ title: "Entity created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("ownership_entities").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ownership_entities"] });
      setEditingId(null);
      toast({ title: "Entity updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ownership_entities").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ownership_entities"] });
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      toast({ title: "Entity deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: async ({ propertyId, entityId }: { propertyId: string; entityId: string | null }) => {
      const { error } = await supabase
        .from("properties")
        .update({ ownership_entity_id: entityId })
        .eq("id", propertyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      toast({ title: "Property assignment updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleExpand = (id: string) => {
    setExpandedEntities(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  /* ─── CSV file handling ─── */
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const mappings = parsePropertyDirectoryCsv(text);
      if (mappings.length === 0) {
        toast({ title: "No mappings found", description: "Could not parse property-owner mappings from this CSV.", variant: "destructive" });
        return;
      }
      setCsvMappings(mappings);
    };
    reader.readAsText(file);
    // Reset input so same file can be re-selected
    e.target.value = "";
  }, []);

  const toggleCsvRow = (idx: number) => {
    setCsvMappings(prev => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], selected: !next[idx].selected };
      return next;
    });
  };

  const toggleAllCsv = () => {
    setCsvMappings(prev => {
      if (!prev) return prev;
      const allSelected = prev.every(m => m.selected);
      return prev.map(m => ({ ...m, selected: !allSelected }));
    });
  };

  const updateCsvOwnerName = (idx: number, name: string) => {
    setCsvMappings(prev => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], ownerName: name };
      return next;
    });
  };

  const applyBulkMappings = async () => {
    if (!csvMappings) return;
    const selected = csvMappings.filter(m => m.selected && m.ownerName.trim());
    if (selected.length === 0) return;

    setIsApplying(true);
    try {
      // 1. Collect unique owner names
      const uniqueOwners = [...new Set(selected.map(m => m.ownerName.trim()))];

      // 2. Create missing ownership entities
      for (const ownerName of uniqueOwners) {
        const existing = entities.find(e => e.name.toLowerCase() === ownerName.toLowerCase());
        if (!existing) {
          const { error } = await supabase.from("ownership_entities").insert({ name: ownerName });
          if (error && !error.message.includes("duplicate")) throw error;
        }
      }

      // 3. Re-fetch entities to get IDs
      const { data: allEntities } = await supabase
        .from("ownership_entities")
        .select("*")
        .order("name");

      if (!allEntities) throw new Error("Failed to fetch entities");

      // 4. For each mapping, find or create property, then assign entity
      let matched = 0;
      let created = 0;
      for (const mapping of selected) {
        const entity = allEntities.find(e => e.name.toLowerCase() === mapping.ownerName.trim().toLowerCase());
        if (!entity) continue;

        // Try to find matching property using all address variants
        let matchedProperty = properties.find(p => matchesProperty(mapping.addressVariants, p.address));

        if (matchedProperty) {
          const { error } = await supabase
            .from("properties")
            .update({ ownership_entity_id: entity.id })
            .eq("id", matchedProperty.id);
          if (error) console.error("Failed to assign property:", error);
          else matched++;
        } else {
          // Create property with assignment
          const { error } = await supabase
            .from("properties")
            .insert({
              address: mapping.propertyAddress,
              normalized_address: normalizeAddr(mapping.propertyAddress),
              ownership_entity_id: entity.id,
            });
          if (error && !error.message.includes("duplicate")) {
            console.error("Failed to create property:", error);
          } else {
            created++;
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["ownership_entities"] });
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      setCsvMappings(null);
      toast({
        title: "Bulk import complete",
        description: `${matched} properties assigned, ${created} new properties created, ${uniqueOwners.length} entities processed.`,
      });
    } catch (err) {
      toast({ title: "Import failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsApplying(false);
    }
  };

  const unassignedProperties = properties.filter(p => !p.ownership_entity_id);
  const selectedCsvCount = csvMappings?.filter(m => m.selected).length || 0;

  // Group CSV mappings by owner for the confirmation view
  const csvByOwner = csvMappings
    ? csvMappings.reduce<Record<string, { mappings: CsvMapping[]; indices: number[] }>>((acc, m, i) => {
        const key = m.ownerName.trim();
        if (!acc[key]) acc[key] = { mappings: [], indices: [] };
        acc[key].mappings.push(m);
        acc[key].indices.push(i);
        return acc;
      }, {})
    : {};

  if (entitiesLoading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ownership Entities</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage ownership entities and assign properties to them for grouped deposit batching.
          </p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-2" />
            Import Property Directory
          </Button>
        </div>
      </div>

      {/* Create new entity */}
      <div className="vault-card p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">Add Ownership Entity</h2>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) createMutation.mutate(newName.trim());
          }}
        >
          <Input
            placeholder="e.g. Radford & Hill LLC"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="max-w-sm"
          />
          <Button type="submit" size="sm" disabled={!newName.trim() || createMutation.isPending}>
            <Plus className="h-4 w-4 mr-1" />Add
          </Button>
        </form>
      </div>

      {/* Entity list with assigned properties */}
      <div className="space-y-3">
        {entities.map(entity => {
          const entityProperties = properties.filter(p => p.ownership_entity_id === entity.id);
          const isExpanded = expandedEntities.has(entity.id);

          return (
            <div key={entity.id} className="vault-card overflow-hidden">
              <div className="flex items-center gap-3 p-4">
                <button onClick={() => toggleExpand(entity.id)} className="text-muted-foreground hover:text-foreground">
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <Building2 className="h-4 w-4 text-accent shrink-0" />

                {editingId === entity.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      className="max-w-xs h-8 text-sm"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateMutation.mutate({ id: entity.id, name: editingName.trim() })}
                      disabled={!editingName.trim()}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <span className="font-semibold text-sm text-foreground flex-1">{entity.name}</span>
                    <span className="text-xs text-muted-foreground">{entityProperties.length} properties</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setEditingId(entity.id); setEditingName(entity.name); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete "{entity.name}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Properties will be unassigned but not deleted.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMutation.mutate(entity.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}
              </div>

              {isExpanded && (
                <div className="border-t border-border">
                  {entityProperties.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-4">No properties assigned yet.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Property Address</TableHead>
                          <TableHead className="text-xs w-20">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entityProperties.map(p => (
                          <TableRow key={p.id}>
                            <TableCell className="text-sm">{p.address}</TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs text-destructive"
                                onClick={() => assignMutation.mutate({ propertyId: p.id, entityId: null })}
                              >
                                Remove
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Unassigned properties */}
      {unassignedProperties.length > 0 && (
        <div className="vault-card overflow-hidden">
          <button
            onClick={() => setShowUnassigned(!showUnassigned)}
            className="flex items-center gap-3 p-4 w-full text-left"
          >
            {showUnassigned ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <span className="font-semibold text-sm text-muted-foreground">Unassigned Properties</span>
            <span className="text-xs text-muted-foreground ml-auto">{unassignedProperties.length} properties</span>
          </button>

          {showUnassigned && (
            <div className="border-t border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Property Address</TableHead>
                    <TableHead className="text-xs w-60">Assign to Entity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unassignedProperties.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{p.address}</TableCell>
                      <TableCell>
                        <Select
                          onValueChange={(val) => assignMutation.mutate({ propertyId: p.id, entityId: val })}
                        >
                          <SelectTrigger className="h-8 text-xs w-48">
                            <SelectValue placeholder="Select entity..." />
                          </SelectTrigger>
                          <SelectContent>
                            {entities.map(e => (
                              <SelectItem key={e.id} value={e.id} className="text-xs">
                                {e.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {entities.length === 0 && !csvMappings && (
        <div className="vault-card p-8 text-center text-muted-foreground text-sm">
          No ownership entities yet. Create one above or import a property directory CSV.
        </div>
      )}

      {/* ─── CSV Confirmation Dialog ─── */}
      <Dialog open={!!csvMappings} onOpenChange={(open) => { if (!open) setCsvMappings(null); }}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-accent" />
              Confirm Property Directory Import
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Review the owner assignments below. Uncheck any rows you want to skip. You can also edit owner names before applying.
          </p>

          <div className="flex-1 overflow-auto border border-border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={csvMappings?.every(m => m.selected)}
                      onCheckedChange={toggleAllCsv}
                    />
                  </TableHead>
                  <TableHead className="text-xs">Property</TableHead>
                  <TableHead className="text-xs">Owner Entity</TableHead>
                  <TableHead className="text-xs w-20">Match</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(csvByOwner).map(([ownerName, { mappings, indices }]) => (
                  mappings.map((m, j) => {
                    const idx = indices[j];
                    const hasMatch = properties.some(p => matchesProperty(m.addressVariants, p.address));
                    const entityExists = entities.some(e => e.name.toLowerCase() === m.ownerName.trim().toLowerCase());

                    return (
                      <TableRow key={idx} className={!m.selected ? "opacity-50" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={m.selected}
                            onCheckedChange={() => toggleCsvRow(idx)}
                          />
                        </TableCell>
                        <TableCell className="text-sm">{m.propertyAddress}</TableCell>
                        <TableCell>
                          <Input
                            value={m.ownerName}
                            onChange={e => updateCsvOwnerName(idx, e.target.value)}
                            className="h-7 text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          {hasMatch ? (
                            <span className="text-xs text-accent font-medium">✓ Found</span>
                          ) : (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" /> New
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted-foreground">
              {selectedCsvCount} of {csvMappings?.length || 0} rows selected •{" "}
              {new Set(csvMappings?.filter(m => m.selected).map(m => m.ownerName.trim())).size} unique entities
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setCsvMappings(null)}>Cancel</Button>
              <Button
                size="sm"
                disabled={selectedCsvCount === 0 || isApplying}
                onClick={applyBulkMappings}
              >
                {isApplying ? (
                  <>
                    <div className="h-3.5 w-3.5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-1" />
                    Applying...
                  </>
                ) : (
                  <>Apply {selectedCsvCount} Assignments</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
