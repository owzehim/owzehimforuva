-- Google reporting exposes only thresholded, broad aggregates.
-- Never return member IDs, per-event rows, exact timestamps, or free text.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_google_aggregate_report(p_partnership_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH base AS (
    SELECT
      r.store_id AS partnership_id,
      p.name AS store_name,
      r.user_id,
      r.redeemed_at AT TIME ZONE 'Europe/Amsterdam' AS local_time,
      a.region_of_origin,
      a.faculty_group
    FROM public.redemptions AS r
    JOIN public.partnerships AS p ON p.id = r.store_id
    LEFT JOIN public.member_analytics_profiles AS a ON a.user_id = r.user_id
    WHERE r.redeemed_at >= now() - interval '12 months'
      AND (p_partnership_id IS NULL OR r.store_id = p_partnership_id)
  ),
  periods AS (
    SELECT b.*, 'week'::text AS period_type,
           date_trunc('week', b.local_time)::date AS period_start
    FROM base AS b
    UNION ALL
    SELECT b.*, 'month'::text AS period_type,
           date_trunc('month', b.local_time)::date AS period_start
    FROM base AS b
  ),
  segments AS (
    SELECT
      period_type, period_start, partnership_id, store_name, user_id,
      'time_of_day'::text AS measure,
      CASE
        WHEN extract(hour FROM local_time) BETWEEN 6 AND 10 THEN '06:00–10:59'
        WHEN extract(hour FROM local_time) BETWEEN 11 AND 15 THEN '11:00–15:59'
        WHEN extract(hour FROM local_time) BETWEEN 16 AND 20 THEN '16:00–20:59'
        ELSE '21:00–05:59'
      END AS category
    FROM periods
    UNION ALL
    SELECT period_type, period_start, partnership_id, store_name, user_id,
           'origin_region', region_of_origin
    FROM periods
    WHERE region_of_origin IS NOT NULL AND region_of_origin <> ''
    UNION ALL
    SELECT period_type, period_start, partnership_id, store_name, user_id,
           'faculty', faculty_group
    FROM periods
    WHERE faculty_group IS NOT NULL AND faculty_group <> ''
  ),
  grouped AS (
    SELECT
      period_type, period_start, partnership_id, store_name, measure, category,
      count(DISTINCT user_id)::integer AS distinct_members,
      count(*)::integer AS scans
    FROM segments
    WHERE category IS NOT NULL AND category <> ''
    GROUP BY period_type, period_start, partnership_id, store_name, measure, category
    HAVING count(DISTINCT user_id) >= 5
  ),
  reportable AS (
    SELECT g.*,
      sum(g.scans) OVER (
        PARTITION BY g.period_type, g.period_start, g.partnership_id, g.measure
      ) AS reportable_scans
    FROM grouped AS g
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'period_type', period_type,
        'period_start', period_start,
        'partnership_id', partnership_id,
        'store_name', store_name,
        'measure', measure,
        'category', category,
        'distinct_members', distinct_members,
        'scans', scans,
        'share_percent', round(100.0 * scans / nullif(reportable_scans, 0), 1)
      ) ORDER BY period_start, partnership_id, measure, category
    ),
    '[]'::jsonb
  )
  FROM reportable;
$function$;

REVOKE ALL ON FUNCTION public.get_google_aggregate_report(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_google_aggregate_report(text)
  TO service_role;

-- Stop all legacy per-member/per-event sheet webhooks. Existing files and rows
-- remain intact as the requested archive; no application path should write to them.
UPDATE public.partnership_integrations
SET master_apps_script_url = NULL,
    partner_apps_script_url = NULL;

UPDATE public.partnerships
SET master_apps_script_url = NULL,
    partner_apps_script_url = NULL,
    partner_sheet_url = NULL
WHERE master_apps_script_url IS NOT NULL
   OR partner_apps_script_url IS NOT NULL
   OR partner_sheet_url IS NOT NULL;

COMMIT;
