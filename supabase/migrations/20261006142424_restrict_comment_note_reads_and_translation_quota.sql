-- Restrict raw comment/note reads to the current user's rows. Shared display
-- data remains available through the guarded, sanitized views.

BEGIN;

REVOKE SELECT ON TABLE public.restaurant_comments, public.restaurant_notes
  FROM PUBLIC, anon, authenticated;
DO $$
DECLARE
  target_table regclass;
  target_column record;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'public.restaurant_comments'::regclass,
    'public.restaurant_notes'::regclass
  ]
  LOOP
    FOR target_column IN
      SELECT attname
      FROM pg_attribute
      WHERE attrelid = target_table
        AND attnum > 0
        AND NOT attisdropped
    LOOP
      EXECUTE format(
        'REVOKE SELECT (%I) ON TABLE %s FROM PUBLIC, anon, authenticated',
        target_column.attname,
        target_table
      );
    END LOOP;
  END LOOP;
END;
$$;
GRANT SELECT ON TABLE public.restaurant_comments, public.restaurant_notes
  TO authenticated;

DROP POLICY IF EXISTS "Authenticated members can read restaurant comments"
  ON public.restaurant_comments;
DROP POLICY IF EXISTS "Authenticated members can read restaurant notes"
  ON public.restaurant_notes;
DROP POLICY IF EXISTS "Members can read own restaurant comments"
  ON public.restaurant_comments;
DROP POLICY IF EXISTS "Members can read own restaurant notes"
  ON public.restaurant_notes;
CREATE POLICY "Members can read own restaurant comments"
  ON public.restaurant_comments
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Members can read own restaurant notes"
  ON public.restaurant_notes
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "require_app_login" ON public.restaurant_comments;
DROP POLICY IF EXISTS "require_app_login" ON public.restaurant_notes;
CREATE POLICY "require_app_login"
  ON public.restaurant_comments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false)
    AND (SELECT public.is_current_device_session())
  )
  WITH CHECK (
    coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false)
    AND (SELECT public.is_current_device_session())
  );
CREATE POLICY "require_app_login"
  ON public.restaurant_notes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false)
    AND (SELECT public.is_current_device_session())
  )
  WITH CHECK (
    coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false)
    AND (SELECT public.is_current_device_session())
  );

-- These views intentionally run with their owner's table access so they can
-- mask other users' private columns. Their definitions require app_access and
-- a current device session.
REVOKE ALL PRIVILEGES ON TABLE
  public.restaurant_comments_safe, public.restaurant_notes_safe
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE
  public.restaurant_comments_safe, public.restaurant_notes_safe
  TO authenticated;

-- No current client or Edge Function calls this retired quota RPC. Keep the
-- service_role grant for trusted server-side compatibility.
ALTER FUNCTION public.reserve_translation_characters(integer)
  SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public.reserve_translation_characters(integer)
  FROM PUBLIC, anon, authenticated;

-- No app client subscribes to these raw tables, so keep full row payloads out
-- of Realtime as an additional privacy boundary.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'restaurant_comments'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.restaurant_comments';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'restaurant_notes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.restaurant_notes';
  END IF;
END;
$$;

COMMIT;
