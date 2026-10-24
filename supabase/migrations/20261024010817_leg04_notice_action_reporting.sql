-- LEG-04: keep a usable notice record, preserve reported notes, and record
-- human moderation decisions without exposing report details to members.
BEGIN;

ALTER TABLE public.restaurant_notes
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

ALTER TABLE public.restaurant_note_reports
  ADD COLUMN IF NOT EXISTS reporter_name text,
  ADD COLUMN IF NOT EXISTS reporter_email text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS explanation text,
  ADD COLUMN IF NOT EXISTS good_faith boolean,
  ADD COLUMN IF NOT EXISTS note_snapshot text,
  ADD COLUMN IF NOT EXISTS restaurant_name_snapshot text,
  ADD COLUMN IF NOT EXISTS content_author_id uuid,
  ADD COLUMN IF NOT EXISTS content_author_email text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS decision text,
  ADD COLUMN IF NOT EXISTS decision_reason text;

UPDATE public.restaurant_note_reports AS report
SET note_snapshot = note.body,
    restaurant_name_snapshot = restaurant.name,
    status = CASE WHEN report.reviewed_at IS NULL THEN 'pending' ELSE 'resolved' END
FROM public.restaurant_notes AS note
LEFT JOIN public.restaurants AS restaurant ON restaurant.id = note.restaurant_id
WHERE report.note_id = note.id;

ALTER TABLE public.restaurant_note_reports
  ALTER COLUMN note_id DROP NOT NULL,
  ALTER COLUMN reporter_id DROP NOT NULL;

ALTER TABLE public.restaurant_note_reports
  DROP CONSTRAINT IF EXISTS restaurant_note_reports_note_id_fkey,
  DROP CONSTRAINT IF EXISTS restaurant_note_reports_reporter_id_fkey;

