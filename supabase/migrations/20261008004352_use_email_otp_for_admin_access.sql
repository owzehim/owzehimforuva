-- Require administrators to complete the app's existing password + email OTP
-- login flow. The server-side Auth Hook grants app_access only after OTP
-- verification; production RLS already uses this claim for authenticated APIs.

BEGIN;

DELETE FROM public.login_otp_exempt_users
WHERE reason = 'admin';

COMMIT;
