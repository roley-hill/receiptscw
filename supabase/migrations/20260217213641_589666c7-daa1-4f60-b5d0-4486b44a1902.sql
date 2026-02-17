
-- Table to store skipped duplicates for user review
CREATE TABLE public.skipped_duplicates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  tenant TEXT NOT NULL DEFAULT '',
  property TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  receipt_date DATE,
  rent_month TEXT,
  payment_type TEXT DEFAULT '',
  reference TEXT DEFAULT '',
  memo TEXT DEFAULT '',
  file_name TEXT,
  file_path TEXT,
  existing_receipt_id TEXT NOT NULL,
  existing_receipt_uuid UUID,
  confidence_scores JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved (force-added), dismissed
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.skipped_duplicates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read skipped_duplicates"
  ON public.skipped_duplicates FOR SELECT
  USING (public.is_authenticated_with_role());

CREATE POLICY "Processors can insert skipped_duplicates"
  ON public.skipped_duplicates FOR INSERT
  WITH CHECK (public.is_processor_or_above());

CREATE POLICY "Processors can update skipped_duplicates"
  ON public.skipped_duplicates FOR UPDATE
  USING (public.is_processor_or_above());

CREATE POLICY "Processors can delete skipped_duplicates"
  ON public.skipped_duplicates FOR DELETE
  USING (public.is_processor_or_above());
