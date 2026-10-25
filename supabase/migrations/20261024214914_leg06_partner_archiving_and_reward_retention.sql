-- Keep partner-linked history when a partnership ends. Expire existing rewards
-- immediately, retain their rows for 12 months, then remove them in the daily
-- privacy-retention-sync job.

BEGIN;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.stamp_card_rewards
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS delete_after timestamptz;

CREATE OR REPLACE FUNCTION public.expire_restaurant_rewards_on_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_ended_at timestamptz := clock_timestamp();
BEGIN
  IF OLD.is_archived IS FALSE AND NEW.is_archived IS TRUE THEN
    UPDATE public.stamp_card_rewards AS reward
    SET expires_at = CASE
          WHEN reward.redeemed IS FALSE AND reward.expires_at IS NULL THEN v_ended_at
          ELSE reward.expires_at
        END,
        delete_after = COALESCE(reward.delete_after, v_ended_at + interval '12 months')
    WHERE reward.restaurant_id = NEW.id;

    UPDATE public.restaurants
    SET archived_at = v_ended_at
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_restaurant_rewards_on_archive()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS expire_restaurant_rewards_on_archive ON public.restaurants;
CREATE TRIGGER expire_restaurant_rewards_on_archive
AFTER UPDATE OF is_archived ON public.restaurants
FOR EACH ROW
EXECUTE FUNCTION public.expire_restaurant_rewards_on_archive();

CREATE OR REPLACE FUNCTION public.record_member_stamp_visit(
  p_user_id uuid,
  p_restaurant_id uuid
)
RETURNS TABLE (
  enabled boolean,
  already_stamped boolean,
  reward_pending boolean,
  cycle_completed boolean,
  current_count integer,
  new_count integer,
  card_cycle integer,
  total_stamps integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_total integer;
  v_prior_count integer;
  v_cycle integer;
  v_today_count integer;
  v_pending boolean;
  v_new_count integer;
BEGIN
  IF p_user_id IS NULL OR p_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'user and restaurant are required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_restaurant_id::text, 0)
  );

  SELECT GREATEST(1, c.total_stamps)
    INTO v_total
  FROM public.restaurants AS r
  JOIN public.stamp_card_config AS c ON c.restaurant_id = r.id
  WHERE r.id = p_restaurant_id
    AND r.stamp_card_enabled IS TRUE
    AND r.is_archived IS FALSE
  LIMIT 1;

  IF v_total IS NULL THEN
    RETURN QUERY SELECT false, false, false, false, 0, 0, 0, 0;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.stamp_card_rewards AS reward
    WHERE reward.user_id = p_user_id
      AND reward.restaurant_id = p_restaurant_id
      AND reward.redeemed IS FALSE
      AND (reward.expires_at IS NULL OR reward.expires_at > v_now)
  ) INTO v_pending;

  SELECT count(*)::integer INTO v_prior_count
  FROM public.stamp_card_visits AS visit
  WHERE visit.user_id = p_user_id AND visit.restaurant_id = p_restaurant_id;

  v_cycle := (v_prior_count / v_total) + 1;

  IF v_pending THEN
    RETURN QUERY SELECT true, false, true, true, v_prior_count % v_total, v_prior_count,
      v_cycle - 1, v_total;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_today_count
  FROM public.stamp_card_visits AS visit
  WHERE visit.user_id = p_user_id
    AND visit.restaurant_id = p_restaurant_id
    AND visit.added_by_admin IS FALSE
    AND (visit.visited_at AT TIME ZONE 'Europe/Amsterdam')::date =
        (v_now AT TIME ZONE 'Europe/Amsterdam')::date;

  IF v_today_count > 0 THEN
    RETURN QUERY SELECT true, true, false, false, v_prior_count % v_total, v_prior_count,
      v_cycle, v_total;
    RETURN;
  END IF;

  INSERT INTO public.stamp_card_visits (user_id, restaurant_id, visited_at, card_cycle, added_by_admin)
  VALUES (p_user_id, p_restaurant_id, v_now, v_cycle, false);

  v_new_count := v_prior_count + 1;
  IF v_new_count % v_total = 0 THEN
    INSERT INTO public.stamp_card_rewards (user_id, restaurant_id, card_cycle, redeemed)
    VALUES (p_user_id, p_restaurant_id, v_cycle, false)
    ON CONFLICT (user_id, restaurant_id, card_cycle) DO NOTHING;
  END IF;

  RETURN QUERY SELECT true, false, false, (v_new_count % v_total = 0),
    v_new_count % v_total, v_new_count, v_cycle, v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_add_stamp_card_visit(
  p_user_id uuid,
  p_restaurant_id uuid,
  p_visited_at timestamptz DEFAULT clock_timestamp(),
  p_admin_note text DEFAULT NULL
)
RETURNS TABLE (
  reward_pending boolean,
  cycle_completed boolean,
  new_count integer,
  card_cycle integer,
  total_stamps integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_total integer;
  v_prior_count integer;
  v_cycle integer;
  v_new_count integer;
  v_pending boolean;
BEGIN
  IF p_user_id IS NULL OR p_restaurant_id IS NULL OR p_visited_at IS NULL THEN
    RAISE EXCEPTION 'user, restaurant, and visit time are required';
  END IF;
  IF length(coalesce(p_admin_note, '')) > 500 THEN
    RAISE EXCEPTION 'admin note is too long';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_restaurant_id::text, 0)
  );

  SELECT GREATEST(1, c.total_stamps)
    INTO v_total
  FROM public.restaurants AS r
  JOIN public.stamp_card_config AS c ON c.restaurant_id = r.id
  WHERE r.id = p_restaurant_id
    AND r.stamp_card_enabled IS TRUE
    AND r.is_archived IS FALSE
  LIMIT 1;

  IF v_total IS NULL THEN
    RAISE EXCEPTION 'stamp card is not enabled for this restaurant';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.stamp_card_rewards AS reward
    WHERE reward.user_id = p_user_id
      AND reward.restaurant_id = p_restaurant_id
      AND reward.redeemed IS FALSE
      AND reward.expires_at IS NULL
  ) INTO v_pending;

  IF v_pending THEN
    RETURN QUERY SELECT true, true, 0, 0, v_total;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_prior_count
  FROM public.stamp_card_visits AS visit
  WHERE visit.user_id = p_user_id AND visit.restaurant_id = p_restaurant_id;

  v_cycle := (v_prior_count / v_total) + 1;
  INSERT INTO public.stamp_card_visits (
    user_id, restaurant_id, visited_at, card_cycle, added_by_admin, admin_note
  ) VALUES (
    p_user_id, p_restaurant_id, p_visited_at, v_cycle, true, nullif(p_admin_note, '')
  );

  v_new_count := v_prior_count + 1;
  IF v_new_count % v_total = 0 THEN
    INSERT INTO public.stamp_card_rewards (user_id, restaurant_id, card_cycle, redeemed)
    VALUES (p_user_id, p_restaurant_id, v_cycle, false)
    ON CONFLICT (user_id, restaurant_id, card_cycle) DO NOTHING;
  END IF;

  RETURN QUERY SELECT false, (v_new_count % v_total = 0), v_new_count, v_cycle, v_total;
END;
$function$;

COMMIT;
