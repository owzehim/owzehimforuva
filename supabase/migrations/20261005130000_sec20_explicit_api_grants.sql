-- SEC-20 follow-up: reset API-role table and column ACLs, then grant only the
-- operations used by the current client. RLS policies remain the row-level
-- authorization boundary. Run after the SEC-01..SEC-19/SEC-25 schema changes.

BEGIN;

-- Remove legacy table-level grants and column-level grants alike. The latter
-- survive REVOKE on the table, so clear them explicitly before rebuilding the
-- small, documented API surface below.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  target record;
  column_row record;
BEGIN
  FOR target IN
    SELECT relation.relname AS table_name
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    FOR column_row IN
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = target.table_name
    LOOP
      EXECUTE format(
        'REVOKE ALL PRIVILEGES (%I) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        column_row.column_name, target.table_name
      );
    END LOOP;
  END LOOP;
END;
$$;

-- Anonymous access is limited to the public restaurant directory.
GRANT SELECT ON TABLE public.restaurants TO anon;

-- Authenticated reads required by member/admin screens. RLS still limits rows.
GRANT SELECT ON TABLE
  public.admin_roles,
  public.events,
  public.members,
  public.redemptions,
  public.reviews,
  public.review_prompts,
  public.restaurants,
  public.stamp_card_config,
  public.stamp_card_rewards,
  public.stamp_card_visits
TO authenticated;
-- Review creation remains a browser workflow. The SEC-21 INSERT policy binds
-- each row to the caller's own completed redemption; retain that operation
-- after resetting the broad legacy ACLs.
GRANT INSERT ON TABLE public.reviews TO authenticated;

-- The recent-visit/review-prompt UI only needs the public display fields.
GRANT SELECT (id, name)
  ON TABLE public.partnerships TO authenticated;

-- Member self-service columns are already narrowed by SEC-03/SEC-25. Keep the
-- existing column-level UPDATE grants, while admin-only DELETE remains RLS
-- protected. No client INSERT is allowed; registration uses Edge Functions.
GRANT DELETE ON TABLE public.members TO authenticated;
GRANT UPDATE (username, profile_image_url, tutorial_completed_at)
  ON TABLE public.members TO authenticated;

-- Admin-only content management and prompt status changes; each remains
-- protected by the matching RLS policy.
GRANT INSERT, UPDATE, DELETE ON TABLE public.events, public.restaurants
  TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.stamp_card_config TO authenticated;
GRANT UPDATE (status) ON TABLE public.review_prompts TO authenticated;

-- Member-generated content and reports. Raw comment/note reads stay limited
-- to their row IDs for PostgREST write filters; reads go through safe views.
GRANT INSERT, UPDATE, DELETE ON TABLE
  public.restaurant_comments,
  public.restaurant_notes
TO authenticated;
GRANT SELECT (id) ON TABLE
  public.restaurant_comments,
  public.restaurant_notes
TO authenticated;
GRANT INSERT, SELECT ON TABLE
  public.restaurant_comment_reports,
  public.restaurant_note_reports
TO authenticated;
GRANT UPDATE (reviewed_at, reviewed_by)
  ON TABLE public.restaurant_comment_reports,
              public.restaurant_note_reports
  TO authenticated;

-- Sanitized views are the only client read paths for comments/notes.
DO $$
BEGIN
  IF to_regclass('public.restaurant_comments_safe') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON TABLE public.restaurant_comments_safe TO authenticated';
  END IF;
  IF to_regclass('public.restaurant_notes_safe') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON TABLE public.restaurant_notes_safe TO authenticated';
  END IF;
END;
$$;

-- No API role should use public sequences. Trusted server functions retain
-- access to tables, sequences, and functions needed by Edge Function jobs.
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
-- Keep administrator audit records append-only for Edge Functions.
REVOKE ALL PRIVILEGES ON TABLE public.admin_action_audit FROM service_role;
GRANT SELECT, INSERT ON TABLE public.admin_action_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.admin_action_audit_id_seq TO service_role;

-- Remove implicit function execution, then restore the two client RPCs that
-- are intentionally part of the app API. Follow-up migrations grant the
-- authenticated session RPCs they add later in migration order.
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_device_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_single_device_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_store_review_summaries(text[])
  TO anon, authenticated, service_role;

