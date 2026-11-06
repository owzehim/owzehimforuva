-- SEC-41 + PERF-10 (CITS report v2/v3): small database cleanup. No change to
-- who may read or write what.
--
-- 1. SEC-41: remove the trigger that kept only the newest 10 comments per
--    place by deleting other members' comments. The comments feature is no
--    longer used in the app (notes replaced it; their trigger was already
--    removed), and old rows are covered by the retention policy.
-- 2. PERF-10: RLS policies that call auth.uid() directly re-run it for every
--    row. Wrap each call as (SELECT auth.uid()) so it runs once per query.
--    Only the expressions are rewritten; commands, roles and logic stay the
--    same. Policies that already use the wrapped form are left untouched.

BEGIN;

DROP TRIGGER IF EXISTS keep_ten_restaurant_comments ON public.restaurant_comments;
DROP FUNCTION IF EXISTS public.keep_ten_restaurant_comments();

DO $wrap$
DECLARE
  policy record;
  using_expr text;
  check_expr text;
  statement text;
BEGIN
  FOR policy IN
    SELECT n.nspname, c.relname, p.polname,
           pg_get_expr(p.polqual, p.polrelid) AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
    FROM pg_policy AS p
    JOIN pg_class AS c ON c.oid = p.polrelid
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (
        (pg_get_expr(p.polqual, p.polrelid) ~ 'auth\.uid\(\)'
          AND pg_get_expr(p.polqual, p.polrelid) !~ 'SELECT auth\.uid\(\)')
        OR (pg_get_expr(p.polwithcheck, p.polrelid) ~ 'auth\.uid\(\)'
          AND pg_get_expr(p.polwithcheck, p.polrelid) !~ 'SELECT auth\.uid\(\)')
      )
  LOOP
    using_expr := CASE WHEN policy.qual IS NULL THEN NULL
      ELSE regexp_replace(policy.qual, 'auth\.uid\(\)', '( SELECT auth.uid() AS uid)', 'g') END;
    check_expr := CASE WHEN policy.with_check IS NULL THEN NULL
      ELSE regexp_replace(policy.with_check, 'auth\.uid\(\)', '( SELECT auth.uid() AS uid)', 'g') END;

    statement := format('ALTER POLICY %I ON %I.%I', policy.polname, policy.nspname, policy.relname);
    IF using_expr IS NOT NULL THEN
      statement := statement || format(' USING (%s)', using_expr);
    END IF;
    IF check_expr IS NOT NULL THEN
      statement := statement || format(' WITH CHECK (%s)', check_expr);
    END IF;
    EXECUTE statement;
  END LOOP;
END
$wrap$;

COMMIT;
