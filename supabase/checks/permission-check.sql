-- OPS-04 (CITS report v3): database permission check. READ-ONLY.
--
-- Fails if production drifts from the reviewed permission model:
--   1. every public table has row-level security enabled;
--   2. anon / authenticated table privileges are exactly the expected set
--      (S=select, I=insert, U=update, D=delete; column grants count too);
--   3. SECURITY DEFINER functions callable by anon / authenticated are exactly
--      the expected set.
-- RLS policies still decide which rows a member may touch; this check guards
-- the outer layer so a stray GRANT or a table without RLS cannot slip in.
--
-- Run: .github/workflows/database-permission-check.yml (weekly + on demand),
-- or manually: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/permission-check.sql
-- When a migration changes permissions on purpose, update the lists below in
-- the same pull request.

\set ON_ERROR_STOP on
BEGIN READ ONLY;

DO $check$
DECLARE
  expected_table_privileges text[] := ARRAY[
    'anon|restaurants|S',
    'authenticated|admin_roles|S',
    'authenticated|events|SIUD',
    'authenticated|members|SUD',
    'authenticated|partnerships|S',
    'authenticated|redemptions|S',
    'authenticated|restaurant_comment_reports|SIU',
    'authenticated|restaurant_comments|SIUD',
    'authenticated|restaurant_comments_safe|S',
    'authenticated|restaurant_note_reports|SIU',
    'authenticated|restaurant_notes|SIUD',
    'authenticated|restaurant_notes_safe|S',
    'authenticated|restaurants|SIUD',
    'authenticated|review_prompts|SU',
    'authenticated|reviews|SI',
    'authenticated|stamp_card_config|SIU',
    'authenticated|stamp_card_rewards|S',
    'authenticated|stamp_card_visits|S'
  ];
  expected_anon_functions text[] := ARRAY[
    'get_store_review_summaries'
  ];
  expected_authenticated_functions text[] := ARRAY[
    'admin_list_admin_user_ids',
    'can_read_note_author_avatar',
    'claim_single_device_session',
    'get_member_store_review_summaries',
    'get_store_review_summaries',
    'is_admin',
    'is_current_device_session'
  ];
  problems text[] := ARRAY[]::text[];
  missing_rls text;
  unexpected text;
  absent text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO missing_rls
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;
  IF missing_rls IS NOT NULL THEN
    problems := problems || ('tables without RLS: ' || missing_rls);
  END IF;

  WITH t AS (
    SELECT c.oid, c.relname
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
  ),
  roles(role_name) AS (VALUES ('anon'), ('authenticated')),
  actual AS (
    SELECT r.role_name || '|' || t.relname || '|' || concat_ws('',
      CASE WHEN has_table_privilege(r.role_name, t.oid, 'SELECT') OR has_any_column_privilege(r.role_name, t.oid, 'SELECT') THEN 'S' END,
      CASE WHEN has_table_privilege(r.role_name, t.oid, 'INSERT') OR has_any_column_privilege(r.role_name, t.oid, 'INSERT') THEN 'I' END,
      CASE WHEN has_table_privilege(r.role_name, t.oid, 'UPDATE') OR has_any_column_privilege(r.role_name, t.oid, 'UPDATE') THEN 'U' END,
      CASE WHEN has_table_privilege(r.role_name, t.oid, 'DELETE') THEN 'D' END
    ) AS entry
    FROM t CROSS JOIN roles AS r
  ),
  actual_nonempty AS (SELECT entry FROM actual WHERE entry !~ '\|$')
  SELECT
    (SELECT string_agg(entry, ', ' ORDER BY entry) FROM actual_nonempty WHERE entry <> ALL (expected_table_privileges)),
    (SELECT string_agg(e, ', ' ORDER BY e) FROM unnest(expected_table_privileges) AS e WHERE e NOT IN (SELECT entry FROM actual_nonempty))
  INTO unexpected, absent;
  IF unexpected IS NOT NULL THEN problems := problems || ('unexpected table privileges: ' || unexpected); END IF;
  IF absent IS NOT NULL THEN problems := problems || ('expected table privileges missing: ' || absent); END IF;

  WITH f AS (
    SELECT p.oid, p.proname
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  )
  SELECT
    (SELECT string_agg(DISTINCT proname, ', ') FROM f WHERE has_function_privilege('anon', oid, 'EXECUTE') AND proname <> ALL (expected_anon_functions)),
    (SELECT string_agg(DISTINCT proname, ', ') FROM f WHERE has_function_privilege('authenticated', oid, 'EXECUTE') AND proname <> ALL (expected_authenticated_functions))
  INTO unexpected, absent;
  IF unexpected IS NOT NULL THEN problems := problems || ('anon can run unexpected SECURITY DEFINER functions: ' || unexpected); END IF;
  IF absent IS NOT NULL THEN problems := problems || ('authenticated can run unexpected SECURITY DEFINER functions: ' || absent); END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'Database permission check failed: %', array_to_string(problems, ' | ');
  END IF;
  RAISE NOTICE 'Database permission check passed (% table privilege entries, RLS on every table).', cardinality(expected_table_privileges);
END
$check$;

ROLLBACK;
