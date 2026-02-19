
-- Create charge_details table to store AppFolio charge detail data with GL account info
CREATE TABLE public.charge_details (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  charge_date DATE NULL,
  account_number TEXT NOT NULL DEFAULT '',
  account_name TEXT NOT NULL DEFAULT '',
  charged_to TEXT NOT NULL DEFAULT '',
  charge_amount NUMERIC NOT NULL DEFAULT 0,
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  unit TEXT NULL,
  property_address TEXT NOT NULL DEFAULT '',
  reference TEXT NULL,
  receipt_date DATE NULL,
  appfolio_tenant_id TEXT NULL,
  is_subsidy BOOLEAN NOT NULL DEFAULT false,
  subsidy_provider TEXT NULL,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.charge_details ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can read charge details"
  ON public.charge_details FOR SELECT
  USING (is_authenticated_with_role());

CREATE POLICY "Admins can manage charge details"
  ON public.charge_details FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Indexes for matching
CREATE INDEX idx_charge_details_tenant ON public.charge_details (charged_to);
CREATE INDEX idx_charge_details_property ON public.charge_details (property_address);
CREATE INDEX idx_charge_details_account ON public.charge_details (account_name);
CREATE INDEX idx_charge_details_subsidy ON public.charge_details (is_subsidy) WHERE is_subsidy = true;

-- Trigger for updated_at
CREATE TRIGGER update_charge_details_updated_at
  BEFORE UPDATE ON public.charge_details
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add subsidy_provider column to receipts
ALTER TABLE public.receipts ADD COLUMN subsidy_provider TEXT NULL;
