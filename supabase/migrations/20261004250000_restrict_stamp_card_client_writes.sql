-- SEC-04: clients may read their stamp-card state but may not write visits
-- or reward state. All mutations go through authenticated Edge Functions.

BEGIN;

DO $$
DECLARE
  required record;
  missing_columns text;
BEGIN
  FOR required IN
    SELECT *
    FROM (VALUES
      ('stamp_card_visits', ARRAY[
        'id', 'user_id', 'restaurant_id', 'visited_at', 'card_cycle',
        'added_by_admin', 'admin_note'
      ]::text[]),
      ('stamp_card_rewards', ARRAY[
        'id', 'user_id', 'restaurant_id', 'card_cycle', 'redeemed',
        'redeemed_at', 'created_at'
      ]::text[]),
      ('redemptions', ARRAY[
        'id', 'user_id', 'store_id', 'redeemed_at'
      ]::text[])
    ) AS expected(table_name, column_names)
  LOOP
    SELECT string_agg(expected_column.column_name, ', ' ORDER BY expected_column.column_name)
    INTO missing_columns
    FROM unnest(required.column_names) AS expected_column(column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = required.table_name
        AND actual.column_name = expected_column.column_name
    );

    IF missing_columns IS NOT NULL THEN
      RAISE EXCEPTION
        'SEC-04 expected public.% columns are missing: %',
        required.table_name,
        missing_columns;
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.stamp_card_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stamp_card_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.redemptions ENABLE ROW LEVEL SECURITY;

-- Stop concurrent/replayed check-ins or admin entries from creating multiple
-- visits for the same member/store on one Europe/Amsterdam calendar day.
-- Enforce one reward per cycle.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.stamp_card_visits
    GROUP BY user_id, restaurant_id,
      (visited_at AT TIME ZONE 'Europe/Amsterdam')::date
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'SEC-04 found duplicate visits on a Europe/Amsterdam day; review existing rows before applying the unique index';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.stamp_card_rewards
    GROUP BY user_id, restaurant_id, card_cycle
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'SEC-04 found duplicate rewards for a card cycle; review existing rows before applying the unique index';
  END IF;
END;
$$;

-- Recreate this named index so an earlier UTC-day draft cannot remain active.
DROP INDEX IF EXISTS public.stamp_card_visits_member_daily_unique;

CREATE UNIQUE INDEX stamp_card_visits_member_daily_unique
  ON public.stamp_card_visits (
    user_id,
    restaurant_id,
    ((visited_at AT TIME ZONE 'Europe/Amsterdam')::date)
  );

CREATE UNIQUE INDEX IF NOT EXISTS stamp_card_rewards_cycle_unique
  ON public.stamp_card_rewards (user_id, restaurant_id, card_cycle);

-- Atomically deduplicate check-ins for the same member and store over 15 min.
-- The Edge Function records (or recognizes) today's stamp first, then calls
-- this function before sending a new Sheets event.
CREATE OR REPLACE FUNCTION public.claim_redemption_window(
  p_user_id uuid,
  p_store_id text
)
RETURNS TABLE (redemption_id text, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz;
  v_existing_id text;
  v_new_id text;
BEGIN
  IF p_user_id IS NULL OR p_store_id IS NULL OR p_store_id = '' THEN
    RAISE EXCEPTION 'user and store are required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_store_id, 0)
  );
  v_now := clock_timestamp();

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

  INSERT INTO public.redemptions (user_id, store_id, redeemed_at)
  VALUES (p_user_id, p_store_id, v_now)
  RETURNING id::text INTO v_new_id;

  RETURN QUERY SELECT v_new_id, true;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_redemption_window(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_redemption_window(uuid, text)
  TO service_role;

-- Replace every existing policy to ensure no permissive INSERT/UPDATE/DELETE
-- or ALL policy can combine with the intended read-only client access.
DO $$
DECLARE
  existing_policy record;
BEGIN
  FOR existing_policy IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('stamp_card_visits', 'stamp_card_rewards', 'redemptions')
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      existing_policy.policyname,
      existing_policy.schemaname,
      existing_policy.tablename
    );
  END LOOP;
END;
$$;

CREATE POLICY "Members and admins can read stamp visits"
  ON public.stamp_card_visits FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

CREATE POLICY "Members and admins can read stamp rewards"
  ON public.stamp_card_rewards FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

CREATE POLICY "Members and admins can read own redemptions"
  ON public.redemptions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

-- Remove table-level and column-level client privileges. The service role
-- keeps its existing grants and is used only from trusted Edge Functions.
REVOKE ALL ON TABLE public.stamp_card_visits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.stamp_card_rewards FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.redemptions FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  target record;
  table_columns text;
BEGIN
  FOR target IN
    SELECT unnest(ARRAY['stamp_card_visits', 'stamp_card_rewards', 'redemptions']) AS table_name
  LOOP
    SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
    INTO table_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = target.table_name;

    IF table_columns IS NULL THEN
      RAISE EXCEPTION 'SEC-04 could not find public.% columns', target.table_name;
    END IF;

    EXECUTE format(
      'REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      table_columns,
      target.table_name
    );
  END LOOP;
END;
$$;

GRANT SELECT ON TABLE public.stamp_card_visits TO authenticated;
GRANT SELECT ON TABLE public.stamp_card_rewards TO authenticated;
GRANT SELECT ON TABLE public.redemptions TO authenticated;

COMMIT;
