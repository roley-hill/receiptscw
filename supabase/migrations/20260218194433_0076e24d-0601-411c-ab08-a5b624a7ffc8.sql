
-- Table to cache tenant data from AppFolio
CREATE TABLE public.appfolio_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appfolio_id text NOT NULL UNIQUE,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  full_name text GENERATED ALWAYS AS (TRIM(first_name || ' ' || last_name)) STORED,
  property_id text,
  unit_id text,
  property_address text,
  unit_number text,
  status text DEFAULT 'active',
  email text,
  phone text,
  move_in_on date,
  move_out_on date,
  company_name text,
  primary_tenant boolean DEFAULT false,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.appfolio_tenants ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read tenants
CREATE POLICY "Authenticated users can read appfolio tenants"
ON public.appfolio_tenants FOR SELECT
USING (public.is_authenticated_with_role());

-- Only admins can manage tenant records (sync process uses service role)
CREATE POLICY "Admins can manage appfolio tenants"
ON public.appfolio_tenants FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Index for fast lookups during AI matching
CREATE INDEX idx_appfolio_tenants_full_name ON public.appfolio_tenants (full_name);
CREATE INDEX idx_appfolio_tenants_property ON public.appfolio_tenants (property_address);
CREATE INDEX idx_appfolio_tenants_status ON public.appfolio_tenants (status);

-- Trigger for updated_at
CREATE TRIGGER update_appfolio_tenants_updated_at
BEFORE UPDATE ON public.appfolio_tenants
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
