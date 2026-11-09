-- SEC-56 (CITS report v3.0, recommendation 2): the notes view no longer hands
-- out profile photo storage paths (avatars/<user_id>.jpg).
--
--   * restaurant_notes_safe.profile_image_url is always NULL (kept so an app
--     version that still reads it just shows the colour avatar) and a new
--     has_author_photo flag says whether a photo exists.
--   * Photos are served by the note-author-photos Edge Function, which signs
--     the owner's path with the service role after the same login checks as
--     this view. The Storage policy that let members read note-author photos
--     directly, and its helper function, are removed: a member can now read
--     only their own photo from Storage.
--
-- Deploy order: note-author-photos function → this migration → frontend.
-- Apply to DEV first, then production, as this single file with its ledger row.

BEGIN;

CREATE OR REPLACE VIEW public.restaurant_notes_safe
WITH (security_barrier = true) AS
SELECT
  note.id,
  note.restaurant_id,
  note.user_id = (SELECT auth.uid()) AS is_mine,
  CASE WHEN note.is_anonymous THEN '익명'::text ELSE note.username END AS username,
  CASE WHEN note.is_anonymous THEN NULL::text ELSE note.username END AS avatar_color_seed,
  NULL::text AS profile_image_url,
  note.is_anonymous,
  note.body,
  note.created_at,
  note.updated_at,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_redemption_id ELSE NULL::bigint END AS source_redemption_id,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_store_id ELSE NULL::text END AS source_store_id,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_rating ELSE NULL::numeric END AS source_rating,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_tags ELSE NULL::text[] END AS source_tags,
  CASE
    WHEN note.is_anonymous THEN false
    ELSE EXISTS (SELECT 1 FROM public.admin_roles AS admin_role WHERE admin_role.user_id = note.user_id)
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
  ) AS is_visit_verified,
  (note.is_anonymous IS NOT TRUE AND note.profile_image_url IS NOT NULL) AS has_author_photo
FROM public.restaurant_notes AS note
WHERE note.hidden_at IS NULL
  AND (SELECT auth.jwt() ->> 'app_access') = 'true'
  AND (SELECT public.is_current_device_session());

DROP POLICY IF EXISTS "SEC56 read visible note author avatars" ON storage.objects;
DROP FUNCTION IF EXISTS public.can_read_note_author_avatar(text);

COMMIT;
