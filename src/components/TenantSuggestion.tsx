import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TenantSuggestionProps {
  property: string;
  unit: string;
  extractedTenant: string;
  onAccept: (tenant: { name: string; property: string; unit: string }) => void;
  /** If true, suggestion was already accepted — hide the banner */
  hidden?: boolean;
  /** Whether the tenant was verified by the extraction pipeline */
  tenantVerified?: boolean;
}

/** Normalize: lowercase, strip periods, collapse whitespace */
function norm(s: string) {
  return s.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
}

/** Strip middle names/initials → [first, last] */
function firstLast(name: string): string[] {
  const parts = norm(name).split(" ");
  if (parts.length <= 2) return parts;
  return [parts[0], parts[parts.length - 1]];
}

/** Check if unit numbers match (handles "14646-11" vs "11", "#18" vs "18") */
function unitsMatch(receiptUnit: string, dbUnit: string): boolean {
  const r = receiptUnit.replace(/^#/, "").trim();
  const d = dbUnit.replace(/^#/, "").trim();
  if (r === d) return true;
  // DB might be "14646-11", receipt is "11"
  if (d.endsWith("-" + r) || d.endsWith(" " + r)) return true;
  // Strip leading zeros: "07" matches "7"
  const rNum = r.replace(/^0+/, "") || "0";
  const dNum = d.replace(/^0+/, "").replace(/.*[-\s]0*/, "") || "0";
  if (rNum === dNum) return true;
  return false;
}

/** Levenshtein distance for catching typos like Rachael vs Rachel */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

/** Check if two names are similar enough to suggest */
function isFuzzySimilar(extracted: string, known: string): boolean {
  const e = norm(extracted);
  const k = norm(known);
  if (e === k) return true;

  // Substring containment
  if (k.includes(e) || e.includes(k)) return true;

  const eParts = e.split(" ");
  const kParts = k.split(" ");
  const eLast = eParts[eParts.length - 1];
  const kLast = kParts[kParts.length - 1];
  const eFirst = eParts[0];
  const kFirst = kParts[0];

  // If ANY name part matches (first or last), suggest it
  // e.g. "Cortessa Robinson" vs "Cortessa Johnson" → first name matches
  // e.g. "Maria Torres" vs "Angelica Torres" at same unit → last name matches
  const anyPartMatch = eParts.some(ep => ep.length >= 3 && kParts.some(kp => kp.length >= 3 && (ep === kp || (ep.length >= 4 && levenshtein(ep, kp) <= 1))));
  if (anyPartMatch) return true;

  // Initial match: "M" matches "Maria"
  if (eFirst.length === 1 && kFirst.startsWith(eFirst)) return true;
  if (kFirst.length === 1 && eFirst.startsWith(kFirst)) return true;

  // Multi-word last name handling: "La Costa" vs "LaCosta"
  const eLastJoined = eParts.length >= 2 ? eParts.slice(-2).join("") : eLast;
  const kLastJoined = kParts.length >= 2 ? kParts.slice(-2).join("") : kLast;
  if (eLastJoined === kLast || eLast === kLastJoined || eLastJoined === kLastJoined) return true;

  // Compare with middles stripped
  const ef = firstLast(extracted);
  const kf = firstLast(known);
  if (ef.length >= 2 && kf.length >= 2 && ef[0] === kf[0]) return true;
  if (ef.length >= 2 && kf.length >= 2 && ef[1] === kf[1]) return true;

  return false;
}

export default function TenantSuggestion({ property, unit, extractedTenant, onAccept, hidden, tenantVerified }: TenantSuggestionProps) {
  const { data: suggestions = [] } = useQuery({
    queryKey: ["tenant-suggestion", property, unit],
    queryFn: async () => {
      if (!property || !unit) return [];
      // Extract first few words of property for matching
      const propSearch = property.split(" ").slice(0, 3).join(" ");
      // Query tenants at this property (broader unit match done client-side)
      const { data } = await supabase
        .from("appfolio_tenants")
        .select("full_name, property_address, unit_number, status")
        .ilike("property_address", `%${propSearch}%`);
      // Filter by unit match client-side (handles format differences)
      return (data || []).filter((t) => t.unit_number && unitsMatch(unit, t.unit_number));
    },
    enabled: !!property && !!unit && !!extractedTenant,
    staleTime: 60_000,
  });

  // Find fuzzy matches (similar name but not exact after acceptance)
  const matches = suggestions.filter((t) =>
    t.full_name && isFuzzySimilar(extractedTenant, t.full_name)
  );

  // Hide if already accepted (exact match with high confidence) or no matches
  if (hidden || matches.length === 0) return null;

  // If all matches are exact matches AND tenant was verified, don't show (already accepted)
  const allExact = matches.every((m) => norm(m.full_name!) === norm(extractedTenant));
  if (allExact && tenantVerified) return null;

  return (
    <div className="space-y-2">
      {matches.map((match) => {
        const isExact = norm(match.full_name!) === norm(extractedTenant);
        return (
          <div
            key={match.full_name}
            className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5"
          >
            <UserCheck className="h-4 w-4 text-accent shrink-0" />
            <p className="text-sm text-foreground flex-1">
              {isExact ? (
                <>
                  <span className="font-semibold">{match.full_name}</span> found in AppFolio — confirm match?
                </>
              ) : (
                <>
                  Could this be <span className="font-semibold">{match.full_name}</span>?
                </>
              )}
              {match.status && match.status !== "current" && (
                <span className="text-xs text-muted-foreground ml-1">({match.status})</span>
              )}
            </p>
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                onAccept({
                  name: match.full_name!,
                  property: match.property_address || property,
                  unit: match.unit_number || unit,
                })
              }
            >
              {isExact ? "Confirm" : "Yes, use this tenant"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
