-- SEC-25 (CITS reports v2.0/v3.0): the newest login keeps the device seat.
--
-- Problem: claim_single_device_session wrote the caller's session_id into
-- members.session_token unconditionally. The app calls it every time it starts,
-- so an OLDER device that reopened the app took the seat back from the device
-- that logged in most recently, and the two devices could keep swapping.
--
-- Fix: a claim succeeds only when
--   * the caller already holds the seat, or
--   * no live session holds it (empty, or that session no longer exists), or
--   * the caller's login session is newer than the one holding the seat.
-- Otherwise it returns false and the app signs that device out (existing
-- behaviour of useSingleDeviceSession). Logging in on a new device therefore
-- logs the other device out, and the other device cannot come back without a
-- new login.
--
-- Unchanged: admin and test-account exemptions, is_current_device_session(),
-- the server-side device checks in Edge Functions, grants.
-- No frontend change is needed. Apply to DEV first, then production, as this
-- single file with its ledger row (README "Database changes and deployment").

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_single_device_session()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  caller_id uuid := (SELECT auth.uid());
  caller_session text := (SELECT auth.jwt() ->> 'session_id');
  seat_session text;
  caller_login_at timestamptz;
  seat_login_at timestamptz;
BEGIN
  IF caller_id IS NULL
     OR coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Authorized application login is required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = caller_id)
     OR EXISTS (
       SELECT 1 FROM public.login_otp_exempt_users
       WHERE user_id = caller_id AND reason = 'test'
     ) THEN
    RETURN true;
  END IF;

  IF caller_session IS NULL
     OR caller_session !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  -- Serialize concurrent claims for the same member.
  SELECT member.session_token
  INTO seat_session
  FROM public.members AS member
  WHERE member.user_id = caller_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF seat_session = caller_session THEN
    RETURN true;
  END IF;

  SELECT session.created_at
  INTO caller_login_at
  FROM auth.sessions AS session
  WHERE session.id = caller_session::uuid
    AND session.user_id = caller_id;

  IF NOT FOUND THEN
    -- The caller's own login session is gone (signed out or revoked).
    RETURN false;
  END IF;

  IF seat_session IS NOT NULL
     AND seat_session ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT session.created_at
    INTO seat_login_at
    FROM auth.sessions AS session
    WHERE session.id = seat_session::uuid
      AND session.user_id = caller_id;

    -- A login at least as recent as the caller's still holds the seat.
    IF FOUND AND seat_login_at >= caller_login_at THEN
      RETURN false;
    END IF;
  END IF;

  UPDATE public.members
  SET session_token = caller_session
  WHERE user_id = caller_id;

  RETURN true;
END;
$function$;

-- CREATE OR REPLACE keeps the existing grants (authenticated, service_role).

COMMIT;
