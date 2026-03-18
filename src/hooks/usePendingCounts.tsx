import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

async function fetchCount(
  table: "receipts" | "skipped_duplicates",
  filters: Record<string, any>
): Promise<number> {
  // Use range header trick to get exact count without fetching all rows
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  for (const [key, value] of Object.entries(filters)) {
    if (value === null) {
      query = (query as any).is(key, null);
    } else {
      query = (query as any).eq(key, value);
    }
  }
  const { count, error } = await query;
  if (error) {
    // Fallback: paginate to count if HEAD fails (free-tier Supabase quirk)
    let total = 0;
    let from = 0;
    while (true) {
      let q2 = supabase.from(table).select("id").range(from, from + 999);
      for (const [key, value] of Object.entries(filters)) {
        if (value === null) q2 = (q2 as any).is(key, null);
        else q2 = (q2 as any).eq(key, value);
      }
      const { data } = await q2;
      if (!data || data.length === 0) break;
      total += data.length;
      if (data.length < 1000) break;
      from += 1000;
    }
    return total;
  }
  return count ?? 0;
}

export function usePendingCounts() {
  return useQuery({
    queryKey: ["pending_counts"],
    queryFn: async () => {
      const [review, entry, exceptions, duplicates] = await Promise.all([
        fetchCount("receipts", { status: "needs_review", deleted_at: null }),
        fetchCount("receipts", { status: "finalized", batch_id: null, deleted_at: null }),
        fetchCount("receipts", { status: "exception", deleted_at: null }),
        fetchCount("skipped_duplicates", { status: "pending" }),
      ]);
      return { review, entry, exceptions, duplicates };
    },
    refetchInterval: 30000,
  });
}