ALTER TABLE public.restaurant_note_reports
  ADD CONSTRAINT restaurant_note_reports_note_id_fkey
    FOREIGN KEY (note_id) REFERENCES public.restaurant_notes(id) ON DELETE SET NULL,
  ADD CONSTRAINT restaurant_note_reports_reporter_id_fkey
    FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT restaurant_note_reports_content_author_id_fkey
    FOREIGN KEY (content_author_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.restaurant_note_reports
  ADD CONSTRAINT restaurant_note_reports_status_check
    CHECK (status IN ('pending', 'resolved')),
  ADD CONSTRAINT restaurant_note_reports_decision_check
    CHECK (decision IS NULL OR decision IN ('no_action', 'content_hidden'));

CREATE OR REPLACE FUNCTION public.capture_restaurant_note_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_note record;
  reporter_email_value text;
  author_email_value text;
BEGIN
  IF NEW.reporter_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'reporter must be the current user';
  END IF;
  IF NEW.reason NOT IN ('illegal_threat', 'privacy', 'intellectual_property', 'other_illegal', 'community_guidelines') THEN
    RAISE EXCEPTION 'invalid report reason';
  END IF;
  IF NEW.explanation IS NULL OR char_length(btrim(NEW.explanation)) < 10 OR char_length(NEW.explanation) > 2000 THEN
    RAISE EXCEPTION 'report explanation must be between 10 and 2000 characters';
  END IF;
  IF NEW.reporter_name IS NULL OR char_length(btrim(NEW.reporter_name)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'reporter name is required';
  END IF;
  IF NEW.good_faith IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'good-faith confirmation is required';
  END IF;

  SELECT note.id, note.user_id, note.body, note.restaurant_id,
         restaurant.name AS restaurant_name
  INTO target_note
  FROM public.restaurant_notes AS note
  LEFT JOIN public.restaurants AS restaurant ON restaurant.id = note.restaurant_id
  WHERE note.id = NEW.note_id
    AND note.hidden_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reported note is unavailable';
  END IF;

  SELECT lower(auth_user.email)
  INTO reporter_email_value
  FROM auth.users AS auth_user
  WHERE auth_user.id = NEW.reporter_id;
  IF reporter_email_value IS NULL THEN
    RAISE EXCEPTION 'reporter contact email is unavailable';
  END IF;

  SELECT lower(auth_user.email)
  INTO author_email_value
  FROM auth.users AS auth_user
  WHERE auth_user.id = target_note.user_id;

  NEW.reporter_name := btrim(NEW.reporter_name);
  NEW.reporter_email := reporter_email_value;
  NEW.note_snapshot := target_note.body;
  NEW.restaurant_name_snapshot := target_note.restaurant_name;
  NEW.content_author_id := target_note.user_id;
  NEW.content_author_email := author_email_value;
  NEW.status := 'pending';
  NEW.decision := NULL;
  NEW.decision_reason := NULL;
  NEW.reviewed_at := NULL;
  NEW.reviewed_by := NULL;
  NEW.created_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_restaurant_note_report()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS capture_restaurant_note_report
  ON public.restaurant_note_reports;
CREATE TRIGGER capture_restaurant_note_report
  BEFORE INSERT ON public.restaurant_note_reports
  FOR EACH ROW EXECUTE FUNCTION public.capture_restaurant_note_report();

-- Notes are hidden from members when a moderator acts, while reports retain
-- the submission-time copy for review and follow-up.
CREATE OR REPLACE FUNCTION public.guard_restaurant_note_hidden_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.hidden_at IS DISTINCT FROM OLD.hidden_at
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'only an administrator can hide a note';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_restaurant_note_hidden_at()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_restaurant_note_hidden_at
  ON public.restaurant_notes;
CREATE TRIGGER guard_restaurant_note_hidden_at
  BEFORE UPDATE OF hidden_at ON public.restaurant_notes
  FOR EACH ROW EXECUTE FUNCTION public.guard_restaurant_note_hidden_at();

-- The note preparation trigger should run only for content edits. A moderator
-- must be able to hide another member's note without impersonating its author.
DROP TRIGGER IF EXISTS prepare_restaurant_note ON public.restaurant_notes;
CREATE TRIGGER prepare_restaurant_note
  BEFORE INSERT OR UPDATE OF body, is_anonymous ON public.restaurant_notes
  FOR EACH ROW EXECUTE FUNCTION public.prepare_restaurant_note();

DROP POLICY IF EXISTS "Admins can hide any restaurant note"
  ON public.restaurant_notes;
CREATE POLICY "Admins can hide any restaurant note"
  ON public.restaurant_notes FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE UPDATE (hidden_at) ON TABLE public.restaurant_notes FROM PUBLIC, anon, authenticated;
GRANT UPDATE (hidden_at) ON TABLE public.restaurant_notes TO authenticated;

REVOKE INSERT ON TABLE public.restaurant_note_reports FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, note_id, reporter_id, created_at, reviewed_at, reviewed_by,
               reporter_name, reporter_email, reason, explanation, good_faith,
               note_snapshot, restaurant_name_snapshot, content_author_id,
               content_author_email, status, decision, decision_reason)
  ON TABLE public.restaurant_note_reports FROM PUBLIC, anon, authenticated;
GRANT INSERT (note_id, reporter_id, reporter_name, reason, explanation, good_faith)
  ON TABLE public.restaurant_note_reports TO authenticated;

REVOKE UPDATE ON TABLE public.restaurant_note_reports FROM authenticated;
GRANT UPDATE (status, decision, decision_reason, reviewed_at, reviewed_by)
  ON TABLE public.restaurant_note_reports TO authenticated;

DROP POLICY IF EXISTS "Admins can review note reports"
  ON public.restaurant_note_reports;
CREATE POLICY "Admins can review note reports"
  ON public.restaurant_note_reports
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (
    public.is_admin()
    AND reviewed_by = (SELECT auth.uid())
    AND reviewed_at IS NOT NULL
    AND status = 'resolved'
    AND decision IS NOT NULL
    AND decision_reason IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.set_note_report_decision_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR
     NEW.decision IS DISTINCT FROM OLD.decision OR
     NEW.decision_reason IS DISTINCT FROM OLD.decision_reason THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'only an administrator can resolve a report';
    END IF;
    IF NEW.status <> 'resolved' OR NEW.decision IS NULL OR
       NEW.decision_reason IS NULL OR char_length(btrim(NEW.decision_reason)) < 5 THEN
      RAISE EXCEPTION 'a decision and explanation are required';
    END IF;
    NEW.reviewed_at := pg_catalog.now();
    NEW.reviewed_by := (SELECT auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_note_report_decision_metadata()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS set_note_report_decision_metadata
  ON public.restaurant_note_reports;
CREATE TRIGGER set_note_report_decision_metadata
  BEFORE UPDATE ON public.restaurant_note_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_note_report_decision_metadata();

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
      SELECT 1 FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = note.user_id
    )
  END AS author_is_admin
FROM public.restaurant_notes AS note
WHERE note.hidden_at IS NULL
  AND (SELECT auth.jwt() ->> 'app_access') = 'true'
  AND public.is_current_device_session();

REVOKE ALL ON TABLE public.restaurant_notes_safe FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.restaurant_notes_safe TO authenticated;

CREATE INDEX IF NOT EXISTS restaurant_note_reports_resolved_retention_idx
  ON public.restaurant_note_reports (reviewed_at)
  WHERE status = 'resolved';

COMMIT;
