-- SEC-42: make reviews and check-ins server-limited to one per member,
-- partner restaurant, and Europe/Amsterdam calendar day.

BEGIN;

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
    AND (r.redeemed_at AT TIME ZONE 'Europe/Amsterdam')::date =
        (v_now AT TIME ZONE 'Europe/Amsterdam')::date
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

CREATE OR REPLACE FUNCTION public.enforce_daily_review_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_redemption record;
  v_member record;
  v_visit_day date;
BEGIN
  IF NEW.user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'review must belong to the current member';
  END IF;

  SELECT d.user_id, d.store_id, d.redeemed_at
    INTO v_redemption
  FROM public.redemptions AS d
  WHERE d.id = NEW.redemption_id;

  IF NOT FOUND
     OR v_redemption.user_id IS DISTINCT FROM NEW.user_id
     OR v_redemption.store_id IS DISTINCT FROM NEW.store_id
     OR v_redemption.redeemed_at IS NULL
     OR v_redemption.redeemed_at > now() THEN
    RAISE EXCEPTION 'review must match a valid visit';
  END IF;

  SELECT m.is_member, m.membership_valid_until,
         m.account_status, m.identity_anonymized_at
    INTO v_member
  FROM public.members AS m
  WHERE m.user_id = NEW.user_id;

  IF v_member.is_member IS NOT TRUE
     OR v_member.membership_valid_until IS NULL
     OR v_member.membership_valid_until < (now() AT TIME ZONE 'Europe/Amsterdam')::date
     OR v_member.account_status IS DISTINCT FROM 'active'
     OR v_member.identity_anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'only active members can review a visit';
  END IF;

  v_visit_day := (v_redemption.redeemed_at AT TIME ZONE 'Europe/Amsterdam')::date;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      NEW.user_id::text || ':' || NEW.store_id || ':' || v_visit_day::text,
      0
    )
  );

  IF EXISTS (
    SELECT 1
    FROM public.reviews AS existing_review
    JOIN public.redemptions AS existing_visit
      ON existing_visit.id = existing_review.redemption_id
    WHERE existing_review.user_id = NEW.user_id
      AND existing_review.store_id = NEW.store_id
      AND (existing_visit.redeemed_at AT TIME ZONE 'Europe/Amsterdam')::date = v_visit_day
  ) THEN
    RAISE EXCEPTION 'one review per restaurant per visit day';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_daily_review_limit()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_daily_review_limit ON public.reviews;
CREATE TRIGGER enforce_daily_review_limit
  BEFORE INSERT ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_daily_review_limit();

COMMIT;
