-- SEC-18 follow-up: the sanitized views deliberately use the view owner's
-- privileges so raw user_id can remain unavailable to clients. Base-table
-- SELECT is revoked from API roles, so changing this to security_invoker would
-- make legitimate view reads fail. Because owner-rights views bypass base-table
-- RLS, enforce MFA and active-session gates directly in both view definitions.

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

-- Keep this follow-up safe to rerun after manual SQL application.
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
GRANT SELECT (id) ON TABLE public.restaurant_comments, public.restaurant_notes
  TO authenticated;
REVOKE ALL ON TABLE public.restaurant_comments_safe, public.restaurant_notes_safe
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.restaurant_comments_safe, public.restaurant_notes_safe
  TO authenticated;

-- The raw tables contain author IDs and must not publish changes to clients.
-- Remove them before the assertion below checks publication membership.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'restaurant_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.restaurant_comments;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
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
