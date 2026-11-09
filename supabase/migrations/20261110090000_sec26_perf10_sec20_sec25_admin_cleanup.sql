-- SEC-26, PERF-10, SEC-20, SEC-25 (admins) — CITS reports v2.0/v3.0.
--
-- 1. SEC-26: drop seven legacy admin policies. They were created for role
--    `public` and only check admin_roles, so they skip the app-login checks in
--    is_admin() / require_app_login. Each is covered by a current policy
--    ("Admins manage events", "Admins manage restaurants", "Admins delete
--    members"). Two duplicate public-read policies are dropped as well
--    ("Public read events" / "Public read restaurants" stay).
-- 2. PERF-10: wrap is_admin() / is_current_device_session() in policies as
--    (SELECT ...) so Postgres evaluates them once per query, not per row.
--    Conditions are unchanged.
-- 3. SEC-20: revoke table privileges that no RLS policy allows. RLS already
--    refuses these requests, so app behaviour does not change.
-- 4. SEC-25: admins follow the one-device rule too. The admin exemption now
--    applies only to an admin without a members row (who has no seat to hold).
--    The test account exemption (SEC-63) is unchanged.
--
-- No frontend change. Update supabase/checks/permission-check.sql in the same
-- PR. Apply to DEV first, then production, as this single file with its ledger
-- row (README "Database changes and deployment").

BEGIN;

-- 1. SEC-26 -------------------------------------------------------------------
DROP POLICY IF EXISTS "관리자 멤버 삭제" ON public.members;
DROP POLICY IF EXISTS "관리자 식당 삭제" ON public.restaurants;
DROP POLICY IF EXISTS "관리자 식당 수정" ON public.restaurants;
DROP POLICY IF EXISTS "관리자 식당 추가" ON public.restaurants;
DROP POLICY IF EXISTS "관리자 이벤트 삭제" ON public.events;
DROP POLICY IF EXISTS "관리자 이벤트 수정" ON public.events;
DROP POLICY IF EXISTS "관리자 이벤트 추가" ON public.events;
DROP POLICY IF EXISTS "이벤트 공개 조회" ON public.events;
DROP POLICY IF EXISTS "식당 공개 조회" ON public.restaurants;

-- 2. PERF-10 ------------------------------------------------------------------
ALTER POLICY "Admins manage events" ON public.events
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
ALTER POLICY "Admins manage restaurants" ON public.restaurants
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
ALTER POLICY "Admins delete members" ON public.members
  USING ((SELECT public.is_admin()));
ALTER POLICY "Members and admins can read member rows" ON public.members
  USING ((user_id = (SELECT auth.uid())) OR (SELECT public.is_admin()));
ALTER POLICY "Members and admins can update member rows" ON public.members
  USING ((user_id = (SELECT auth.uid())) OR (SELECT public.is_admin()))
  WITH CHECK ((user_id = (SELECT auth.uid())) OR (SELECT public.is_admin()));
ALTER POLICY "Members and admins can read own redemptions" ON public.redemptions
  USING ((user_id = (SELECT auth.uid())) OR (SELECT public.is_admin()));
ALTER POLICY "Admins can review comment reports" ON public.restaurant_comment_reports
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()) AND (reviewed_by = (SELECT auth.uid())) AND (reviewed_at IS NOT NULL));
ALTER POLICY "Members can see their own reports" ON public.restaurant_comment_reports
  USING ((reporter_id = (SELECT auth.uid())) OR (SELECT public.is_admin()));
ALTER POLICY "Admins can delete any restaurant comment" ON public.restaurant_comments
  USING ((SELECT public.is_admin()));
ALTER POLICY "Admins can read restaurant comments for moderation" ON public.restaurant_comments
  USING ((SELECT public.is_admin()) AND (SELECT public.is_current_device_session()));
ALTER POLICY "Admins can read note reports" ON public.restaurant_note_reports
  USING ((SELECT public.is_admin()));
ALTER POLICY "Admins can review note reports" ON public.restaurant_note_reports
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()) AND (
    ((status = 'resolved') AND (reviewed_by = (SELECT auth.uid())) AND (reviewed_at IS NOT NULL) AND (decision IS NOT NULL))
    OR ((status = 'pending') AND (decision IS NULL) AND (reviewed_at IS NULL) AND (reviewed_by IS NULL))
  ));
ALTER POLICY "Admins can delete any restaurant note" ON public.restaurant_notes
  USING ((SELECT public.is_admin()));
ALTER POLICY "Admins can hide any restaurant note" ON public.restaurant_notes
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
ALTER POLICY "Admins can read restaurant notes for moderation" ON public.restaurant_notes
  USING ((SELECT public.is_admin()) AND (SELECT public.is_current_device_session()));
