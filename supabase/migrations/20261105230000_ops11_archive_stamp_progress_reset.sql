-- OPS-11 (CITS report v3): "reset progress" (스탬프 기록 초기화) used to delete a
-- place's stamp visits and rewards outright, so the history was lost.
--
-- Reset now moves those rows into archive tables in one transaction:
--   * admin_reset_stamp_progress() is the only way to reset; service_role only.
--   * Archive rows keep the original ids and timestamps, plus who reset and when.
--   * No client access: RLS on, no policies, no grants for anon/authenticated.
--   * Privacy: user_id references auth.users ON DELETE CASCADE (as the live
--     tables do), so account deletion and retention cleanup also remove the
--     archive; rows are kept 12 months (delete_after), then removed by the
--     daily privacy-retention-sync job.
-- Active tables, the member app and the admin UI are unchanged.

BEGIN;

CREATE TABLE IF NOT EXISTS public.stamp_card_visits_archive (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  visited_at timestamptz NOT NULL,
  card_cycle integer NOT NULL,
  added_by_admin boolean NOT NULL,
  admin_note text,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archived_by uuid NOT NULL,
  delete_after timestamptz NOT NULL DEFAULT (now() + interval '12 months')
);

CREATE TABLE IF NOT EXISTS public.stamp_card_rewards_archive (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  card_cycle integer NOT NULL,
  redeemed boolean NOT NULL,
  redeemed_at timestamptz,
  created_at timestamptz,
  expires_at timestamptz,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archived_by uuid NOT NULL,
  delete_after timestamptz NOT NULL DEFAULT (now() + interval '12 months')
);

CREATE INDEX IF NOT EXISTS stamp_card_visits_archive_restaurant_idx
  ON public.stamp_card_visits_archive (restaurant_id);
CREATE INDEX IF NOT EXISTS stamp_card_visits_archive_user_idx
  ON public.stamp_card_visits_archive (user_id);
CREATE INDEX IF NOT EXISTS stamp_card_visits_archive_delete_after_idx
  ON public.stamp_card_visits_archive (delete_after);
CREATE INDEX IF NOT EXISTS stamp_card_rewards_archive_restaurant_idx
  ON public.stamp_card_rewards_archive (restaurant_id);
CREATE INDEX IF NOT EXISTS stamp_card_rewards_archive_user_idx
  ON public.stamp_card_rewards_archive (user_id);
CREATE INDEX IF NOT EXISTS stamp_card_rewards_archive_delete_after_idx
  ON public.stamp_card_rewards_archive (delete_after);

ALTER TABLE public.stamp_card_visits_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stamp_card_rewards_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stamp_card_visits_archive FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.stamp_card_rewards_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.stamp_card_visits_archive TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.stamp_card_rewards_archive TO service_role;

CREATE OR REPLACE FUNCTION public.admin_reset_stamp_progress(
  p_restaurant_id uuid,
  p_actor_id uuid
)
RETURNS TABLE (archived_visits integer, archived_rewards integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_visits integer := 0;
  v_rewards integer := 0;
BEGIN
  IF p_restaurant_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'restaurant and actor are required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = p_actor_id) THEN
    RAISE EXCEPTION 'only an administrator can reset stamp progress';
  END IF;

  -- Lock the place so a concurrent scan or reset cannot interleave.
  PERFORM 1
  FROM public.restaurants
  WHERE id = p_restaurant_id
    AND is_archived IS FALSE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restaurant not found or archived';
  END IF;

  WITH moved AS (
    DELETE FROM public.stamp_card_rewards
    WHERE restaurant_id = p_restaurant_id
    RETURNING id, user_id, restaurant_id, card_cycle, redeemed, redeemed_at, created_at, expires_at
  )
  INSERT INTO public.stamp_card_rewards_archive (
    id, user_id, restaurant_id, card_cycle, redeemed, redeemed_at, created_at, expires_at, archived_by
  )
  SELECT id, user_id, restaurant_id, card_cycle, redeemed, redeemed_at, created_at, expires_at, p_actor_id
  FROM moved;
  GET DIAGNOSTICS v_rewards = ROW_COUNT;

  WITH moved AS (
    DELETE FROM public.stamp_card_visits
    WHERE restaurant_id = p_restaurant_id
    RETURNING id, user_id, restaurant_id, visited_at, card_cycle, added_by_admin, admin_note
  )
  INSERT INTO public.stamp_card_visits_archive (
    id, user_id, restaurant_id, visited_at, card_cycle, added_by_admin, admin_note, archived_by
  )
  SELECT id, user_id, restaurant_id, visited_at, card_cycle, added_by_admin, admin_note, p_actor_id
  FROM moved;
  GET DIAGNOSTICS v_visits = ROW_COUNT;

  RETURN QUERY SELECT v_visits, v_rewards;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reset_stamp_progress(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_stamp_progress(uuid, uuid) TO service_role;

COMMIT;
