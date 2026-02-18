import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type DbReceipt = Tables<"receipts">;
export type DbDepositBatch = Tables<"deposit_batches">;

export async function fetchReceipts() {
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchReceiptsByStatus(status: "needs_review" | "finalized" | "exception") {
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("status", status)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function updateReceipt(id: string, updates: Record<string, any>) {
  const { data, error } = await supabase
    .from("receipts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchBatches() {
  const { data, error } = await supabase
    .from("deposit_batches")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function uploadReceiptFile(file: File, token: string) {
  const formData = new FormData();
  formData.append("file", file);

  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-receipt`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!resp.ok) {
    const err = await resp.json();
    if (resp.status === 409 && err.already_processed) {
      return { ...err, skipped_already_processed: true, inserted_count: 0, duplicate_count: 0, total_line_items: 0 };
    }
    throw new Error(err.error || "Upload failed");
  }
  return resp.json();
}

export async function getFilePreviewUrl(filePath: string): Promise<string> {
  const { data } = await supabase.storage
    .from("receipts")
    .createSignedUrl(filePath, 3600); // 1 hour expiry
  if (!data?.signedUrl) throw new Error("Could not generate preview URL");
  return data.signedUrl;
}

export async function createDepositBatch(property: string, receiptIds: string[], depositPeriod: string, userId: string) {
  const { data: receipts } = await supabase
    .from("receipts")
    .select("id, amount")
    .in("id", receiptIds);

  const totalAmount = receipts?.reduce((sum, r) => sum + Number(r.amount), 0) || 0;

  const { data: batch, error } = await supabase
    .from("deposit_batches")
    .insert({
      property,
      deposit_period: depositPeriod,
      total_amount: totalAmount,
      receipt_count: receiptIds.length,
      created_by: userId,
    })
    .select()
    .single();

  if (error) throw error;

  for (const rid of receiptIds) {
    await supabase.from("receipts").update({ batch_id: batch.id }).eq("id", rid);
  }

  return batch;
}

export async function markAppfolioRecorded(receiptId: string, recorded: boolean, userId: string) {
  const updates: Record<string, any> = {
    appfolio_recorded: recorded,
    appfolio_recorded_at: recorded ? new Date().toISOString() : null,
    appfolio_recorded_by: recorded ? userId : null,
  };
  const { data, error } = await supabase
    .from("receipts")
    .update(updates)
    .eq("id", receiptId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function reverseBatch(batchId: string) {
  // Unlink all receipts from this batch
  const { error: unlinkError } = await supabase
    .from("receipts")
    .update({ batch_id: null })
    .eq("batch_id", batchId);
  if (unlinkError) throw unlinkError;

  // Set batch status to reversed
  const { data, error } = await supabase
    .from("deposit_batches")
    .update({ status: "reversed" as any })
    .eq("id", batchId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
