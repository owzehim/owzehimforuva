-- SEC-18: DEV had broad authenticated reads for raw comments and notes.
-- Preserve the production owner-read behavior; sanitized safe views continue
-- to require app_access and the current device session for aggregate reads.
BEGIN;

DROP POLICY IF EXISTS "Authenticated members can read restaurant comments"
  ON public.restaurant_comments;
DROP POLICY IF EXISTS "Authenticated members can read restaurant notes"
  ON public.restaurant_notes;

DROP POLICY IF EXISTS "Members can read own restaurant comments"
  ON public.restaurant_comments;
CREATE POLICY "Members can read own restaurant comments"
  ON public.restaurant_comments
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Members can read own restaurant notes"
  ON public.restaurant_notes;
CREATE POLICY "Members can read own restaurant notes"
  ON public.restaurant_notes
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

COMMIT;
