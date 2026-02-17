export type ReceiptStatus = "needs_review" | "finalized" | "exception";
export type TransferStatus = "untransferred" | "transferred" | "reversed";
export type BatchStatus = "draft" | "ready" | "transferred" | "reversed";

export interface ConfidenceScores {
  property: number;
  unit: number;
  tenant: number;
  amount: number;
  receiptDate: number;
  paymentType: number;
}

export interface Receipt {
  id: string;
  property: string;
  unit: string;
  tenant: string;
  receiptDate: string;
  rentMonth: string;
  amount: number;
  paymentType: string;
  reference: string;
  memo: string;
  confidence: ConfidenceScores;
  status: ReceiptStatus;
  transferStatus: TransferStatus;
  batchId: string | null;
  transferredAt?: string;
  transferredBy?: string;
  uploadedAt: string;
  fileName: string;
}

export interface DepositBatch {
  id: string;
  property: string;
  depositPeriod: string;
  status: BatchStatus;
  totalAmount: number;
  receiptCount: number;
  receiptIds: string[];
  createdAt: string;
  createdBy: string;
  transferredAt?: string;
  transferMethod?: string;
  externalReference?: string;
  transferredBy?: string;
  notes?: string;
}
