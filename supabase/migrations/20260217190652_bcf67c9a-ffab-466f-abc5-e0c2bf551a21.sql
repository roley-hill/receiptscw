
DROP POLICY "Admins can delete receipts" ON public.receipts;

CREATE POLICY "Processors can delete receipts"
ON public.receipts
FOR DELETE
TO authenticated
USING (is_processor_or_above());
