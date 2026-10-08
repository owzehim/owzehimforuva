-- Let administrators inspect reported content for moderation while keeping
-- ordinary members restricted to their own rows and signed-in app sessions.
BEGIN;

REVOKE ALL ON TABLE public.restaurant_comments, public.restaurant_notes
  FROM PUBLIC, anon;
GRANT SELECT (id, username, is_anonymous, body, created_at)
  ON TABLE public.restaurant_comments, public.restaurant_notes
  TO authenticated;

DROP POLICY IF EXISTS "Admins can read restaurant comments for moderation"
  ON public.restaurant_comments;
CREATE POLICY "Admins can read restaurant comments for moderation"
  ON public.restaurant_comments
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can read restaurant notes for moderation"
  ON public.restaurant_notes;
CREATE POLICY "Admins can read restaurant notes for moderation"
  ON public.restaurant_notes
  FOR SELECT TO authenticated
  USING (public.is_admin());

COMMIT;
