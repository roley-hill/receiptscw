-- Fix batch_id collisions by using a sequence instead of random()
CREATE SEQUENCE IF NOT EXISTS public.deposit_batch_id_seq START WITH 10000;

ALTER TABLE public.deposit_batches
  ALTER COLUMN batch_id SET DEFAULT ('BATCH-' || LPAD(nextval('public.deposit_batch_id_seq')::text, 5, '0'));