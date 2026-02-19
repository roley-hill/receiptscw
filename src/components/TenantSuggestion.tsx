import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TenantSuggestionProps {
  property: string;
  unit: string;
  extractedTenant: string;
  onAccept: (tenant: { name: string; property: string; unit: string }) => void;
}

/** Normalize for comparison: lowercase, strip periods, collapse whitespace */
function norm(s: string) {
  return s.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
}

/** Strip middle names/initials → [first, last] */
function firstLast(name: string): string[] {
  const parts = norm(name).split(" ");
  if (parts.length <= 2) return parts;
  return [parts[0], parts[parts.length - 1]];
}

/** Check if two names are similar enough to suggest (but not exact) */
function isFuzzySimilar(extracted: string, known: string): boolean {
  const e = norm(extracted);
  const k = norm(known);
  if (e === k) return false; // exact match — no suggestion needed

  const eParts = e.split(" ");
  const kParts = k.split(" ");
  const eLast = eParts[eParts.length - 1];
  const kLast = kParts[kParts.length - 1];

  // Last names must be close (handle "La Costa" vs "LaCosta")
  const eLastNorm = eLast.replace(/\s+/g, "");
  const kLastNorm = kLast.replace(/\s+/g, "");
  // Also try joining last two parts for multi-word last names
  const eLastJoined = eParts.length >= 2 ? eParts.slice(-2).join("") : eLast;
  const kLastJoined = kParts.length >= 2 ? kParts.slice(-2).join("") : kLast;

  const lastNameMatch =
    eLastNorm === kLastNorm ||
    eLastJoined === kLastNorm ||
    eLastNorm === kLastJoined ||
    eLastJoined === kLastJoined;

  if (!lastNameMatch) return false;

  // First name or initial must overlap
  const eFirst = eParts[0];
  const kFirst = kParts[0];
  if (eFirst === kFirst) return true;
  if (eFirst.length === 1 && kFirst.startsWith(eFirst)) return true;
  if (kFirst.length === 1 && eFirst.startsWith(kFirst)) return true;

  // Compare with middles stripped
  const ef = firstLast(extracted);
  const kf = firstLast(known);
  if (ef.length >= 2 && kf.length >= 2 && ef[0] === kf[0]) return true;

  return false;
}

export default function TenantSuggestion({ property, unit, extractedTenant, onAccept }: TenantSuggestionProps) {
  const { data: suggestions = [] } = useQuery({
    queryKey: ["tenant-suggestion", property, unit],
    queryFn: async () => {
      if (!property || !unit) return [];
      // Query tenants at this property+unit
      const { data } = await supabase
        .from("appfolio_tenants")
        .select("full_name, property_address, unit_number")
        .ilike("property_address", `%${property.split(" ").slice(0, 3).join(" ")}%`)
        .eq("unit_number", unit)
        .eq("status", "active");
      return data || [];
    },
    enabled: !!property && !!unit && !!extractedTenant,
    staleTime: 60_000,
  });

  // Find fuzzy matches
  const matches = suggestions.filter((t) =>
    t.full_name && isFuzzySimilar(extractedTenant, t.full_name)
  );

  if (matches.length === 0) return null;

  return (
    <div className="space-y-2">
      {matches.map((match) => (
        <div
          key={match.full_name}
          className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5"
        >
          <UserCheck className="h-4 w-4 text-accent shrink-0" />
          <p className="text-sm text-foreground flex-1">
            Could this be <span className="font-semibold">{match.full_name}</span>?
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
            Yes
          </Button>
        </div>
      ))}
    </div>
  );
}
