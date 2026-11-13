-- Admin "Check-IN 점검" tab: an admin can mark a flagged member as reviewed
-- (검토 완료). The mark covers the flags up to the time it was made: if the
-- member is flagged again later, they move back to 검토 필요 by themselves.
--
-- Server-only table: no member or anon access. Admins read and write it only
-- through the two SECURITY DEFINER functions below, which check is_admin().
-- The row goes away with the member's account (ON DELETE CASCADE).
--
-- Order: apply this migration, then deploy the frontend. The current
-- frontend keeps working in between (it ignores the two new columns).

CREATE TABLE IF NOT EXISTS public.checkin_review_decisions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewed_through timestamptz NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.checkin_review_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkin_review_decisions FROM PUBLIC, anon, authenticated;

-- The return type gains reviewed_at / reviewed_through, so the function is
-- dropped and created again (same name and argument).
DROP FUNCTION IF EXISTS public.admin_checkin_review(integer);

-- Admin view: members with unusual Check-IN patterns in the last p_days days
-- (1–90, default 30). Reasons:
--   quick_switch        two different stores within 10 minutes
--   daily_limit         3 stores on one day (the limit)
--   same_store_frequent the same store on 15 or more days
-- reviewed_at is set when an admin marked the member reviewed and no newer
-- flag has appeared since (reviewed_through >= latest_at).
CREATE FUNCTION public.admin_checkin_review(p_days integer DEFAULT 30)
 RETURNS TABLE(user_id uuid, member_name text, student_number text, reasons text[], latest_at timestamptz,
               reviewed_at timestamptz, reviewed_through timestamptz)
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
  ),
  flagged AS (
    SELECT flags.user_id, array_agg(flags.reason ORDER BY flags.reason) AS reasons, max(flags.at) AS latest_at
    FROM flags
    GROUP BY flags.user_id
  )
  SELECT flagged.user_id,
         coalesce(
           nullif(btrim(concat(member.last_name_korean, member.first_name_korean)), ''),
           nullif(btrim(concat_ws(' ', member.first_name, member.last_name)), ''),
           '—'
         ),
         member.student_number,
         flagged.reasons,
         flagged.latest_at,
         CASE WHEN decision.reviewed_through >= flagged.latest_at THEN decision.reviewed_at END,
         decision.reviewed_through
  FROM flagged
  LEFT JOIN public.members AS member ON member.user_id = flagged.user_id
  LEFT JOIN public.checkin_review_decisions AS decision ON decision.user_id = flagged.user_id
  ORDER BY flagged.latest_at DESC
  LIMIT 100;
$function$;

REVOKE ALL ON FUNCTION public.admin_checkin_review(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_checkin_review(integer) TO authenticated;

-- Mark a flagged member as reviewed up to p_through (the latest_at the admin
-- saw), or undo the mark (p_reviewed = false).
CREATE OR REPLACE FUNCTION public.admin_set_checkin_review(p_user_id uuid, p_reviewed boolean, p_through timestamptz DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required' USING ERRCODE = '22023';
  END IF;

  IF p_reviewed THEN
    IF p_through IS NULL THEN
      RAISE EXCEPTION 'reviewed time is required' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.checkin_review_decisions AS d (user_id, reviewed_through, reviewed_at, reviewed_by)
    VALUES (p_user_id, least(p_through, now()), now(), auth.uid())
    ON CONFLICT (user_id) DO UPDATE
      SET reviewed_through = excluded.reviewed_through,
          reviewed_at = excluded.reviewed_at,
          reviewed_by = excluded.reviewed_by;
  ELSE
    DELETE FROM public.checkin_review_decisions WHERE user_id = p_user_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_checkin_review(uuid, boolean, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_checkin_review(uuid, boolean, timestamptz) TO authenticated;
