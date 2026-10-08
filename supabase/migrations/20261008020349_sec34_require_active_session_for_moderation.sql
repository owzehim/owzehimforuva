-- Keep moderation reads behind the same active-device gate as member content.
BEGIN;

DROP POLICY IF EXISTS "Admins can read restaurant comments for moderation"
  ON public.restaurant_comments;
CREATE POLICY "Admins can read restaurant comments for moderation"
  ON public.restaurant_comments
  FOR SELECT TO authenticated
  USING (public.is_admin() AND public.is_current_device_session());

DROP POLICY IF EXISTS "Admins can read restaurant notes for moderation"
  ON public.restaurant_notes;
CREATE POLICY "Admins can read restaurant notes for moderation"
  ON public.restaurant_notes
  FOR SELECT TO authenticated
  USING (public.is_admin() AND public.is_current_device_session());

COMMIT;
