import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

async function softDeleteReceipts(ids: string[], userId?: string) {
  const now = new Date().toISOString();
  
  // Fetch receipt details for audit log before soft-deleting
  const { data: receiptsToDelete } = await supabase
    .from("receipts")
    .select("id, receipt_id, tenant, property, unit, amount, status, file_name")
    .in("id", ids);

  // Soft delete
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { error } = await supabase
      .from("receipts")
      .update({ deleted_at: now } as any)
      .in("id", chunk);
    if (error) throw error;
  }

  // Audit log
  if (receiptsToDelete && receiptsToDelete.length > 0) {
    const logs = receiptsToDelete.map((r) => ({
      action: "receipt_deleted",
      entity_type: "receipt",
      entity_id: r.id,
      user_id: userId || null,
      details: {
        receipt_id: r.receipt_id,
        tenant: r.tenant,
        property: r.property,
        unit: r.unit,
        amount: r.amount,
        status: r.status,
        file_name: r.file_name,
      },
    }));
    await supabase.from("audit_logs").insert(logs);
  }
}

export { softDeleteReceipts };

export function useAdminDelete() {
  const { role, user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = role === "admin";

  const deleteMutation = useMutation({
    mutationFn: async (receiptId: string) => {
      await softDeleteReceipts([receiptId], user?.id);
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
