-- Auto-delete skipped_duplicates when the referenced receipt is deleted
CREATE OR REPLACE FUNCTION public.cascade_delete_skipped_duplicates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.skipped_duplicates
  WHERE existing_receipt_uuid = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_cascade_delete_skipped_duplicates
BEFORE DELETE ON public.receipts
FOR EACH ROW
EXECUTE FUNCTION public.cascade_delete_skipped_duplicates();
