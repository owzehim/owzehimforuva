-- SEC-21 / SEC-29: reviews must belong to the caller's redemption, and raw
-- member-level review rows must not be publicly readable. The app receives
-- only small, store-level aggregates through get_store_review_summaries.

BEGIN;

DROP POLICY IF EXISTS "Anyone can read reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users can read own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users can insert own reviews" ON public.reviews;

CREATE POLICY "Members and admins can read own reviews"
  ON public.reviews
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

CREATE POLICY "Members can insert review for own redemption"
  ON public.reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.redemptions AS redemption
      WHERE redemption.id = reviews.redemption_id
        AND redemption.user_id = (SELECT auth.uid())
        AND redemption.store_id = reviews.store_id
        AND redemption.redeemed_at IS NOT NULL
        AND redemption.redeemed_at <= now()
    )
  );

REVOKE SELECT, INSERT ON TABLE public.reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.reviews TO authenticated;

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
    CASE WHEN aggregates.review_count >= 5 THEN coalesce(aggregates.average_rating, 0) ELSE 0 END,
    CASE WHEN aggregates.review_count >= 5 THEN aggregates.review_count ELSE 0 END,
    CASE WHEN aggregates.review_count >= 5 THEN
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

REVOKE ALL ON FUNCTION public.get_store_review_summaries(text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_store_review_summaries(text[])
  TO anon, authenticated, service_role;

COMMIT;
