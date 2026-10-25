BEGIN;

ALTER TABLE public.restaurant_note_reports
  DROP CONSTRAINT IF EXISTS restaurant_note_reports_decision_check;

ALTER TABLE public.restaurant_note_reports
  ADD CONSTRAINT restaurant_note_reports_decision_check
  CHECK (decision IS NULL OR decision IN ('no_action', 'content_hidden', 'content_deleted'));

COMMIT;
