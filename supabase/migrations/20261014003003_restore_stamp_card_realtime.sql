-- Restore the two stamp-card change streams used by the app.
-- Row-level security limits Postgres Changes payloads to rows the subscriber
-- can read; require RLS and authenticated SELECT before publishing either table.

BEGIN;

DO $$
DECLARE
  target_name text;
  target_oid oid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'supabase_realtime publication does not exist';
  END IF;

  FOREACH target_name IN ARRAY ARRAY['stamp_card_visits', 'stamp_card_rewards']
  LOOP
    target_oid := to_regclass(format('public.%I', target_name));

    IF target_oid IS NULL THEN
      RAISE EXCEPTION 'Required table public.% does not exist', target_name;
    END IF;

    IF NOT (
      SELECT relrowsecurity
      FROM pg_class
      WHERE oid = target_oid
    ) OR NOT has_table_privilege('authenticated', target_oid, 'SELECT') THEN
      RAISE EXCEPTION 'Required RLS or authenticated SELECT is missing on public.%', target_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = target_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', target_name);
    END IF;
  END LOOP;
END;
$$;

COMMIT;
