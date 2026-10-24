-- Show profile images on visible, non-anonymous notes. Anonymous notes retain
-- the neutral avatar and nickname supplied by the safe view.
BEGIN;

CREATE OR REPLACE VIEW public.restaurant_notes_safe
WITH (security_barrier = true)
AS
SELECT
  note.id,
  note.restaurant_id,
  (note.user_id = (SELECT auth.uid())) AS is_mine,
  CASE WHEN note.is_anonymous THEN '익명' ELSE note.username END AS username,
  CASE WHEN note.is_anonymous THEN NULL ELSE note.avatar_color_seed END AS avatar_color_seed,
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
  END AS author_is_admin
FROM public.restaurant_notes AS note
WHERE note.hidden_at IS NULL
  AND (SELECT auth.jwt() ->> 'app_access') = 'true'
  AND public.is_current_device_session();

REVOKE ALL ON TABLE public.restaurant_notes_safe FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.restaurant_notes_safe TO authenticated;

-- Storage remains private. Members can read only avatars exposed by their
-- authenticated, active-session view of a visible, non-anonymous note.
DROP POLICY IF EXISTS "SEC52 allow visible note author avatars"
  ON storage.objects;
CREATE POLICY "SEC52 allow visible note author avatars"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND EXISTS (
      SELECT 1
      FROM public.restaurant_notes_safe AS visible_note
      WHERE visible_note.profile_image_url = name
    )
  );

COMMIT;
