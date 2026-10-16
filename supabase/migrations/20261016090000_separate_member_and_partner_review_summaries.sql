-- Keep member-facing review summaries live while limiting public/partner
-- summaries to stores reviewed by at least five distinct members.

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
      count(DISTINCT review.user_id)::bigint AS member_count,
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
    CASE WHEN aggregates.member_count >= 5 THEN coalesce(aggregates.average_rating, 0) ELSE 0 END,
    CASE WHEN aggregates.member_count >= 5 THEN aggregates.review_count ELSE 0 END,
    CASE WHEN aggregates.member_count >= 5 THEN
      jsonb_build_object(
        'GREAT_FOOD', aggregates.great_food,
        'FRIENDLY_STAFF', aggregates.friendly_staff,
        'NICE_ATMOSPHERE', aggregates.nice_atmosphere,
        'GOOD_VALUE', aggregates.good_value
      )
    ELSE jsonb_build_object('GREAT_FOOD', 0, 'FRIENDLY_STAFF', 0, 'NICE_ATMOSPHERE', 0, 'GOOD_VALUE', 0)
    END
  FROM aggregates;
$function$;

CREATE OR REPLACE FUNCTION public.get_member_store_review_summaries(p_store_ids text[])
RETURNS TABLE(store_id text, average_rating numeric, review_count bigint, tag_counts jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR (
    NOT public.is_admin()
    AND NOT EXISTS (
      SELECT 1
      FROM public.members AS member
      WHERE member.user_id = auth.uid()
        AND member.is_member IS TRUE
        AND member.membership_valid_until >= (now() AT TIME ZONE 'Europe/Amsterdam')::date
    )
  ) THEN
    RAISE EXCEPTION 'Active member access is required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
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
END;
$function$;

REVOKE ALL ON FUNCTION public.get_store_review_summaries(text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_store_review_summaries(text[])
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_member_store_review_summaries(text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_member_store_review_summaries(text[])
  TO authenticated;

COMMIT;
