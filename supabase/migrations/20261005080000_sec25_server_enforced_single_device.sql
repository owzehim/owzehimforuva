-- SEC-25: bind each member account to the signed Supabase Auth session ID.

BEGIN;

REVOKE UPDATE (session_token) ON TABLE public.members FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_current_device_session()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN (SELECT auth.uid()) IS NULL THEN false
    WHEN EXISTS (
      SELECT 1 FROM public.admin_roles AS role_row
      WHERE role_row.user_id = (SELECT auth.uid())
    ) THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.members AS member_row
      WHERE member_row.user_id = (SELECT auth.uid())
        AND member_row.session_token = (SELECT auth.jwt() ->> 'session_id')
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
  IF caller_id IS NULL OR (SELECT auth.jwt() ->> 'aal') <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 authentication is required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = caller_id) THEN
    RETURN true;
  END IF;
  IF caller_session IS NULL OR caller_session = '' THEN
    RETURN false;
  END IF;

  UPDATE public.members
  SET session_token = caller_session
  WHERE user_id = caller_id;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.is_current_device_session() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_single_device_session() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_device_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_single_device_session() TO authenticated;

DO $$
DECLARE
  target record;
  policy_name text := 'SEC25 active device session';
BEGIN
  FOR target IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity IS TRUE
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies AS policy
      WHERE policy.schemaname = target.schemaname
        AND policy.tablename = target.tablename
        AND policy.policyname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.is_current_device_session()) WITH CHECK (public.is_current_device_session())',
        policy_name, target.schemaname, target.tablename
      );
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM pg_class
       WHERE oid = 'storage.objects'::regclass AND relrowsecurity IS TRUE
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND policyname = 'SEC25 active device session'
     ) THEN
    CREATE POLICY "SEC25 active device session"
      ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.is_current_device_session())
      WITH CHECK (public.is_current_device_session());
  END IF;
END;
$$;

COMMIT;
