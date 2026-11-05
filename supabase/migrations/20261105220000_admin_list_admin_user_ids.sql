-- Admin panel: show which members are administrators (관리자 / 일반 tabs).
--
-- admin_roles RLS still only lets a user read their own row. This function
-- returns the admin user IDs, and only to a caller who is an admin
-- (is_admin() also requires the app_access login claim). Non-admins get an
-- empty result. Read-only; nothing else changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_admin_user_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT admin_role.user_id
  FROM public.admin_roles AS admin_role
  WHERE public.is_admin();
$function$;

REVOKE ALL ON FUNCTION public.admin_list_admin_user_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_admin_user_ids() TO authenticated;

COMMIT;
