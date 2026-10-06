-- Test accounts are explicitly allowlisted by user ID and may intentionally
-- have no members row. Let those accounts enter the app without weakening the
-- session gate for ordinary users.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_current_device_session()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN (SELECT auth.uid()) IS NULL
      OR coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false) IS NOT TRUE THEN false
    WHEN EXISTS (
      SELECT 1 FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = (SELECT auth.uid())
    ) THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.login_otp_exempt_users AS exempt
      WHERE exempt.user_id = (SELECT auth.uid())
        AND exempt.reason = 'test'
    ) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.members AS member
      WHERE member.user_id = (SELECT auth.uid())
        AND member.session_token = (SELECT auth.jwt() ->> 'session_id')
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.claim_single_device_session()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  caller_id uuid := (SELECT auth.uid());
  caller_session text := (SELECT auth.jwt() ->> 'session_id');
  changed_rows integer;
BEGIN
  IF caller_id IS NULL
     OR coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Authorized application login is required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = caller_id)
     OR EXISTS (
       SELECT 1 FROM public.login_otp_exempt_users
       WHERE user_id = caller_id AND reason = 'test'
     ) THEN
    RETURN true;
  END IF;

  IF caller_session IS NULL OR caller_session = '' THEN RETURN false; END IF;
  UPDATE public.members SET session_token = caller_session WHERE user_id = caller_id;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows = 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_current_device_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_single_device_session() TO authenticated;

COMMIT;
