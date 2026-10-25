-- Return the member and stamp summary for one restaurant in a single RPC call.
-- The Edge Function performs login, active-device, and admin-role checks first.
CREATE OR REPLACE FUNCTION public.admin_list_stamp_card_members(p_restaurant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH visit_counts AS (
    SELECT visit.user_id, count(*)::integer AS visit_count
    FROM public.stamp_card_visits AS visit
    WHERE visit.restaurant_id = p_restaurant_id
    GROUP BY visit.user_id
  ),
  latest_rewards AS (
    SELECT DISTINCT ON (reward.user_id)
      reward.user_id,
      jsonb_build_object(
        'id', reward.id,
        'user_id', reward.user_id,
        'restaurant_id', reward.restaurant_id,
        'card_cycle', reward.card_cycle,
        'redeemed', reward.redeemed,
        'redeemed_at', reward.redeemed_at,
        'created_at', reward.created_at,
        'expires_at', reward.expires_at
      ) AS latest_reward
    FROM public.stamp_card_rewards AS reward
    WHERE reward.restaurant_id = p_restaurant_id
    ORDER BY reward.user_id, reward.created_at DESC, reward.id DESC
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'member', jsonb_build_object(
          'id', member.id,
          'user_id', member.user_id,
          'first_name', member.first_name,
          'last_name', member.last_name
        ),
        'visitCount', COALESCE(visit_counts.visit_count, 0),
        'latestReward', latest_rewards.latest_reward
      )
      ORDER BY member.last_name ASC NULLS LAST,
               member.first_name ASC NULLS LAST,
               member.id ASC
    ),
    '[]'::jsonb
  )
  FROM public.members AS member
  LEFT JOIN visit_counts ON visit_counts.user_id = member.user_id
  LEFT JOIN latest_rewards ON latest_rewards.user_id = member.user_id
  WHERE member.user_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.admin_list_stamp_card_members(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_stamp_card_members(uuid)
  TO service_role;
