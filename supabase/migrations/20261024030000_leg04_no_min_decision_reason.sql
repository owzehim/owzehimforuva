BEGIN;

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

    NEW.decision_reason := NULLIF(btrim(NEW.decision_reason), '');
    IF NEW.status <> 'resolved' OR NEW.decision IS NULL OR
       NEW.decision_reason IS NULL THEN
      RAISE EXCEPTION 'a decision reason is required';
    END IF;

    NEW.reviewed_at := pg_catalog.now();
    NEW.reviewed_by := (SELECT auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_note_report_decision_metadata()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
