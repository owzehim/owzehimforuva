-- SEC-44: remove inherited PUBLIC/anon INSERT rights from report tables.

BEGIN;

REVOKE INSERT ON TABLE
  public.restaurant_comment_reports,
  public.restaurant_note_reports
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, comment_id, reporter_id, created_at, reviewed_at, reviewed_by)
  ON TABLE public.restaurant_comment_reports FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, note_id, reporter_id, created_at, reviewed_at, reviewed_by)
  ON TABLE public.restaurant_note_reports FROM PUBLIC, anon, authenticated;

GRANT INSERT (comment_id, reporter_id)
  ON TABLE public.restaurant_comment_reports TO authenticated;
GRANT INSERT (note_id, reporter_id)
  ON TABLE public.restaurant_note_reports TO authenticated;

COMMIT;
