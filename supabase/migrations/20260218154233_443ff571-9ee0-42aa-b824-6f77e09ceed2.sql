
-- Table to track individual files within an upload batch
CREATE TABLE public.upload_batch_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES public.upload_batches(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  inserted_count INTEGER DEFAULT 0,
  duplicate_count INTEGER DEFAULT 0,
  total_line_items INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.upload_batch_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read upload batch files"
  ON public.upload_batch_files FOR SELECT
  USING (is_authenticated_with_role());

CREATE POLICY "Processors can manage upload batch files"
  ON public.upload_batch_files FOR ALL
  USING (is_processor_or_above())
  WITH CHECK (is_processor_or_above());

-- Add uploader info to upload_batches
ALTER TABLE public.upload_batches
  ADD COLUMN IF NOT EXISTS uploaded_by_name TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_by_email TEXT;
