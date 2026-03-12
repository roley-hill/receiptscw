-- Clean up the partially created bulk batch so the user can retry
-- First unassign receipts from the child batches
UPDATE receipts SET batch_id = NULL WHERE batch_id IN (
  SELECT id FROM deposit_batches WHERE parent_batch_id = 'e160704f-cc44-4d7f-bc4d-9bdffc28a62a'
);

-- Delete child batches
DELETE FROM deposit_batches WHERE parent_batch_id = 'e160704f-cc44-4d7f-bc4d-9bdffc28a62a';

-- Delete parent batch
DELETE FROM deposit_batches WHERE id = 'e160704f-cc44-4d7f-bc4d-9bdffc28a62a';