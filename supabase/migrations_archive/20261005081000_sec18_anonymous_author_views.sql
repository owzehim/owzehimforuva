-- SEC-18: do not expose member identifiers from anonymous comments or notes.
-- Public member-facing reads use sanitized views; row writes remain subject to
-- the existing owner policies on the base tables.
-- These are intentionally owner-rights views: base-table SELECT is revoked,
-- and column privileges only expose id for PostgREST UPDATE/DELETE filters. The
-- view is the sole read path and returns a sanitized projection. Do not switch
-- to security_invoker; callers lack SELECT on the projected private columns.

BEGIN;

CREATE OR REPLACE VIEW public.restaurant_comments_safe
WITH (security_barrier = true)
AS
SELECT
  comment.id,
  comment.restaurant_id,
  (comment.user_id = (SELECT auth.uid())) AS is_mine,
  CASE WHEN comment.is_anonymous THEN '익명' ELSE comment.username END AS username,
  comment.is_anonymous,
  comment.body,
  comment.created_at,
  comment.updated_at
FROM public.restaurant_comments AS comment
WHERE (SELECT auth.jwt() ->> 'aal') = 'aal2'
  AND public.is_current_device_session();

CREATE OR REPLACE VIEW public.restaurant_notes_safe
WITH (security_barrier = true)
AS
SELECT
  note.id,
  note.restaurant_id,
  (note.user_id = (SELECT auth.uid())) AS is_mine,
  CASE WHEN note.is_anonymous THEN '익명' ELSE note.username END AS username,
  CASE WHEN note.is_anonymous THEN NULL ELSE note.avatar_color_seed END AS avatar_color_seed,
  CASE WHEN note.is_anonymous OR note.user_id <> (SELECT auth.uid()) THEN NULL ELSE note.profile_image_url END AS profile_image_url,
  note.is_anonymous,
  note.body,
  note.created_at,
  note.updated_at,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_redemption_id ELSE NULL END AS source_redemption_id,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_store_id ELSE NULL END AS source_store_id,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_rating ELSE NULL END AS source_rating,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_tags ELSE NULL END AS source_tags
FROM public.restaurant_notes AS note
WHERE (SELECT auth.jwt() ->> 'aal') = 'aal2'
  AND public.is_current_device_session();

-- Remove all API SELECT grants, including any pre-existing column grants.
DO $$
DECLARE
  target record;
  column_row record;
BEGIN
  FOR target IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('restaurant_comments', 'restaurant_notes')
  LOOP
    FOR column_row IN
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = target.table_name
    LOOP
      EXECUTE format(
        'REVOKE SELECT (%I) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        column_row.column_name, target.table_name
      );
    END LOOP;
  END LOOP;
END;
$$;

REVOKE SELECT ON TABLE public.restaurant_comments, public.restaurant_notes
  FROM PUBLIC, anon, authenticated;
-- PostgREST needs SELECT on the filtered key for owner-scoped UPDATE/DELETE.
-- The safe views already expose these non-secret row IDs.
GRANT SELECT (id) ON TABLE public.restaurant_comments, public.restaurant_notes
  TO authenticated;
REVOKE ALL ON TABLE public.restaurant_comments_safe, public.restaurant_notes_safe
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.restaurant_comments_safe, public.restaurant_notes_safe
  TO authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'restaurant_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.restaurant_comments;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'restaurant_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.restaurant_notes;
  END IF;
END;
$$;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.restaurant_comments', 'SELECT')
     OR has_table_privilege('authenticated', 'public.restaurant_comments', 'SELECT')
     OR has_table_privilege('anon', 'public.restaurant_notes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.restaurant_notes', 'SELECT') THEN
    RAISE EXCEPTION 'SEC-18: API roles must not SELECT raw comment/note tables';
  END IF;

  IF has_column_privilege('anon', 'public.restaurant_comments', 'user_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.restaurant_comments', 'user_id', 'SELECT')
     OR has_column_privilege('anon', 'public.restaurant_notes', 'user_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.restaurant_notes', 'user_id', 'SELECT') THEN
    RAISE EXCEPTION 'SEC-18: API roles must not SELECT raw comment/note author IDs';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.restaurant_comments', 'id', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.restaurant_notes', 'id', 'SELECT') THEN
    RAISE EXCEPTION 'SEC-18: authenticated write filters need id SELECT privilege';
  END IF;

  IF has_table_privilege('anon', 'public.restaurant_comments_safe', 'SELECT')
     OR has_table_privilege('anon', 'public.restaurant_notes_safe', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.restaurant_comments_safe', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.restaurant_notes_safe', 'SELECT') THEN
    RAISE EXCEPTION 'SEC-18: safe view SELECT grants are not correctly restricted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN ('restaurant_comments', 'restaurant_notes')
  ) THEN
    RAISE EXCEPTION 'SEC-18: raw author-bearing tables must not publish Realtime changes';
  END IF;
END;
$$;

COMMIT;
