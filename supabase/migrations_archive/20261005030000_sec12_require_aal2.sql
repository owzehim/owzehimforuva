-- SEC-12: the former browser-only email code gate did not protect Supabase
-- sessions. Require a server-issued AAL2 claim for every authenticated RLS
-- operation on tables that already enforce RLS.

BEGIN;

DO $$
DECLARE
  target record;
  policy_name text := 'SEC12 require AAL2 for authenticated access';
BEGIN
  FOR target IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND rowsecurity IS TRUE
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies AS policy
      WHERE policy.schemaname = target.schemaname
        AND policy.tablename = target.tablename
        AND policy.policyname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT auth.jwt() ->> ''aal'') = ''aal2'') WITH CHECK ((SELECT auth.jwt() ->> ''aal'') = ''aal2'')',
        policy_name,
        target.schemaname,
        target.tablename
      );
    END IF;
  END LOOP;
END;
$$;

-- Storage uses its own RLS schema and is not covered by the public-table loop.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM pg_class
       WHERE oid = 'storage.objects'::regclass AND relrowsecurity IS TRUE
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'storage'
         AND tablename = 'objects'
         AND policyname = 'SEC12 require AAL2 for authenticated access'
     ) THEN
    CREATE POLICY "SEC12 require AAL2 for authenticated access"
      ON storage.objects
      AS RESTRICTIVE
      FOR ALL
      TO authenticated
      USING ((SELECT auth.jwt() ->> 'aal') = 'aal2')
      WITH CHECK ((SELECT auth.jwt() ->> 'aal') = 'aal2');
  END IF;
END;
$$;

COMMIT;
