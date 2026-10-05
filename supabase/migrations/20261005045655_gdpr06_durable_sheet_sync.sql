-- GDPR-06: retain a minimal, private retry queue until downstream Sheets
-- anonymization succeeds. The queue is populated in the same transaction as
-- the existing anonymization RPC so an Edge Function crash cannot lose IDs.

BEGIN;

CREATE TABLE IF NOT EXISTS public.privacy_sheet_sync_queue (
  user_id uuid PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

ALTER TABLE public.privacy_sheet_sync_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.privacy_sheet_sync_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.privacy_sheet_sync_queue TO service_role;

CREATE OR REPLACE FUNCTION public.queue_expired_member_anonymizations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  queued_count integer;
BEGIN
  INSERT INTO public.privacy_sheet_sync_queue (user_id)
  SELECT result.anonymized_user_id
  FROM public.anonymize_expired_members_for_sheets() AS result
  ON CONFLICT (user_id) DO NOTHING;

  GET DIAGNOSTICS queued_count = ROW_COUNT;
  RETURN queued_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_privacy_sheet_sync_batch(p_batch_size integer DEFAULT 50)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  WITH candidates AS (
    SELECT queue.user_id
    FROM public.privacy_sheet_sync_queue AS queue
    WHERE queue.lease_until IS NULL OR queue.lease_until < now()
    ORDER BY queue.queued_at, queue.user_id
    LIMIT greatest(1, least(coalesce(p_batch_size, 50), 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.privacy_sheet_sync_queue AS queue
  SET lease_until = now() + interval '10 minutes',
      attempts = queue.attempts + 1
  FROM candidates
  WHERE queue.user_id = candidates.user_id
  RETURNING queue.user_id;
$function$;

CREATE OR REPLACE FUNCTION public.complete_privacy_sheet_sync(p_user_id uuid, p_success boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  affected_count integer;
BEGIN
  IF coalesce(p_success, false) THEN
    DELETE FROM public.privacy_sheet_sync_queue WHERE user_id = p_user_id;
  ELSE
    UPDATE public.privacy_sheet_sync_queue
    SET lease_until = NULL
    WHERE user_id = p_user_id;
  END IF;

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.queue_expired_member_anonymizations()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_privacy_sheet_sync_batch(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_privacy_sheet_sync(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_expired_member_anonymizations()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_privacy_sheet_sync_batch(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_privacy_sheet_sync(uuid, boolean)
  TO service_role;

COMMIT;
