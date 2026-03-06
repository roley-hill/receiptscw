
-- 1. Create ownership_entities table
CREATE TABLE public.ownership_entities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.ownership_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read ownership entities"
  ON public.ownership_entities FOR SELECT TO authenticated
  USING (public.is_authenticated_with_role());

CREATE POLICY "Admins can manage ownership entities"
  ON public.ownership_entities FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 2. Create properties table
CREATE TABLE public.properties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  normalized_address TEXT NOT NULL,
  ownership_entity_id UUID REFERENCES public.ownership_entities(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read properties"
  ON public.properties FOR SELECT TO authenticated
  USING (public.is_authenticated_with_role());

CREATE POLICY "Admins can manage properties"
  ON public.properties FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Processors can insert properties"
  ON public.properties FOR INSERT TO authenticated
  WITH CHECK (public.is_processor_or_above());

CREATE POLICY "Processors can update properties"
  ON public.properties FOR UPDATE TO authenticated
  USING (public.is_processor_or_above());

-- 3. Add updated_at triggers
CREATE TRIGGER update_ownership_entities_updated_at
  BEFORE UPDATE ON public.ownership_entities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_properties_updated_at
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Add parent_batch_id to deposit_batches for grouped batches
ALTER TABLE public.deposit_batches 
  ADD COLUMN parent_batch_id UUID REFERENCES public.deposit_batches(id) ON DELETE SET NULL,
  ADD COLUMN ownership_entity_id UUID REFERENCES public.ownership_entities(id) ON DELETE SET NULL;

-- 5. Populate properties table from existing receipt data
INSERT INTO public.properties (address, normalized_address)
SELECT DISTINCT ON (lower(trim(property)))
  property,
  lower(trim(replace(property, ',', ' ')))
FROM public.receipts
WHERE property IS NOT NULL AND property != ''
ON CONFLICT (address) DO NOTHING;
