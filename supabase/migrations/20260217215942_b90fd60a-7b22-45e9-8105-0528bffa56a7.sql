
-- Add appfolio_recorded flag to receipts
ALTER TABLE public.receipts ADD COLUMN appfolio_recorded boolean NOT NULL DEFAULT false;
ALTER TABLE public.receipts ADD COLUMN appfolio_recorded_at timestamp with time zone;
ALTER TABLE public.receipts ADD COLUMN appfolio_recorded_by uuid;
