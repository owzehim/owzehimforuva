-- SEC-44: keep report submission metadata server-owned and surface open reports first.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_report_submission_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.created_at := pg_catalog.now();
  NEW.reviewed_at := NULL;
  NEW.reviewed_by := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_report_submission_metadata()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS set_comment_report_submission_metadata
  ON public.restaurant_comment_reports;
CREATE TRIGGER set_comment_report_submission_metadata
  BEFORE INSERT ON public.restaurant_comment_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_report_submission_metadata();

DROP TRIGGER IF EXISTS set_note_report_submission_metadata
  ON public.restaurant_note_reports;
CREATE TRIGGER set_note_report_submission_metadata
  BEFORE INSERT ON public.restaurant_note_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_report_submission_metadata();

REVOKE INSERT ON TABLE
  public.restaurant_comment_reports,
  public.restaurant_note_reports
  FROM authenticated;
REVOKE INSERT (id, comment_id, reporter_id, created_at, reviewed_at, reviewed_by)
  ON TABLE public.restaurant_comment_reports FROM authenticated;
REVOKE INSERT (id, note_id, reporter_id, created_at, reviewed_at, reviewed_by)
  ON TABLE public.restaurant_note_reports FROM authenticated;

GRANT INSERT (comment_id, reporter_id)
  ON TABLE public.restaurant_comment_reports TO authenticated;
GRANT INSERT (note_id, reporter_id)
  ON TABLE public.restaurant_note_reports TO authenticated;

COMMIT;
