-- Show the QR visit marker on any note written after a verified check-in
-- to the same restaurant, including standalone notes that are not reviews.
-- Only expose the boolean; keep visit identifiers private.

BEGIN;

CREATE OR REPLACE VIEW public.restaurant_notes_safe
WITH (security_barrier = true)
AS
SELECT
  note.id,
  note.restaurant_id,
  (note.user_id = (SELECT auth.uid())) AS is_mine,
  CASE WHEN note.is_anonymous THEN '익명' ELSE note.username END AS username,
  CASE WHEN note.is_anonymous THEN NULL ELSE note.username END AS avatar_color_seed,
  CASE
    WHEN note.is_anonymous THEN NULL
    ELSE regexp_replace(
      note.profile_image_url,
      '^.*?/object/(public|sign)/profile-images/([^?]+).*$',
      '\2'
    )
  END AS profile_image_url,
  note.is_anonymous,
  note.body,
  note.created_at,
  note.updated_at,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_redemption_id ELSE NULL END AS source_redemption_id,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_store_id ELSE NULL END AS source_store_id,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_rating ELSE NULL END AS source_rating,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_tags ELSE NULL END AS source_tags,
  CASE
    WHEN note.is_anonymous THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = note.user_id
    )
  END AS author_is_admin,
  EXISTS (
    SELECT 1
    FROM public.redemptions AS redemption
    JOIN public.restaurants AS restaurant
      ON restaurant.id = note.restaurant_id
     AND restaurant.partnership_id = redemption.store_id
    WHERE redemption.user_id = note.user_id
      AND redemption.redeemed_at IS NOT NULL
      AND redemption.redeemed_at <= note.created_at
  ) AS is_visit_verified
FROM public.restaurant_notes AS note
WHERE note.hidden_at IS NULL
  AND (SELECT auth.jwt() ->> 'app_access') = 'true'
  AND public.is_current_device_session();

REVOKE ALL ON TABLE public.restaurant_notes_safe FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.restaurant_notes_safe TO authenticated;

COMMIT;
