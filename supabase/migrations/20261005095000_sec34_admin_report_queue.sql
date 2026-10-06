-- SEC-34: give administrators a private, auditable way to review reports.
BEGIN;

ALTER TABLE public.restaurant_comment_reports
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid;
ALTER TABLE public.restaurant_note_reports
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid;

CREATE OR REPLACE FUNCTION public.set_report_reviewed_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.reviewed_at := now();
  NEW.reviewed_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_comment_report_reviewed_metadata
  ON public.restaurant_comment_reports;
CREATE TRIGGER set_comment_report_reviewed_metadata
  BEFORE UPDATE OF reviewed_at, reviewed_by ON public.restaurant_comment_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_report_reviewed_metadata();
DROP TRIGGER IF EXISTS set_note_report_reviewed_metadata
  ON public.restaurant_note_reports;
CREATE TRIGGER set_note_report_reviewed_metadata
  BEFORE UPDATE OF reviewed_at, reviewed_by ON public.restaurant_note_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_report_reviewed_metadata();

DROP POLICY IF EXISTS "Admins can review comment reports"
  ON public.restaurant_comment_reports;
CREATE POLICY "Admins can review comment reports"
  ON public.restaurant_comment_reports
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (
    public.is_admin()
    AND reviewed_by = (SELECT auth.uid())
    AND reviewed_at IS NOT NULL
  );

DROP POLICY IF EXISTS "Admins can review note reports"
  ON public.restaurant_note_reports;
DROP POLICY IF EXISTS "Admins can read note reports"
  ON public.restaurant_note_reports;
CREATE POLICY "Admins can read note reports"
  ON public.restaurant_note_reports
  FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY "Admins can review note reports"
  ON public.restaurant_note_reports
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (
    public.is_admin()
    AND reviewed_by = (SELECT auth.uid())
    AND reviewed_at IS NOT NULL
  );

REVOKE UPDATE ON TABLE public.restaurant_comment_reports FROM authenticated;
GRANT UPDATE (reviewed_at, reviewed_by)
  ON TABLE public.restaurant_comment_reports TO authenticated;
REVOKE UPDATE ON TABLE public.restaurant_note_reports FROM authenticated;
GRANT UPDATE (reviewed_at, reviewed_by)
  ON TABLE public.restaurant_note_reports TO authenticated;

CREATE INDEX IF NOT EXISTS restaurant_comment_reports_open_created_idx
  ON public.restaurant_comment_reports (created_at DESC)
  WHERE reviewed_at IS NULL;
CREATE INDEX IF NOT EXISTS restaurant_note_reports_open_created_idx
  ON public.restaurant_note_reports (created_at DESC)
  WHERE reviewed_at IS NULL;

COMMIT;
