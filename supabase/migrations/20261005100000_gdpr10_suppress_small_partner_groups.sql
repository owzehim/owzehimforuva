-- GDPR-10: prevent partner demographic segments smaller than five people
-- from being returned by the monthly insights view.
BEGIN;

CREATE OR REPLACE VIEW public.partner_monthly_insights_view
WITH (security_invoker = true)
AS
SELECT
  v.restaurant_id,
  date_trunc('month', v.visited_at)::date AS report_month,
  count(*) AS total_scans,
  count(DISTINCT v.user_id) AS unique_visitors,
  a.university,
  a.region_of_origin,
  a.faculty_group,
  a.study_stage,
  a.age_group,
  a.gender,
  count(DISTINCT v.user_id) AS visitors_in_segment,
  count(*) AS scans_in_segment
FROM public.stamp_card_visits AS v
LEFT JOIN public.member_analytics_profiles AS a ON a.user_id = v.user_id
GROUP BY
  v.restaurant_id,
  date_trunc('month', v.visited_at)::date,
  a.university,
  a.region_of_origin,
  a.faculty_group,
  a.study_stage,
  a.age_group,
  a.gender
HAVING count(DISTINCT v.user_id) >= 5;

COMMIT;
