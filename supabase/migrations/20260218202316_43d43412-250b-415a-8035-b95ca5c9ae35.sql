
-- Table to store rent roll charge data from AppFolio
CREATE TABLE public.rent_roll_charges (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_name text NOT NULL DEFAULT '',
  property_address text NOT NULL DEFAULT '',
  unit_number text DEFAULT NULL,
  charge_type text NOT NULL DEFAULT 'rent',
  description text DEFAULT '',
  monthly_amount numeric NOT NULL DEFAULT 0,
  effective_from date DEFAULT NULL,
  effective_to date DEFAULT NULL,
  appfolio_tenant_id text DEFAULT NULL,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.rent_roll_charges ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Authenticated users can read rent roll charges"
ON public.rent_roll_charges
FOR SELECT
USING (is_authenticated_with_role());

CREATE POLICY "Admins can manage rent roll charges"
ON public.rent_roll_charges
FOR ALL
USING (is_admin())
WITH CHECK (is_admin());

-- Index for fast lookups during extraction
CREATE INDEX idx_rent_roll_tenant_property ON public.rent_roll_charges (tenant_name, property_address);
CREATE INDEX idx_rent_roll_unit ON public.rent_roll_charges (unit_number);

-- Trigger for updated_at
CREATE TRIGGER update_rent_roll_charges_updated_at
BEFORE UPDATE ON public.rent_roll_charges
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