ALTER POLICY "Members and admins can read own reviews" ON public.reviews
  USING ((user_id = (SELECT auth.uid())) OR (SELECT public.is_admin()));
ALTER POLICY "stamp_card_config insert admin" ON public.stamp_card_config
  WITH CHECK ((SELECT public.is_admin()));
ALTER POLICY "stamp_card_config select admin" ON public.stamp_card_config
  USING ((SELECT public.is_admin()));
ALTER POLICY "stamp_card_config update admin" ON public.stamp_card_config
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
ALTER POLICY "Members and admins can read stamp rewards" ON public.stamp_card_rewards
  USING ((user_id = (SELECT auth.uid())) OR (SELECT public.is_admin()));
ALTER POLICY "Stamp card reads require active membership" ON public.stamp_card_rewards
  USING ((SELECT public.is_admin()) OR EXISTS (
    SELECT 1 FROM public.members AS member
    WHERE member.user_id = (SELECT auth.uid())
      AND member.is_member IS TRUE
      AND member.account_status = 'active'
      AND member.identity_anonymized_at IS NULL
      AND member.membership_valid_until >= (now() AT TIME ZONE 'Europe/Amsterdam')::date
  ));
ALTER POLICY "Members and admins can read stamp visits" ON public.stamp_card_visits
  USING ((user_id = (SELECT auth.uid())) OR (SELECT public.is_admin()));
ALTER POLICY "Stamp card reads require active membership" ON public.stamp_card_visits
  USING ((SELECT public.is_admin()) OR EXISTS (
    SELECT 1 FROM public.members AS member
    WHERE member.user_id = (SELECT auth.uid())
      AND member.is_member IS TRUE
      AND member.account_status = 'active'
      AND member.identity_anonymized_at IS NULL
      AND member.membership_valid_until >= (now() AT TIME ZONE 'Europe/Amsterdam')::date
  ));
ALTER POLICY "SEC07 admin manage event images" ON storage.objects
  USING ((bucket_id = 'event-images') AND (SELECT public.is_admin()))
  WITH CHECK ((bucket_id = 'event-images') AND (SELECT public.is_admin()));
ALTER POLICY "SEC07 admin manage place images" ON storage.objects
  USING ((bucket_id = 'place-images') AND (SELECT public.is_admin()))
  WITH CHECK ((bucket_id = 'place-images') AND (SELECT public.is_admin()));
ALTER POLICY "SEC07 admin manage profile images" ON storage.objects
  USING ((bucket_id = 'profile-images') AND (SELECT public.is_admin()))
  WITH CHECK ((bucket_id = 'profile-images') AND (SELECT public.is_admin()));

-- 3. SEC-20 -------------------------------------------------------------------
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.member_analytics_profiles FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.partnerships FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.privacy_action_log FROM authenticated;
REVOKE DELETE ON public.restaurant_comment_reports FROM authenticated;
REVOKE DELETE ON public.restaurant_note_reports FROM authenticated;
REVOKE INSERT, DELETE ON public.review_prompts FROM authenticated;
REVOKE UPDATE, DELETE ON public.reviews FROM authenticated;
REVOKE DELETE ON public.stamp_card_config FROM authenticated;

-- 4. SEC-25: admins hold one device seat like members -------------------------
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

  IF EXISTS (
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
    -- An admin without a members row has no seat to hold.
    RETURN EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = caller_id);
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
    RETURN false;
  END IF;

  IF seat_session IS NOT NULL
     AND seat_session ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT session.created_at
    INTO seat_login_at
    FROM auth.sessions AS session
    WHERE session.id = seat_session::uuid
      AND session.user_id = caller_id;

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

CREATE OR REPLACE FUNCTION public.is_current_device_session()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN (SELECT auth.uid()) IS NULL
      OR coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false) IS NOT TRUE THEN false
    WHEN EXISTS (
      SELECT 1 FROM public.login_otp_exempt_users AS exempt
      WHERE exempt.user_id = (SELECT auth.uid())
        AND exempt.reason = 'test'
    ) THEN true
    WHEN NOT EXISTS (
      SELECT 1 FROM public.members AS member
      WHERE member.user_id = (SELECT auth.uid())
    ) THEN EXISTS (
      SELECT 1 FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = (SELECT auth.uid())
    )
    ELSE EXISTS (
      SELECT 1 FROM public.members AS member
      WHERE member.user_id = (SELECT auth.uid())
        AND member.session_token = (SELECT auth.jwt() ->> 'session_id')
    )
  END;
$function$;

COMMIT;
