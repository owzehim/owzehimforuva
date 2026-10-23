-- Add a display-only admin flag to signed-in comment and note projections.
-- Do not expose author IDs; anonymous posts never receive a badge.
BEGIN;

CREATE OR REPLACE VIEW public.restaurant_comments_safe
WITH (security_barrier = true)
AS
SELECT
  comment.id,
  comment.restaurant_id,
  (comment.user_id = (SELECT auth.uid())) AS is_mine,
  CASE WHEN comment.is_anonymous THEN '익명' ELSE comment.username END AS username,
  comment.is_anonymous,
  comment.body,
  comment.created_at,
  comment.updated_at,
  CASE
    WHEN comment.is_anonymous THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = comment.user_id
    )
  END AS author_is_admin
FROM public.restaurant_comments AS comment
WHERE (SELECT auth.jwt() ->> 'app_access') = 'true'
  AND public.is_current_device_session();

CREATE OR REPLACE VIEW public.restaurant_notes_safe
WITH (security_barrier = true)
AS
SELECT
  note.id,
  note.restaurant_id,
  (note.user_id = (SELECT auth.uid())) AS is_mine,
  CASE WHEN note.is_anonymous THEN '익명' ELSE note.username END AS username,
  CASE WHEN note.is_anonymous THEN NULL ELSE note.avatar_color_seed END AS avatar_color_seed,
  CASE WHEN note.is_anonymous OR note.user_id <> (SELECT auth.uid()) THEN NULL ELSE note.profile_image_url END AS profile_image_url,
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
  END AS author_is_admin
FROM public.restaurant_notes AS note
WHERE (SELECT auth.jwt() ->> 'app_access') = 'true'
  AND public.is_current_device_session();

COMMIT;
