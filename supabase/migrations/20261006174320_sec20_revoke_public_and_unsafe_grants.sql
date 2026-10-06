-- SEC-20: remove broad API-role grants that are not needed by the app.
-- Keep the anonymous restaurant directory read, and let RLS continue to
-- govern authenticated row-level operations.
BEGIN;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;

-- Table-level revokes do not clear direct column ACLs.
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
        'REVOKE ALL PRIVILEGES (%I) ON TABLE public.%I FROM PUBLIC, anon',
        column_row.column_name, target.table_name
      );
    END LOOP;
  END LOOP;
END;
$$;

GRANT SELECT ON TABLE public.restaurants TO anon;

-- RLS still governs row reads and app writes. Remove operations that bypass
-- RLS or expose internal fields, and are not part of the client API.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public
  FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (session_token) ON TABLE public.members
  FROM PUBLIC, anon, authenticated;
REVOKE SELECT (sheet_name) ON TABLE public.partnerships
  FROM PUBLIC, anon, authenticated;

-- Prevent new postgres-owned public objects from inheriting broad API access.
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
    RAISE EXCEPTION 'SEC-20: anonymous has an unexpected public table grant';
  END IF;

  IF has_table_privilege('anon', 'public.members', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.members', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.events', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.events', 'TRUNCATE')
     OR has_column_privilege('authenticated', 'public.members', 'session_token', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.partnerships', 'sheet_name', 'SELECT') THEN
    RAISE EXCEPTION 'SEC-20: unsafe API privilege remains';
  END IF;

  IF NOT has_table_privilege('anon', 'public.restaurants', 'SELECT') THEN
    RAISE EXCEPTION 'SEC-20: public restaurant directory read was removed';
  END IF;
END;
$$;

COMMIT;
