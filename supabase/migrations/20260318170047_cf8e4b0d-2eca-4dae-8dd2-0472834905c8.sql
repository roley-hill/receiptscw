
-- Trigger to prevent unsetting appfolio_recorded once true
CREATE OR REPLACE FUNCTION public.protect_appfolio_recorded()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- If the old value was true and the new value is false, block it
  IF OLD.appfolio_recorded = true AND NEW.appfolio_recorded = false THEN
    NEW.appfolio_recorded := true;
    NEW.appfolio_recorded_at := OLD.appfolio_recorded_at;
    NEW.appfolio_recorded_by := OLD.appfolio_recorded_by;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_appfolio_recorded_trigger
BEFORE UPDATE ON public.receipts
FOR EACH ROW
EXECUTE FUNCTION public.protect_appfolio_recorded();
