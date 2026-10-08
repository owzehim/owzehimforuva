-- SEC-18/25: require the current, server-validated app session for raw
-- comment and note table access, matching production's restrictive policies.
-- Keep the existing owner/admin policies; this additional restrictive policy
-- is ANDed with them for authenticated requests.

BEGIN;

DROP POLICY IF EXISTS "require_app_login" ON public.restaurant_comments;
CREATE POLICY "require_app_login"
  ON public.restaurant_comments
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (
    coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false)
    AND (SELECT public.is_current_device_session())
  )
  WITH CHECK (
    coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false)
    AND (SELECT public.is_current_device_session())
  );

DROP POLICY IF EXISTS "require_app_login" ON public.restaurant_notes;
CREATE POLICY "require_app_login"
  ON public.restaurant_notes
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (
    coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false)
    AND (SELECT public.is_current_device_session())
  )
  WITH CHECK (
    coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false)
    AND (SELECT public.is_current_device_session())
  );

COMMIT;
