-- SEC-01: centralize administrator authorization on the server-managed
-- admin_roles allowlist. Never promote users based on user_metadata or email.
-- Existing admin_roles rows are retained; metadata roles are deliberately not
-- copied because a user could have assigned that value to themselves.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_roles) THEN
    RAISE EXCEPTION
      'admin_roles is empty; verify and provision a trusted administrator before applying SEC-01';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_roles AS admin_role
    WHERE admin_role.user_id = (SELECT auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- Keep the allowlist readable only by each authenticated user for the app's
-- UI gate. Role assignment remains an operator-only database action.
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_roles TO authenticated;

DROP POLICY IF EXISTS "Public can read own admin role" ON public.admin_roles;
DROP POLICY IF EXISTS "관리자 본인 확인" ON public.admin_roles;
DROP POLICY IF EXISTS "Users can read own admin role" ON public.admin_roles;
CREATE POLICY "Users can read own admin role"
  ON public.admin_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Replace all administrator policies that trusted mutable user metadata or a
-- hard-coded email. Existing self-service policies remain unchanged.
DROP POLICY IF EXISTS "Admin can view all members" ON public.members;
DROP POLICY IF EXISTS "Admins can view all members" ON public.members;
CREATE POLICY "Admins can view all members"
  ON public.members FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admin update any member row" ON public.members;
DROP POLICY IF EXISTS "Admins update any member row" ON public.members;
CREATE POLICY "Admins update any member row"
  ON public.members FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "stamp_card_config insert admin" ON public.stamp_card_config;
CREATE POLICY "stamp_card_config insert admin"
  ON public.stamp_card_config FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "stamp_card_config select admin" ON public.stamp_card_config;
CREATE POLICY "stamp_card_config select admin"
  ON public.stamp_card_config FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "stamp_card_config update admin" ON public.stamp_card_config;
CREATE POLICY "stamp_card_config update admin"
  ON public.stamp_card_config FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin full access profile-images" ON storage.objects;
CREATE POLICY "Admin full access profile-images"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'profile-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'profile-images' AND public.is_admin());
