-- Keep the detailed member/event join available to the database owner for
-- operational review, without exposing email or student numbers through APIs.
BEGIN;

DROP VIEW IF EXISTS public.admin_member_scan_audit;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE VIEW private.admin_member_scan_audit
WITH (security_invoker = true)
AS
SELECT
  'discount_scan'::text AS event_type,
  r.redeemed_at AT TIME ZONE 'Europe/Amsterdam' AS event_at_amsterdam,
  r.store_id AS partnership_id,
  COALESCE(rest.name, r.store_id) AS store_name,
  r.id::text AS event_id,
  r.user_id AS member_user_id,
  u.email AS member_email,
  concat_ws(' ', NULLIF(m.first_name, ''), NULLIF(m.last_name, '')) AS member_name,
  m.student_number,
  m.username,
  m.is_member,
  m.membership_valid_until,
  m.account_status,
  NULL::integer AS stamp_card_cycle,
  NULL::boolean AS added_by_admin,
  NULL::boolean AS reward_claimed
FROM public.redemptions AS r
JOIN public.members AS m ON m.user_id = r.user_id
LEFT JOIN auth.users AS u ON u.id = r.user_id
LEFT JOIN public.restaurants AS rest ON rest.partnership_id = r.store_id

UNION ALL

SELECT
  'stamp_visit'::text AS event_type,
  v.visited_at AT TIME ZONE 'Europe/Amsterdam' AS event_at_amsterdam,
  rest.partnership_id,
  rest.name AS store_name,
  v.id::text AS event_id,
  v.user_id AS member_user_id,
  u.email AS member_email,
  concat_ws(' ', NULLIF(m.first_name, ''), NULLIF(m.last_name, '')) AS member_name,
  m.student_number,
  m.username,
  m.is_member,
  m.membership_valid_until,
  m.account_status,
  v.card_cycle AS stamp_card_cycle,
  v.added_by_admin,
  NULL::boolean AS reward_claimed
FROM public.stamp_card_visits AS v
JOIN public.members AS m ON m.user_id = v.user_id
LEFT JOIN auth.users AS u ON u.id = v.user_id
JOIN public.restaurants AS rest ON rest.id = v.restaurant_id

UNION ALL

SELECT
  'stamp_reward_claim'::text AS event_type,
  reward.redeemed_at AT TIME ZONE 'Europe/Amsterdam' AS event_at_amsterdam,
  rest.partnership_id,
  rest.name AS store_name,
  reward.id::text AS event_id,
  reward.user_id AS member_user_id,
  u.email AS member_email,
  concat_ws(' ', NULLIF(m.first_name, ''), NULLIF(m.last_name, '')) AS member_name,
  m.student_number,
  m.username,
  m.is_member,
  m.membership_valid_until,
  m.account_status,
  reward.card_cycle AS stamp_card_cycle,
  NULL::boolean AS added_by_admin,
  reward.redeemed AS reward_claimed
FROM public.stamp_card_rewards AS reward
JOIN public.members AS m ON m.user_id = reward.user_id
LEFT JOIN auth.users AS u ON u.id = reward.user_id
JOIN public.restaurants AS rest ON rest.id = reward.restaurant_id
WHERE reward.redeemed IS TRUE
  AND reward.redeemed_at IS NOT NULL;

COMMENT ON VIEW private.admin_member_scan_audit IS
  'Owner-only live view of discount scans, stamp visits, and claimed rewards joined to member email, student number, and store. Filter by partnership_id for one store.';

REVOKE ALL ON TABLE private.admin_member_scan_audit FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
