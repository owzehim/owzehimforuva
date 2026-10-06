-- SEC-07: make profile images private and restrict writes to trusted owners/admins.
-- Place/event images remain public-read for the app, but only admins can mutate them.

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'profile-images') THEN
    RAISE EXCEPTION 'SEC-07: storage bucket profile-images does not exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'place-images') THEN
    RAISE EXCEPTION 'SEC-07: storage bucket place-images does not exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'event-images') THEN
    RAISE EXCEPTION 'SEC-07: storage bucket event-images does not exist';
  END IF;
END
$preflight$;

UPDATE storage.buckets SET public = false WHERE id = 'profile-images';
UPDATE storage.buckets SET public = true WHERE id IN ('place-images', 'event-images');

-- Remove every existing policy that references any of the three affected buckets,
-- including broad legacy policies whose names are not known in every environment.
DO $drop_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT p.policyname
    FROM pg_policies AS p
    WHERE p.schemaname = 'storage'
      AND p.tablename = 'objects'
      AND concat_ws(' ', p.qual, p.with_check) ~* '(profile-images|place-images|event-images)'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', policy_row.policyname);
  END LOOP;
END
$drop_policies$;

-- A member can access only their own fixed avatar path. Admins can manage the
-- bucket through SEC-01's server-controlled public.is_admin() function.
CREATE POLICY "SEC07 profile owner read own avatar"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND name = 'avatars/' || (SELECT auth.uid())::text || '.jpg'
    AND owner_id = (SELECT auth.uid())::text
  );

CREATE POLICY "SEC07 profile owner upload own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-images'
    AND name = 'avatars/' || (SELECT auth.uid())::text || '.jpg'
    AND owner_id = (SELECT auth.uid())::text
  );

CREATE POLICY "SEC07 profile owner replace own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND name = 'avatars/' || (SELECT auth.uid())::text || '.jpg'
    AND owner_id = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'profile-images'
    AND name = 'avatars/' || (SELECT auth.uid())::text || '.jpg'
    AND owner_id = (SELECT auth.uid())::text
  );

CREATE POLICY "SEC07 profile owner delete own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND name = 'avatars/' || (SELECT auth.uid())::text || '.jpg'
    AND owner_id = (SELECT auth.uid())::text
  );

CREATE POLICY "SEC07 admin manage profile images"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'profile-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'profile-images' AND public.is_admin());

CREATE POLICY "SEC07 admin manage place images"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'place-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'place-images' AND public.is_admin());

CREATE POLICY "SEC07 admin manage event images"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'event-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'event-images' AND public.is_admin());

-- Existing member records may hold public URLs. Store only the object path so the
-- client can request a short-lived signed URL after authorization. The UI helper
-- also accepts legacy URLs still present in restaurant_notes.
UPDATE public.members
SET profile_image_url = regexp_replace(
  profile_image_url,
  '^.*?/object/(public|sign)/profile-images/([^?]+).*$',
  '\2'
)
WHERE profile_image_url ~ '/object/(public|sign)/profile-images/';
