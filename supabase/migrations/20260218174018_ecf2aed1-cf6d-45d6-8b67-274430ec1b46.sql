-- Add file_content_hash column to receipts for detecting duplicate file uploads with different names
ALTER TABLE public.receipts ADD COLUMN IF NOT EXISTS file_content_hash text;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_receipts_file_content_hash ON public.receipts (file_content_hash) WHERE file_content_hash IS NOT NULL;