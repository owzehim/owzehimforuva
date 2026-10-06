-- SEC-09: make retention anonymization callable only by the trusted
-- service-role retention job. The legacy invoker function is unused.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.anonymize_expired_members_for_sheets()') IS NULL THEN
    RAISE EXCEPTION
      'SEC-09 public.anonymize_expired_members_for_sheets() is missing';
  END IF;

  IF to_regprocedure('public.anonymize_expired_members()') IS NULL THEN
    RAISE EXCEPTION
      'SEC-09 legacy public.anonymize_expired_members() is missing';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_expired_members_for_sheets()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_expired_members_for_sheets()
  TO service_role;

-- No application code calls this legacy routine; leave it owner-only.
REVOKE ALL ON FUNCTION public.anonymize_expired_members()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
