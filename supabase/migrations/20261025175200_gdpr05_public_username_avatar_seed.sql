-- GDPR-05: keep the notes API's avatar seed limited to the public username.
-- The underlying seed is presentation data and must never be able to re-expose
-- a stale name-derived value through the shared view.
BEGIN;

-- Clean up stale name-derived seeds without running the membership-enforcing
-- note trigger for this privacy-only maintenance update.
ALTER TABLE public.restaurant_notes DISABLE TRIGGER prepare_restaurant_note;

UPDATE public.restaurant_notes AS note
SET avatar_color_seed = CASE
  WHEN note.is_anonymous IS TRUE OR nullif(btrim(note.username), '') IS NULL THEN NULL
  ELSE btrim(note.username)
END
WHERE note.avatar_color_seed IS DISTINCT FROM CASE
  WHEN note.is_anonymous IS TRUE OR nullif(btrim(note.username), '') IS NULL THEN NULL
  ELSE btrim(note.username)
END;

ALTER TABLE public.restaurant_notes ENABLE TRIGGER prepare_restaurant_note;

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
  END AS author_is_admin
FROM public.restaurant_notes AS note
WHERE note.hidden_at IS NULL
  AND (SELECT auth.jwt() ->> 'app_access') = 'true'
  AND public.is_current_device_session();

REVOKE ALL ON TABLE public.restaurant_notes_safe FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.restaurant_notes_safe TO authenticated;

COMMIT;
