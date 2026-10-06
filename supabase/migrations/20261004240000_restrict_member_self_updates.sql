-- SEC-03: members may edit only profile/session fields on their own row.
-- Membership and account-state changes are performed only by the authenticated
-- admin-update-member Edge Function, which checks admin_roles server-side.

BEGIN;

-- Fail before changing anything if this project has a different members schema.
DO $$
DECLARE
  required_columns text[] := ARRAY[
    'id',
    'user_id',
    'first_name',
    'last_name',
    'student_number',
    'major',
    'year_of_birth',
    'gender',
    'country_of_origin',
    'University',
    'education_level',
    'year_number',
    'is_member',
    'membership_valid_until',
    'account_status',
    'is_test_account',
    'identity_anonymized_at',
    'membership_ended_at',
    'session_token',
    'username',
    'profile_image_url',
    'tutorial_completed_at'
  ];
  missing_columns text;
BEGIN
  SELECT string_agg(expected.column_name, ', ' ORDER BY expected.column_name)
  INTO missing_columns
  FROM unnest(required_columns) AS expected(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS actual
    WHERE actual.table_schema = 'public'
      AND actual.table_name = 'members'
      AND actual.column_name = expected.column_name
  );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION
      'SEC-03 expected members columns are missing: %',
      missing_columns;
  END IF;
END;
$$;

-- Replace all row-level UPDATE policies with one explicit self/admin rule.
DO $$
DECLARE
  member_policy record;
BEGIN
  FOR member_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'members'
      AND cmd IN ('UPDATE', 'ALL')
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.members',
      member_policy.policyname
    );
  END LOOP;
END;
$$;

CREATE POLICY "Members and admins can update member rows"
  ON public.members FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin())
  WITH CHECK (user_id = (SELECT auth.uid()) OR public.is_admin());

-- Prevent both anon and authenticated self-registration from creating an
-- already-active, test, anonymized, or otherwise privileged member row.
DO $$
DECLARE
  member_policy record;
BEGIN
  FOR member_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'members'
      AND cmd IN ('INSERT', 'ALL')
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.members',
      member_policy.policyname
    );
  END LOOP;
END;
$$;

CREATE POLICY "Anon can register inactive members"
  ON public.members FOR INSERT TO anon
  WITH CHECK (
    is_member IS FALSE
    AND membership_valid_until IS NULL
    AND account_status = 'active'
    AND is_test_account IS FALSE
    AND identity_anonymized_at IS NULL
    AND membership_ended_at IS NULL
    AND session_token IS NULL
  );

CREATE POLICY "Members can register inactive profile or admins can add members"
  ON public.members FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (
      user_id = (SELECT auth.uid())
      AND is_member IS FALSE
      AND membership_valid_until IS NULL
      AND account_status = 'active'
      AND is_test_account IS FALSE
      AND identity_anonymized_at IS NULL
      AND membership_ended_at IS NULL
      AND session_token IS NULL
    )
  );

-- Remove table-level and any pre-existing column-level UPDATE grants before
-- granting the small set of fields the member UI currently edits.
REVOKE UPDATE ON TABLE public.members FROM PUBLIC, anon, authenticated;

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
    RAISE EXCEPTION 'SEC-03 could not find public.members columns';
  END IF;

  EXECUTE format(
    'REVOKE UPDATE (%s) ON TABLE public.members FROM PUBLIC, anon, authenticated',
    member_columns
  );
END;
$$;

GRANT UPDATE (username, profile_image_url, tutorial_completed_at, session_token)
  ON TABLE public.members TO authenticated;

COMMIT;
