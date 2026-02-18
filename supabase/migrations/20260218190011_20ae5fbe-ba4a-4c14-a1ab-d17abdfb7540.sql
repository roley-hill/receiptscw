
-- Create a view that masks admin emails for non-admin users
CREATE OR REPLACE VIEW public.profiles_safe
WITH (security_invoker = on) AS
SELECT
  p.id,
  p.user_id,
  p.created_at,
  p.updated_at,
  p.display_name,
  CASE
    WHEN public.has_role(p.user_id, 'admin') AND NOT public.is_admin()
    THEN '********'
    ELSE p.email
  END AS email
FROM public.profiles p;
