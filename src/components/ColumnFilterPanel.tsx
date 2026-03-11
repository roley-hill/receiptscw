import { useState, useMemo, useCallback } from "react";
import { ChevronRight, ChevronDown, X, Search, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/* ─── Types ─── */
export type FilterOperator = "contains" | "does_not_contain" | "is" | "is_not" | "is_empty" | "is_not_empty";

export interface ColumnFilter {
  id: string;
  operator: FilterOperator;
  value: string;
}

export interface ColumnFilterGroup {
  columnKey: string;
  logic: "AND" | "OR";
  filters: ColumnFilter[];
}

export interface FilterableColumn {
  key: string;
  label: string;
  accessor: (row: any) => string;
}

const OPERATORS: { value: FilterOperator; label: string; needsValue: boolean }[] = [
  { value: "contains", label: "contains", needsValue: true },
  { value: "does_not_contain", label: "does not contain", needsValue: true },
  { value: "is", label: "is", needsValue: true },
  { value: "is_not", label: "is not", needsValue: true },
  { value: "is_empty", label: "is empty", needsValue: false },
  { value: "is_not_empty", label: "is not empty", needsValue: false },
];

let _filterId = 0;
const nextId = () => `f-${++_filterId}`;

/* ─── Parse multi-value string (pipe-separated) ─── */
function parseMultiValue(value: string): string[] {
  if (!value) return [];
  return value.split("|");
}

function toMultiValue(values: string[]): string {
  return values.join("|");
}

/* ─── Evaluate a single filter against a cell value ─── */
function evalFilter(cellValue: string, filter: ColumnFilter): boolean {
  const cell = (cellValue || "").toLowerCase();
  switch (filter.operator) {
    case "contains": return cell.includes((filter.value || "").toLowerCase());
    case "does_not_contain": return !cell.includes((filter.value || "").toLowerCase());
    case "is": {
      const vals = parseMultiValue(filter.value).map(v => v.toLowerCase());
      if (vals.length === 0) return true;
      // Include empty match if __empty__ is in the list
      if (vals.includes("__empty__")) {
        return (!cellValue || cellValue.trim() === "") || vals.includes(cell);
      }
      return vals.includes(cell);
    }
    case "is_not": {
      const vals = parseMultiValue(filter.value).map(v => v.toLowerCase());
      if (vals.length === 0) return true;
      if (vals.includes("__empty__")) {
        return (!!cellValue && cellValue.trim() !== "") && !vals.includes(cell);
      }
      return !vals.includes(cell);
    }
    case "is_empty": return !cellValue || cellValue.trim() === "";
    case "is_not_empty": return !!cellValue && cellValue.trim() !== "";
    default: return true;
  }
}

/* ─── Apply all column filter groups to a dataset ─── */
export function applyColumnFilters<T>(rows: T[], groups: ColumnFilterGroup[], columns: FilterableColumn[]): T[] {
  if (groups.length === 0) return rows;
  return rows.filter(row => {
    return groups.every(group => {
      const col = columns.find(c => c.key === group.columnKey);
      if (!col) return true;
      const cellValue = col.accessor(row);
      if (group.filters.length === 0) return true;
      if (group.logic === "AND") {
        return group.filters.every(f => evalFilter(cellValue, f));
      } else {
        return group.filters.some(f => evalFilter(cellValue, f));
      }
    });
  });
}

/* ─── Single column section ─── */
function ColumnSection({
  column,
  group,
  onUpdate,
  onRemoveGroup,
  distinctValues,
}: {
  column: FilterableColumn;
  group: ColumnFilterGroup | undefined;
  onUpdate: (group: ColumnFilterGroup) => void;
  onRemoveGroup: () => void;
  distinctValues: string[];
}) {
  const [open, setOpen] = useState(!!group);
  
  // Draft state: local edits before applying
  const [draftFilters, setDraftFilters] = useState<ColumnFilter[]>(group?.filters || []);
  const [draftLogic, setDraftLogic] = useState<"AND" | "OR">(group?.logic || "AND");
  const [isDirty, setIsDirty] = useState(false);

  // Sync draft when applied group changes externally (e.g. clear all)
  const appliedKey = JSON.stringify(group?.filters || []) + (group?.logic || "AND");
  const [lastAppliedKey, setLastAppliedKey] = useState(appliedKey);
  if (appliedKey !== lastAppliedKey) {
    setDraftFilters(group?.filters || []);
    setDraftLogic(group?.logic || "AND");
    setIsDirty(false);
    setLastAppliedKey(appliedKey);
  }

  const hasAppliedFilters = group && group.filters.length > 0;
  const hasDraftFilters = draftFilters.length > 0;

  const addFilter = () => {
    const newFilter: ColumnFilter = { id: nextId(), operator: "contains", value: "" };
    setDraftFilters(prev => [...prev, newFilter]);
    setIsDirty(true);
    setOpen(true);
  };

  const updateDraftFilter = (filterId: string, updates: Partial<ColumnFilter>) => {
    setDraftFilters(prev => prev.map(f => f.id === filterId ? { ...f, ...updates } : f));
    setIsDirty(true);
  };

  const removeDraftFilter = (filterId: string) => {
    const remaining = draftFilters.filter(f => f.id !== filterId);
    setDraftFilters(remaining);
    setIsDirty(true);
  };

  const toggleDraftLogic = () => {
    setDraftLogic(prev => prev === "AND" ? "OR" : "AND");
    setIsDirty(true);
  };

  const applyFilters = () => {
    if (draftFilters.length === 0) {
      onRemoveGroup();
    } else {
      onUpdate({ columnKey: column.key, logic: draftLogic, filters: draftFilters });
    }
    setIsDirty(false);
  };

  const clearColumn = () => {
    setDraftFilters([]);
    setDraftLogic("AND");
    setIsDirty(false);
    onRemoveGroup();
  };

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted/50 ${hasAppliedFilters ? "bg-accent/5" : ""}`}
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
        <span className={`flex-1 text-left ${hasAppliedFilters ? "font-semibold text-accent" : "text-foreground"}`}>{column.label}</span>
        {hasAppliedFilters && (
          <span className="text-[10px] vault-mono bg-accent/10 text-accent rounded-full px-1.5 py-0.5">{group!.filters.length}</span>
        )}
        {isDirty && (
          <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {draftFilters.map((filter, i) => {
            const opConfig = OPERATORS.find(o => o.value === filter.operator);
            return (
              <div key={filter.id} className="space-y-1.5">
                {i > 0 && draftFilters.length > 1 && (
                  <div className="flex items-center gap-1 py-0.5">
                    <button
                      onClick={toggleDraftLogic}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded ${draftLogic === "AND" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                    >
                      AND
                    </button>
                    <button
                      onClick={toggleDraftLogic}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded ${draftLogic === "OR" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                    >
                      OR
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <Select value={filter.operator} onValueChange={(v) => updateDraftFilter(filter.id, { operator: v as FilterOperator })}>
                    <SelectTrigger className="h-7 text-[11px] flex-1 min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[300]">
                      {OPERATORS.map(op => (
                        <SelectItem key={op.value} value={op.value} className="text-xs">{op.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    onClick={() => removeDraftFilter(filter.id)}
                    className="h-7 w-7 shrink-0 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                {opConfig?.needsValue && (filter.operator === "is" || filter.operator === "is_not") ? (
                  <Select
                    value={filter.value || "__pick__"}
                    onValueChange={(v) => updateDraftFilter(filter.id, { value: v === "__pick__" ? "" : v === "__empty__" ? "" : v })}
                  >
                    <SelectTrigger className="h-7 text-[11px] w-full">
                      <SelectValue placeholder="Select value" />
                    </SelectTrigger>
                    <SelectContent className="z-[300] max-h-[200px]">
                      <SelectItem value="__pick__" className="text-xs text-muted-foreground">Select value...</SelectItem>
                      <SelectItem value="__empty__" className="text-xs italic text-muted-foreground">(empty)</SelectItem>
                      {distinctValues.map(v => (
                        <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : opConfig?.needsValue ? (
                  <Input
                    value={filter.value}
                    onChange={(e) => updateDraftFilter(filter.id, { value: e.target.value })}
                    placeholder="Value"
                    className="h-7 text-xs"
                  />
                ) : null}
              </div>
            );
          })}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={addFilter}
              className="flex items-center gap-1 text-[11px] text-accent hover:text-accent/80 font-medium transition-colors"
            >
              <Plus className="h-3 w-3" />
              Add filter
            </button>
            {(hasAppliedFilters || hasDraftFilters) && (
              <button
                onClick={clearColumn}
                className="text-[11px] text-muted-foreground hover:text-destructive transition-colors ml-auto"
              >
                Clear
              </button>
            )}
          </div>

          {/* Apply / Cancel buttons */}
          {isDirty && (
            <div className="flex items-center gap-1.5 pt-1 border-t border-border mt-1">
              <Button
                size="sm"
                className="h-6 text-[10px] px-3 flex-1"
                onClick={applyFilters}
              >
                Apply
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => {
                  setDraftFilters(group?.filters || []);
                  setDraftLogic(group?.logic || "AND");
                  setIsDirty(false);
                }}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Main Panel ─── */
export default function ColumnFilterPanel({
  columns,
  filterGroups,
  onFilterGroupsChange,
  onClose,
  filteredRows,
}: {
  columns: FilterableColumn[];
  filterGroups: ColumnFilterGroup[];
  onFilterGroupsChange: (groups: ColumnFilterGroup[]) => void;
  onClose: () => void;
  filteredRows: any[];
}) {
  const [search, setSearch] = useState("");

  const filteredColumns = useMemo(
    () => columns.filter(c => !search || c.label.toLowerCase().includes(search.toLowerCase())),
    [columns, search]
  );

  const activeCount = filterGroups.reduce((sum, g) => sum + g.filters.length, 0);

  const updateGroup = (columnKey: string, group: ColumnFilterGroup) => {
    const existing = filterGroups.findIndex(g => g.columnKey === columnKey);
    if (existing >= 0) {
      const next = [...filterGroups];
      next[existing] = group;
      onFilterGroupsChange(next);
    } else {
      onFilterGroupsChange([...filterGroups, group]);
    }
  };

  const removeGroup = (columnKey: string) => {
    onFilterGroupsChange(filterGroups.filter(g => g.columnKey !== columnKey));
  };

  const clearAll = () => {
    onFilterGroupsChange([]);
  };

  return (
    <div className="vault-card p-0 overflow-hidden w-[240px] shrink-0 self-start sticky top-4">
      <div className="px-3 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filters</h3>
        <div className="flex items-center gap-1">
          {activeCount > 0 && (
            <Button variant="ghost" size="sm" className="h-6 text-[10px] px-1.5 text-muted-foreground" onClick={clearAll}>
              Clear all
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 w-full rounded-md border border-input bg-background pl-7 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="max-h-[calc(100vh-260px)] overflow-auto">
        {filteredColumns.map(col => {
          const set = new Set<string>();
          for (const row of filteredRows) {
            const v = col.accessor(row);
            if (v && v.trim()) set.add(v);
          }
          const distinctValues = Array.from(set).sort();

          return (
            <ColumnSection
              key={col.key}
              column={col}
              group={filterGroups.find(g => g.columnKey === col.key)}
              onUpdate={(g) => updateGroup(col.key, g)}
              onRemoveGroup={() => removeGroup(col.key)}
              distinctValues={distinctValues}
            />
          );
        })}
      </div>

      {/* Active filter summary */}
      {activeCount > 0 && (
        <div className="px-3 py-3 border-t border-border bg-muted/10">
          <div className="flex flex-wrap gap-1 mb-2">
            {filterGroups.flatMap(g => {
              const col = columns.find(c => c.key === g.columnKey);
              return g.filters.map(f => {
                const opLabel = OPERATORS.find(o => o.value === f.operator)?.label || f.operator;
                const display = f.operator === "is_empty" || f.operator === "is_not_empty"
                  ? `${col?.label} ${opLabel}`
                  : `${col?.label} ${opLabel} "${f.value}"`;
                return (
                  <span key={f.id} className="inline-flex items-center gap-1 bg-accent/10 text-accent text-[10px] font-medium rounded-full px-2 py-0.5 max-w-full">
                    <span className="truncate">{display}</span>
                    <button onClick={() => {
                      const remaining = g.filters.filter(ff => ff.id !== f.id);
                      if (remaining.length === 0) removeGroup(g.columnKey);
                      else updateGroup(g.columnKey, { ...g, filters: remaining });
                    }} className="hover:text-accent-foreground shrink-0">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                );
              });
            })}
          </div>
          <div className="text-[10px] vault-mono text-muted-foreground">
            {activeCount} active filter{activeCount > 1 ? "s" : ""}
          </div>
        </div>
      )}
    </div>
  );
}
