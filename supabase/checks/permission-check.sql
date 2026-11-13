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
    'authenticated|restaurant_comments|S',
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
  -- OPS-19: for tables where members may only touch some columns, the exact
  -- INSERT/UPDATE column lists ('*' = whole table). A table-wide grant
  -- creeping back (e.g. SEC-55 regression on notes) fails the check.
  expected_column_privileges text[] := ARRAY[
    'authenticated|members|INSERT|',
    'authenticated|members|UPDATE|profile_image_url,tutorial_completed_at,username',
    -- partnerships also holds legacy Apps Script address columns: id and name only.
    'authenticated|partnerships|SELECT|id,name',
    'authenticated|restaurant_comment_reports|INSERT|comment_id,reporter_id',
    'authenticated|restaurant_comment_reports|UPDATE|reviewed_at,reviewed_by',
    'authenticated|restaurant_comments|INSERT|',
    'authenticated|restaurant_comments|UPDATE|',
    'authenticated|restaurant_note_reports|INSERT|explanation,good_faith,note_id,reason,reporter_id,reporter_name',
    'authenticated|restaurant_note_reports|UPDATE|decision,reviewed_at,reviewed_by,status',
    'authenticated|restaurant_notes|INSERT|body,is_anonymous,restaurant_id,source_rating,source_redemption_id,source_review_id,source_store_id,source_tags,user_id,username',
    'authenticated|restaurant_notes|UPDATE|body,hidden_at,is_anonymous',
    'authenticated|review_prompts|INSERT|',
    'authenticated|review_prompts|UPDATE|status',
    'authenticated|reviews|UPDATE|'
  ];
  expected_anon_functions text[] := ARRAY[
    'get_store_review_summaries'
  ];
  expected_authenticated_functions text[] := ARRAY[
    'admin_checkin_review',
    'admin_list_admin_user_ids',
    'admin_partner_sheet_link_issues',
    'admin_set_checkin_review',
    'claim_single_device_session',
    'get_member_store_review_summaries',
    'get_store_review_summaries',
    'is_admin',
    'is_current_device_session'
  ];
  -- Views members may read. Views not listed here must not be readable.
  expected_view_readers text[] := ARRAY[
    'authenticated|restaurant_comments_safe',
    'authenticated|restaurant_notes_safe'
  ];
  -- Views that run with the owner's rights on purpose (they show other
  -- members' notes with safe columns only). Every other view must be
  -- security_invoker.
  expected_definer_views text[] := ARRAY['restaurant_comments_safe', 'restaurant_notes_safe'];
  -- Storage: the exact policy set on storage.objects, and which buckets are public.
  expected_storage_policies text[] := ARRAY[
    'Require app login for profile images',
    'SEC07 admin manage event images',
    'SEC07 admin manage place images',
    'SEC07 admin manage profile images',
    'SEC07 admin manage stamp card wallpapers',
    'SEC07 profile owner delete own avatar',
    'SEC07 profile owner read own avatar',
    'SEC07 profile owner replace own avatar',
    'SEC07 profile owner upload own avatar'
  ];
  expected_buckets text[] := ARRAY[
    'event-images|public',
    'place-images|public',
    'profile-images|private',
    'public-assets|public',
    'stamp-card-wallpapers|public'
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

  WITH expected AS (
    SELECT e AS entry, split_part(e, '|', 1) AS role_name, split_part(e, '|', 2) AS table_name, split_part(e, '|', 3) AS priv
    FROM unnest(expected_column_privileges) AS e
  ),
  actual AS (
    SELECT x.entry,
      x.role_name || '|' || x.table_name || '|' || x.priv || '|' ||
      CASE WHEN has_table_privilege(x.role_name, c.oid, x.priv) THEN '*'
      ELSE coalesce((
        SELECT string_agg(a.attname, ',' ORDER BY a.attname)
        FROM pg_attribute AS a
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          AND has_column_privilege(x.role_name, c.oid, a.attnum, x.priv)
      ), '') END AS actual_entry
    FROM expected AS x
    JOIN pg_class AS c ON c.relname = x.table_name
    JOIN pg_namespace AS n ON n.oid = c.relnamespace AND n.nspname = 'public'
  )
  SELECT string_agg(actual_entry || ' (expected ' || entry || ')', ', ' ORDER BY entry)
    INTO unexpected
  FROM actual WHERE actual_entry <> entry;
  IF unexpected IS NOT NULL THEN problems := problems || ('column privileges differ: ' || unexpected); END IF;

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

  -- Sequences: anon/authenticated need none (only the server inserts rows).
  SELECT string_agg(r.role_name || '|' || c.relname, ', ' ORDER BY c.relname)
    INTO unexpected
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace AND n.nspname = 'public'
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
  WHERE c.relkind = 'S'
    AND (has_sequence_privilege(r.role_name, c.oid, 'USAGE')
      OR has_sequence_privilege(r.role_name, c.oid, 'SELECT')
      OR has_sequence_privilege(r.role_name, c.oid, 'UPDATE'));
  IF unexpected IS NOT NULL THEN problems := problems || ('sequence privileges for anon/authenticated: ' || unexpected); END IF;

  -- Views: who may read them, and which may bypass row-level security.
  WITH v AS (
    SELECT c.oid, c.relname, coalesce(c.reloptions::text[], ARRAY[]::text[]) AS opts
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind IN ('v', 'm')
  ),
  readers AS (
    SELECT r.role_name || '|' || v.relname AS entry
    FROM v CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
    WHERE has_table_privilege(r.role_name, v.oid, 'SELECT')
  )
  SELECT
    (SELECT string_agg(entry, ', ' ORDER BY entry) FROM readers WHERE entry <> ALL (expected_view_readers)),
    (SELECT string_agg(relname, ', ' ORDER BY relname) FROM v
      WHERE NOT ('security_invoker=true' = ANY (opts) OR 'security_invoker=on' = ANY (opts))
        AND relname <> ALL (expected_definer_views))
  INTO unexpected, absent;
  IF unexpected IS NOT NULL THEN problems := problems || ('unexpected view readers: ' || unexpected); END IF;
  IF absent IS NOT NULL THEN problems := problems || ('views without security_invoker: ' || absent); END IF;

  -- Storage policies and public buckets.
  SELECT
    (SELECT string_agg(policyname, ', ' ORDER BY policyname) FROM pg_policies
      WHERE schemaname = 'storage' AND policyname <> ALL (expected_storage_policies)),
    (SELECT string_agg(e, ', ' ORDER BY e) FROM unnest(expected_storage_policies) AS e
      WHERE e NOT IN (SELECT policyname FROM pg_policies WHERE schemaname = 'storage'))
  INTO unexpected, absent;
  IF unexpected IS NOT NULL THEN problems := problems || ('unexpected storage policies: ' || unexpected); END IF;
  IF absent IS NOT NULL THEN problems := problems || ('expected storage policies missing: ' || absent); END IF;

  SELECT string_agg(entry, ', ' ORDER BY entry)
    INTO unexpected
  FROM (
    SELECT b.id || '|' || CASE WHEN b.public THEN 'public' ELSE 'private' END AS entry FROM storage.buckets AS b
  ) AS actual_buckets
  WHERE entry <> ALL (expected_buckets);
  IF unexpected IS NOT NULL THEN problems := problems || ('unexpected buckets or bucket visibility: ' || unexpected); END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'Database permission check failed: %', array_to_string(problems, ' | ');
  END IF;
  RAISE NOTICE 'Database permission check passed (% table privilege entries, RLS on every table).', cardinality(expected_table_privileges);
END
$check$;

ROLLBACK;
