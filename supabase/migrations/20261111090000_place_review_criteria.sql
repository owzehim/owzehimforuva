-- 멤버 평가 criteria per place (낙서장 phase 3).
--
-- Reviews keep storing the same 4 tag slots (GREAT_FOOD, FRIENDLY_STAFF,
-- NICE_ATMOSPHERE, GOOD_VALUE). A place can rename the slots and pick their
-- icons in restaurants.review_criteria; NULL means the default restaurant
-- criteria. When an admin changes a place's criteria, review_criteria_since
-- is set to now() and the public 멤버 평가 counts only reviews after it, so
-- old votes never show under new names. Ratings, review counts, saved reviews
-- and the sheets are not affected.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS review_criteria jsonb,
  ADD COLUMN IF NOT EXISTS review_criteria_since timestamptz;

ALTER TABLE public.restaurants
  DROP CONSTRAINT IF EXISTS restaurants_review_criteria_shape_check,
  ADD CONSTRAINT restaurants_review_criteria_shape_check
    CHECK (
      review_criteria IS NULL
      OR (
        jsonb_typeof(review_criteria) = 'array'
        AND jsonb_array_length(review_criteria) = 4
        AND pg_column_size(review_criteria) <= 4096
      )
    );

COMMENT ON COLUMN public.restaurants.review_criteria IS
  '멤버 평가 criteria for the 4 review tag slots: [{label, icon}] x4, or NULL for the default restaurant criteria.';
COMMENT ON COLUMN public.restaurants.review_criteria_since IS
  'Set automatically when review_criteria changes; 멤버 평가 tag counts include only reviews from this time.';

CREATE OR REPLACE FUNCTION public.restaurants_track_review_criteria_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.review_criteria_since := CASE WHEN NEW.review_criteria IS NULL THEN NULL ELSE now() END;
  ELSIF NEW.review_criteria IS DISTINCT FROM OLD.review_criteria THEN
    NEW.review_criteria_since := now();
  ELSE
    -- Only the trigger moves the reset time.
    NEW.review_criteria_since := OLD.review_criteria_since;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.restaurants_track_review_criteria_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS restaurants_track_review_criteria_change ON public.restaurants;
CREATE TRIGGER restaurants_track_review_criteria_change
  BEFORE INSERT OR UPDATE ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public.restaurants_track_review_criteria_change();

CREATE OR REPLACE FUNCTION public.get_store_review_summaries(p_store_ids text[])
RETURNS TABLE(store_id text, average_rating numeric, review_count bigint, tag_counts jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH requested AS (
    SELECT DISTINCT requested_store.store_id
    FROM unnest(coalesce(p_store_ids, ARRAY[]::text[])) AS requested_store(store_id)
    WHERE requested_store.store_id IS NOT NULL
      AND cardinality(coalesce(p_store_ids, ARRAY[]::text[])) <= 100
    LIMIT 100
  ), criteria_reset AS (
    SELECT requested.store_id, max(place.review_criteria_since) AS since
    FROM requested
    LEFT JOIN public.restaurants AS place ON place.partnership_id = requested.store_id
    GROUP BY requested.store_id
  ), aggregates AS (
    SELECT
      requested.store_id,
      count(review.id)::bigint AS review_count,
      round(avg(review.rating), 1)::numeric AS average_rating,
      count(review.id) FILTER (WHERE 'GREAT_FOOD' = ANY(review.tags) AND (criteria_reset.since IS NULL OR review.created_at >= criteria_reset.since))::bigint AS great_food,
      count(review.id) FILTER (WHERE 'FRIENDLY_STAFF' = ANY(review.tags) AND (criteria_reset.since IS NULL OR review.created_at >= criteria_reset.since))::bigint AS friendly_staff,
      count(review.id) FILTER (WHERE 'NICE_ATMOSPHERE' = ANY(review.tags) AND (criteria_reset.since IS NULL OR review.created_at >= criteria_reset.since))::bigint AS nice_atmosphere,
      count(review.id) FILTER (WHERE 'GOOD_VALUE' = ANY(review.tags) AND (criteria_reset.since IS NULL OR review.created_at >= criteria_reset.since))::bigint AS good_value
    FROM requested
    JOIN criteria_reset ON criteria_reset.store_id = requested.store_id
    LEFT JOIN public.reviews AS review ON review.store_id = requested.store_id
    GROUP BY requested.store_id
  )
  SELECT
    aggregates.store_id,
    coalesce(aggregates.average_rating, 0),
    aggregates.review_count,
    jsonb_build_object(
      'GREAT_FOOD', aggregates.great_food,
      'FRIENDLY_STAFF', aggregates.friendly_staff,
      'NICE_ATMOSPHERE', aggregates.nice_atmosphere,
      'GOOD_VALUE', aggregates.good_value
    )
  FROM aggregates;
$function$;
