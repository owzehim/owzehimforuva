-- Public app visitors can see live location-level rating and tag summaries.
-- Individual member notes remain available only to signed-in active members.

BEGIN;

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
  ), aggregates AS (
    SELECT
      requested.store_id,
      count(review.id)::bigint AS review_count,
      round(avg(review.rating), 1)::numeric AS average_rating,
      count(review.id) FILTER (WHERE 'GREAT_FOOD' = ANY(review.tags))::bigint AS great_food,
      count(review.id) FILTER (WHERE 'FRIENDLY_STAFF' = ANY(review.tags))::bigint AS friendly_staff,
      count(review.id) FILTER (WHERE 'NICE_ATMOSPHERE' = ANY(review.tags))::bigint AS nice_atmosphere,
      count(review.id) FILTER (WHERE 'GOOD_VALUE' = ANY(review.tags))::bigint AS good_value
    FROM requested
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

COMMIT;
