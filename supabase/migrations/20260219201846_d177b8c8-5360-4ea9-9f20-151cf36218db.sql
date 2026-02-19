
-- Add nav_permissions JSONB column to user_roles table
-- This stores which sidebar sections are hidden per user
-- e.g. { "acquisitions": false, "reports": false }
ALTER TABLE public.user_roles
ADD COLUMN IF NOT EXISTS nav_permissions jsonb NOT NULL DEFAULT '{"pipeline": true, "reports_batches": true, "tools": true, "acquisitions": true, "admin": true}'::jsonb;

-- Update the existing admin policies to cover this column (already covered by existing ALL policy)
-- No new RLS needed since existing policies cover user_roles updates by admins
