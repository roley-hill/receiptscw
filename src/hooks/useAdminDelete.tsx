import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export function useAdminDelete() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = role === "admin";

  const deleteMutation = useMutation({
    mutationFn: async (receiptId: string) => {
      const { error } = await supabase.from("receipts").delete().eq("id", receiptId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Receipt deleted");
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["pending_counts"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return { isAdmin, deleteMutation };
}
