BEGIN;

-- Decision reasons are no longer part of report processing. Keep the legacy
-- column for old records, but stop exposing it as a client-editable field.
REVOKE UPDATE (decision_reason)
  ON TABLE public.restaurant_note_reports
  FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Admins can review note reports"
  ON public.restaurant_note_reports;
CREATE POLICY "Admins can review note reports"
  ON public.restaurant_note_reports
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (
    public.is_admin()
    AND (
      (
        status = 'resolved'
        AND reviewed_by = (SELECT auth.uid())
        AND reviewed_at IS NOT NULL
        AND decision IS NOT NULL
      )
      OR (
        status = 'pending'
        AND decision IS NULL
        AND reviewed_at IS NULL
        AND reviewed_by IS NULL
      )
    )
  );

DROP TRIGGER IF EXISTS set_note_report_reviewed_metadata
  ON public.restaurant_note_reports;

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

    IF NEW.status = 'pending' AND NEW.decision IS NULL THEN
      NEW.decision_reason := NULL;
      NEW.reviewed_at := NULL;
      NEW.reviewed_by := NULL;
      RETURN NEW;
    END IF;

    IF NEW.status <> 'resolved' OR NEW.decision IS NULL THEN
      RAISE EXCEPTION 'a resolved decision is required';
    END IF;

    NEW.decision_reason := NULL;
    NEW.reviewed_at := pg_catalog.now();
    NEW.reviewed_by := (SELECT auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
