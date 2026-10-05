-- SEC-06: only trusted server code may create rows in public.members.
-- Self-service registration is finalized by complete-member-registration
-- after email confirmation; administrator-created rows use admin-create-member.

BEGIN;

DO $$
DECLARE
  member_policy record;
BEGIN
  IF to_regclass('public.members') IS NULL THEN
    RAISE EXCEPTION 'SEC-06 could not find public.members';
  END IF;

  -- Remove every INSERT or ALL policy, including the legacy permissive admin
  -- policy and the constrained self-registration policies from SEC-03.
  FOR member_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'members'
      AND cmd IN ('INSERT', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.members', member_policy.policyname);
  END LOOP;

END;
$$;

-- Revoke table-level and any column-level INSERT grants. Do not revoke the
-- service_role; its key is only used in trusted Edge Functions.
REVOKE INSERT ON TABLE public.members FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  member_columns text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
  INTO member_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'members';

  IF member_columns IS NULL THEN
    RAISE EXCEPTION 'SEC-06 could not find public.members columns';
  END IF;

  EXECUTE format(
    'REVOKE INSERT (%s) ON TABLE public.members FROM PUBLIC, anon, authenticated',
    member_columns
  );
END;
$$;

COMMIT;
