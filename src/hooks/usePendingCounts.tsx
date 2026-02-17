import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function usePendingCounts() {
  return useQuery({
    queryKey: ["pending_counts"],
    queryFn: async () => {
      const [reviewRes, entryRes, exceptionsRes, duplicatesRes] = await Promise.all([
        supabase.from("receipts").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
        supabase.from("receipts").select("id", { count: "exact", head: true }).eq("status", "finalized").is("batch_id", null),
        supabase.from("receipts").select("id", { count: "exact", head: true }).eq("status", "exception"),
        supabase.from("skipped_duplicates").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      return {
        review: reviewRes.count ?? 0,
        entry: entryRes.count ?? 0,
        exceptions: exceptionsRes.count ?? 0,
        duplicates: duplicatesRes.count ?? 0,
      };
    },
    refetchInterval: 30000,
  });
}
