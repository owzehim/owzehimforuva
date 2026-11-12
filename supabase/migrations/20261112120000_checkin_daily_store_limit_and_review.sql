-- Check-IN limits (2026-11-12): a store's QR code is not secret, so a member
-- could check in without being there. Without new QR codes, this limits the
-- damage and makes it visible:
--   * at most 3 different stores per member per day (Amsterdam date);
--     scanning a store already visited today still works;
--   * admins see members with unusual Check-IN patterns.

-- Normal-case check, called by log-redemption before the stamp is recorded.
-- Server only (service_role).
CREATE OR REPLACE FUNCTION public.checkin_daily_store_limit_reached(p_user_id uuid, p_store_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  WITH today AS (
    SELECT DISTINCT r.store_id
    FROM public.redemptions AS r
    WHERE r.user_id = p_user_id
      AND (r.redeemed_at AT TIME ZONE 'Europe/Amsterdam')::date
          = (now() AT TIME ZONE 'Europe/Amsterdam')::date
  )
  SELECT NOT EXISTS (SELECT 1 FROM today WHERE store_id = p_store_id)
     AND (SELECT count(*) FROM today) >= 3;
$function$;

REVOKE ALL ON FUNCTION public.checkin_daily_store_limit_reached(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkin_daily_store_limit_reached(uuid, text) TO service_role;

-- The same limit where the Check-IN is actually recorded, under a lock per
-- member and day, so two scans at the same moment cannot both get through.
CREATE OR REPLACE FUNCTION public.claim_redemption_window(p_user_id uuid, p_store_id text)
 RETURNS TABLE(redemption_id text, created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz;
  v_today date;
  v_existing_id text;
  v_new_id text;
  v_other_stores integer;
BEGIN
  IF p_user_id IS NULL OR p_store_id IS NULL OR p_store_id = '' THEN
    RAISE EXCEPTION 'user and store are required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_store_id, 0)
  );
  v_now := clock_timestamp();
  v_today := (v_now AT TIME ZONE 'Europe/Amsterdam')::date;

  -- A retry in the existing 15-minute window returns the same redemption.
  SELECT r.id::text
    INTO v_existing_id
  FROM public.redemptions AS r
  WHERE r.user_id = p_user_id
    AND r.store_id = p_store_id
    AND r.redeemed_at >= v_now - interval '15 minutes'
    AND r.redeemed_at <= v_now
  ORDER BY r.redeemed_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_id, false;
    RETURN;
  END IF;

  -- Do not mint another redemption or review prompt later on the same day.
  -- Returning the existing ID preserves the Edge Function's idempotent
  -- Sheets retry behavior without creating another visit record.
  SELECT r.id::text
    INTO v_existing_id
  FROM public.redemptions AS r
  WHERE r.user_id = p_user_id
    AND r.store_id = p_store_id
    AND (r.redeemed_at AT TIME ZONE 'Europe/Amsterdam')::date = v_today
    AND r.redeemed_at <= v_now
  ORDER BY r.redeemed_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_id, false;
    RETURN;
  END IF;

  -- New store today: at most 3 different stores per member per day.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('checkin-day:' || p_user_id::text || ':' || v_today::text, 0)
  );
  SELECT count(DISTINCT r.store_id)::integer
    INTO v_other_stores
  FROM public.redemptions AS r
  WHERE r.user_id = p_user_id
    AND r.store_id <> p_store_id
    AND (r.redeemed_at AT TIME ZONE 'Europe/Amsterdam')::date = v_today;

  IF v_other_stores >= 3 THEN
    RAISE EXCEPTION 'daily_store_limit' USING ERRCODE = 'P0001', HINT = 'checkin_daily_store_limit';
  END IF;

  INSERT INTO public.redemptions (user_id, store_id, redeemed_at)
  VALUES (p_user_id, p_store_id, v_now)
  RETURNING id::text INTO v_new_id;

  RETURN QUERY SELECT v_new_id, true;
END;
$function$;

-- Admin view: members with unusual Check-IN patterns in the last p_days days
-- (1–90, default 30). Reasons:
--   quick_switch        two different stores within 10 minutes
--   daily_limit         3 stores on one day (the limit)
--   same_store_frequent the same store on 15 or more days
CREATE OR REPLACE FUNCTION public.admin_checkin_review(p_days integer DEFAULT 30)
 RETURNS TABLE(user_id uuid, member_name text, student_number text, reasons text[], latest_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  WITH recent AS (
    SELECT r.user_id, r.store_id, r.redeemed_at,
           (r.redeemed_at AT TIME ZONE 'Europe/Amsterdam')::date AS day
    FROM public.redemptions AS r
    WHERE public.is_admin()
      AND r.user_id IS NOT NULL
      AND r.redeemed_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90))
  ),
  ordered AS (
    SELECT recent.*,
           lag(recent.store_id) OVER w AS previous_store,
           lag(recent.redeemed_at) OVER w AS previous_at
    FROM recent
    WINDOW w AS (PARTITION BY recent.user_id ORDER BY recent.redeemed_at)
  ),
  flags AS (
    SELECT o.user_id, 'quick_switch'::text AS reason, max(o.redeemed_at) AS at
    FROM ordered AS o
    WHERE o.previous_store IS DISTINCT FROM o.store_id
      AND o.previous_at IS NOT NULL
      AND o.redeemed_at - o.previous_at <= interval '10 minutes'
    GROUP BY o.user_id
    UNION ALL
    SELECT d.user_id, 'daily_limit', max(d.last_at)
    FROM (
      SELECT recent.user_id, recent.day, count(DISTINCT recent.store_id) AS stores, max(recent.redeemed_at) AS last_at
      FROM recent GROUP BY recent.user_id, recent.day
    ) AS d
    WHERE d.stores >= 3
    GROUP BY d.user_id
    UNION ALL
    SELECT f.user_id, 'same_store_frequent', max(f.last_at)
    FROM (
      SELECT recent.user_id, recent.store_id, count(DISTINCT recent.day) AS days, max(recent.redeemed_at) AS last_at
      FROM recent GROUP BY recent.user_id, recent.store_id
    ) AS f
    WHERE f.days >= 15
    GROUP BY f.user_id
  )
  SELECT flags.user_id,
         coalesce(
           nullif(btrim(concat(member.last_name_korean, member.first_name_korean)), ''),
           nullif(btrim(concat_ws(' ', member.first_name, member.last_name)), ''),
           '—'
         ),
         member.student_number,
         array_agg(flags.reason ORDER BY flags.reason),
         max(flags.at)
  FROM flags
  LEFT JOIN public.members AS member ON member.user_id = flags.user_id
  GROUP BY flags.user_id, member.last_name_korean, member.first_name_korean,
           member.first_name, member.last_name, member.student_number
  ORDER BY max(flags.at) DESC
  LIMIT 100;
$function$;

REVOKE ALL ON FUNCTION public.admin_checkin_review(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_checkin_review(integer) TO authenticated;
