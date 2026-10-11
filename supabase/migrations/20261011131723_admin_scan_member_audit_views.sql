-- Admin-only, live audit view that joins scan/reward events to minimal member
-- identity fields. This is a view (not a duplicate table), so it stays current
-- and does not create a second copy of personal event data.
BEGIN;

CREATE OR REPLACE VIEW public.admin_member_scan_audit
WITH (security_invoker = true)
AS
SELECT
  'discount_scan'::text AS event_type,
  r.redeemed_at AT TIME ZONE 'Europe/Amsterdam' AS event_at_amsterdam,
  r.store_id AS partnership_id,
  COALESCE(rest.name, r.store_id) AS store_name,
  r.id::text AS event_id,
  r.user_id AS member_user_id,
  concat_ws(' ', NULLIF(m.first_name, ''), NULLIF(m.last_name, '')) AS member_name,
  m.username,
  m.is_member,
  m.membership_valid_until,
  m.account_status,
  NULL::integer AS stamp_card_cycle,
  NULL::boolean AS added_by_admin,
  NULL::boolean AS reward_claimed
FROM public.redemptions AS r
JOIN public.members AS m ON m.user_id = r.user_id
LEFT JOIN public.restaurants AS rest ON rest.partnership_id = r.store_id
WHERE (SELECT public.is_admin())

UNION ALL

SELECT
  'stamp_visit'::text AS event_type,
  v.visited_at AT TIME ZONE 'Europe/Amsterdam' AS event_at_amsterdam,
  rest.partnership_id,
  rest.name AS store_name,
  v.id::text AS event_id,
  v.user_id AS member_user_id,
  concat_ws(' ', NULLIF(m.first_name, ''), NULLIF(m.last_name, '')) AS member_name,
  m.username,
  m.is_member,
  m.membership_valid_until,
  m.account_status,
  v.card_cycle AS stamp_card_cycle,
  v.added_by_admin,
  NULL::boolean AS reward_claimed
FROM public.stamp_card_visits AS v
JOIN public.members AS m ON m.user_id = v.user_id
JOIN public.restaurants AS rest ON rest.id = v.restaurant_id
WHERE (SELECT public.is_admin())

UNION ALL

SELECT
  'stamp_reward_claim'::text AS event_type,
  reward.redeemed_at AT TIME ZONE 'Europe/Amsterdam' AS event_at_amsterdam,
  rest.partnership_id,
  rest.name AS store_name,
  reward.id::text AS event_id,
  reward.user_id AS member_user_id,
  concat_ws(' ', NULLIF(m.first_name, ''), NULLIF(m.last_name, '')) AS member_name,
  m.username,
  m.is_member,
  m.membership_valid_until,
  m.account_status,
  reward.card_cycle AS stamp_card_cycle,
  NULL::boolean AS added_by_admin,
  reward.redeemed AS reward_claimed
FROM public.stamp_card_rewards AS reward
JOIN public.members AS m ON m.user_id = reward.user_id
JOIN public.restaurants AS rest ON rest.id = reward.restaurant_id
WHERE reward.redeemed IS TRUE
  AND reward.redeemed_at IS NOT NULL
  AND (SELECT public.is_admin());

COMMENT ON VIEW public.admin_member_scan_audit IS
  'Admin-only live view of discount scans, stamp visits, and claimed stamp rewards joined to minimal member identity and store fields. Filter by partnership_id for one store.';

REVOKE ALL ON TABLE public.admin_member_scan_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_member_scan_audit TO authenticated;

COMMIT;
