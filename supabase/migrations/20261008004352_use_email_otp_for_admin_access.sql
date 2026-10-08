-- Use the existing server-verified password + email OTP session for API and
-- administrator access. Do not require native TOTP/AAL2 for each operation.
-- The Auth Hook's signed app_access claim is issued only after OTP proof has
-- been recorded, except for the separately allowlisted test account.

BEGIN;

-- Administrators must complete email OTP at login. Keep the test-account
-- exception, but remove the administrator password-only bypass.
DELETE FROM public.login_otp_exempt_users
WHERE reason = 'admin';

-- Replace the earlier blanket AAL2 restriction with the application's
-- server-issued email-OTP authorization claim. Existing table policies still
-- enforce ownership and administrator roles after this authentication gate.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND rowsecurity IS TRUE
      AND tablename NOT IN ('login_otp_exempt_users', 'login_otp_verified_sessions')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      'SEC12 require AAL2 for authenticated access',
      target.schemaname,
      target.tablename
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      'require_app_login',
      target.schemaname,
      target.tablename
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING (coalesce(auth.jwt() ->> ''app_access'' = ''true'', false)) WITH CHECK (coalesce(auth.jwt() ->> ''app_access'' = ''true'', false))',
      'require_app_login',
      target.schemaname,
      target.tablename
    );
  END LOOP;
END;
$$;

-- Apply the same server-issued login gate to authenticated Storage operations.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM pg_class
       WHERE oid = 'storage.objects'::regclass AND relrowsecurity IS TRUE
     ) THEN
    DROP POLICY IF EXISTS "SEC12 require AAL2 for authenticated access" ON storage.objects;
    DROP POLICY IF EXISTS "SEC12 require verified app login" ON storage.objects;
    CREATE POLICY "SEC12 require verified app login"
      ON storage.objects
      AS RESTRICTIVE
      FOR ALL
      TO authenticated
      USING (coalesce(auth.jwt() ->> 'app_access' = 'true', false))
      WITH CHECK (coalesce(auth.jwt() ->> 'app_access' = 'true', false));
  END IF;
END;
$$;

COMMIT;