-- Keep future objects created by postgres closed to API roles by default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee = 'anon'
      AND NOT (table_name = 'restaurants' AND privilege_type = 'SELECT')
  ) THEN
    RAISE EXCEPTION 'SEC-20: anon has an unexpected public-table grant';
  END IF;

  -- Table-level grants do not appear in pg_attribute.attacl. Inspect direct
  -- column ACLs separately so legacy grants (for example members.session_token
  -- UPDATE or partnerships.sheet_name SELECT) cannot survive unnoticed.
  IF EXISTS (
    SELECT 1
    FROM pg_attribute AS attribute
    JOIN pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(attribute.attacl) AS column_acl
    LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = column_acl.grantee
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attacl IS NOT NULL
      AND (
        column_acl.grantee = 0
        OR grantee_role.rolname IN ('anon', 'authenticated')
      )
      AND NOT (
        (grantee_role.rolname = 'authenticated'
          AND relation.relname = 'members'
          AND attribute.attname IN ('username', 'profile_image_url', 'tutorial_completed_at')
          AND column_acl.privilege_type = 'UPDATE')
        OR (grantee_role.rolname = 'authenticated'
          AND relation.relname = 'partnerships'
          AND attribute.attname IN ('id', 'name')
          AND column_acl.privilege_type = 'SELECT')
        OR (grantee_role.rolname = 'authenticated'
          AND relation.relname IN ('restaurant_comments', 'restaurant_notes')
          AND attribute.attname = 'id'
          AND column_acl.privilege_type = 'SELECT')
        OR (grantee_role.rolname = 'authenticated'
          AND relation.relname IN ('restaurant_comment_reports', 'restaurant_note_reports')
          AND attribute.attname IN ('reviewed_at', 'reviewed_by')
          AND column_acl.privilege_type = 'UPDATE')
      )
  ) THEN
    RAISE EXCEPTION 'SEC-20: unexpected public-schema column privilege remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND has_function_privilege('anon', routine.oid, 'EXECUTE')
      AND routine.oid <> to_regprocedure('public.get_store_review_summaries(text[])')
  ) THEN
    RAISE EXCEPTION 'SEC-20: anon can execute an unexpected public function';
  END IF;

  IF has_table_privilege('anon', 'public.members', 'SELECT')
     OR has_table_privilege('anon', 'public.members', 'INSERT')
     OR has_table_privilege('authenticated', 'public.members', 'INSERT')
     OR has_table_privilege('authenticated', 'public.stamp_card_visits', 'INSERT')
     OR has_table_privilege('authenticated', 'public.stamp_card_rewards', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.redemptions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.members', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.events', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.restaurants', 'TRIGGER')
     OR has_table_privilege('service_role', 'public.admin_action_audit', 'UPDATE')
     OR has_table_privilege('service_role', 'public.admin_action_audit', 'DELETE')
     OR has_table_privilege('service_role', 'public.admin_action_audit', 'TRUNCATE') THEN
    RAISE EXCEPTION 'SEC-20: unexpected API-role table privilege remains';
  END IF;

  IF NOT has_table_privilege('anon', 'public.restaurants', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.events', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.restaurant_comments', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.reviews', 'INSERT')
     OR has_table_privilege('anon', 'public.reviews', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'public.members', 'username', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.members', 'is_member', 'UPDATE') THEN
    RAISE EXCEPTION 'SEC-20: required app privilege missing or sensitive member update allowed';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.is_current_device_session()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.claim_single_device_session()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.is_admin()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.claim_single_device_session()', 'EXECUTE') THEN
    RAISE EXCEPTION 'SEC-20: client RPC privileges are not correctly restricted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND has_function_privilege('authenticated', routine.oid, 'EXECUTE')
      AND routine.oid NOT IN (
        to_regprocedure('public.is_admin()'),
        to_regprocedure('public.is_current_device_session()'),
        to_regprocedure('public.claim_single_device_session()'),
        to_regprocedure('public.get_store_review_summaries(text[])')
      )
  ) THEN
    RAISE EXCEPTION 'SEC-20: authenticated can execute an unexpected public function';
  END IF;
END;
$$;

COMMIT;
