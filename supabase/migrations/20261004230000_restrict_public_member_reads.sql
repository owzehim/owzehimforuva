-- SEC-02: members contains personal data and must never be readable by anon.
-- Member registration still needs anonymous INSERT, but no INSERT response
-- that reads the newly-created row. Authenticated users may read only their
-- own row; administrators are authorized through public.is_admin().

BEGIN;

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

-- Remove every existing SELECT/ALL policy so an old permissive policy cannot
-- combine with the replacement policy using PostgreSQL's permissive OR rules.
DO $$
DECLARE
  member_policy record;
BEGIN
  FOR member_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'members'
      AND cmd IN ('SELECT', 'ALL')
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.members',
      member_policy.policyname
    );
  END LOOP;
END;
$$;

CREATE POLICY "Members and admins can read member rows"
  ON public.members FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

-- Keep public registration working while removing public table read/write
-- privileges beyond the intended insert path.
REVOKE ALL ON TABLE public.members FROM PUBLIC, anon;
GRANT INSERT ON TABLE public.members TO anon;

COMMIT;
