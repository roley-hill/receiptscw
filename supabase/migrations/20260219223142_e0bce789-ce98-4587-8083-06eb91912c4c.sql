
-- DD Deals table: top-level deal record (one per acquisition)
CREATE TABLE public.dd_deals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_name TEXT NOT NULL,
  property_address TEXT,
  address_city TEXT,
  address_state TEXT,
  address_postal_code TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.dd_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read dd_deals"
  ON public.dd_deals FOR SELECT
  USING (is_authenticated_with_role());

CREATE POLICY "Processors can insert dd_deals"
  ON public.dd_deals FOR INSERT
  WITH CHECK (is_processor_or_above());

CREATE POLICY "Processors can update dd_deals"
  ON public.dd_deals FOR UPDATE
  USING (is_processor_or_above());

CREATE POLICY "Admins can delete dd_deals"
  ON public.dd_deals FOR DELETE
  USING (is_admin());

-- DD Packages table: each upload/processing run within a deal
CREATE TABLE public.dd_packages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id UUID NOT NULL REFERENCES public.dd_deals(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'processing',  -- processing | done | error
  total_files INTEGER NOT NULL DEFAULT 0,
  processed_files INTEGER NOT NULL DEFAULT 0,
  storage_prefix TEXT,  -- e.g. "my-deal-slug/pkg-uuid"
  error TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.dd_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read dd_packages"
  ON public.dd_packages FOR SELECT
  USING (is_authenticated_with_role());

CREATE POLICY "Processors can insert dd_packages"
  ON public.dd_packages FOR INSERT
  WITH CHECK (is_processor_or_above());

CREATE POLICY "Processors can update dd_packages"
  ON public.dd_packages FOR UPDATE
  USING (is_processor_or_above());

CREATE POLICY "Admins can delete dd_packages"
  ON public.dd_packages FOR DELETE
  USING (is_admin());

-- DD Sorted Files table: record of each file after renaming/classification
CREATE TABLE public.dd_sorted_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES public.dd_packages(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.dd_deals(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  renamed_to TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',  -- lease | rent-roll | notice | estoppel | other
  building_slug TEXT,
  unit TEXT,
  storage_path TEXT,
  ai_confidence NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.dd_sorted_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read dd_sorted_files"
  ON public.dd_sorted_files FOR SELECT
  USING (is_authenticated_with_role());

CREATE POLICY "Processors can insert dd_sorted_files"
  ON public.dd_sorted_files FOR INSERT
  WITH CHECK (is_processor_or_above());

CREATE POLICY "Admins can delete dd_sorted_files"
  ON public.dd_sorted_files FOR DELETE
  USING (is_admin());

-- Triggers for updated_at
CREATE TRIGGER update_dd_deals_updated_at
  BEFORE UPDATE ON public.dd_deals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_dd_packages_updated_at
  BEFORE UPDATE ON public.dd_packages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for DD documents (private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dd-documents',
  'dd-documents',
  false,
  52428800,  -- 50MB
  NULL
) ON CONFLICT (id) DO NOTHING;

-- RLS for dd-documents bucket
CREATE POLICY "Authenticated users can read dd documents"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'dd-documents' AND is_authenticated_with_role());

CREATE POLICY "Processors can upload dd documents"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'dd-documents' AND is_processor_or_above());

CREATE POLICY "Processors can update dd documents"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'dd-documents' AND is_processor_or_above());

CREATE POLICY "Admins can delete dd documents"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'dd-documents' AND is_admin());
