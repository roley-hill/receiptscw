import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function usePendingCounts() {
  return useQuery({
    queryKey: ["pending_counts"],
    queryFn: async () => {
      // Use regular SELECT instead of HEAD to avoid 503s on count=exact HEAD requests
      const [reviewRes, entryRes, exceptionsRes, duplicatesRes] = await Promise.all([
        supabase.from("receipts").select("id").eq("status", "needs_review").is("deleted_at", null),
        supabase.from("receipts").select("id").eq("status", "finalized").is("batch_id", null).is("deleted_at", null),
        supabase.from("receipts").select("id").eq("status", "exception").is("deleted_at", null),
        supabase.from("skipped_duplicates").select("id").eq("status", "pending"),
      ]);
      return {
        review: reviewRes.data?.length ?? 0,
        entry: entryRes.data?.length ?? 0,
        exceptions: exceptionsRes.data?.length ?? 0,
        duplicates: duplicatesRes.data?.length ?? 0,
      };
    },
    refetchInterval: 30000,
  });
}
