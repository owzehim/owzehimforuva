-- GDPR-12: anonymize naturally expired memberships and delete accounts that
-- never received a membership after 12 months. Auth deletion is queued for the
-- retention Edge Function so it uses Supabase Auth's admin API.

BEGIN;

CREATE TABLE IF NOT EXISTS public.privacy_sheet_sync_queue (
  user_id uuid PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  delete_auth_user boolean NOT NULL DEFAULT false
);

ALTER TABLE public.privacy_sheet_sync_queue
  ADD COLUMN IF NOT EXISTS delete_auth_user boolean NOT NULL DEFAULT false;
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
  queued_count integer := 0;
  affected_count integer := 0;
  inactive_count integer := 0;
BEGIN
  -- The old trigger only populated membership_ended_at when a past expiry date
  -- was written. Populate it for dates that expired naturally while no row was
  -- being updated, then let the existing transactional anonymizer process them.
  UPDATE public.members
  SET membership_ended_at = membership_valid_until
  WHERE membership_ended_at IS NULL
    AND membership_valid_until IS NOT NULL
    AND membership_valid_until < current_date - interval '12 months'
    AND identity_anonymized_at IS NULL;

  CREATE TEMP TABLE IF NOT EXISTS gdpr12_expired_member_ids (
    user_id uuid PRIMARY KEY
  ) ON COMMIT DROP;
  TRUNCATE TABLE gdpr12_expired_member_ids;

  INSERT INTO gdpr12_expired_member_ids (user_id)
  SELECT result.anonymized_user_id
  FROM public.anonymize_expired_members_for_sheets() AS result
  WHERE result.anonymized_user_id IS NOT NULL
  ON CONFLICT (user_id) DO NOTHING;

  -- These two identifiers were not included in the original anonymization RPC.
  UPDATE public.members AS member
  SET username = NULL,
      pending_student_number = NULL,
      is_member = false
  WHERE member.user_id IN (SELECT expired.user_id FROM gdpr12_expired_member_ids AS expired);

  INSERT INTO public.privacy_sheet_sync_queue (user_id, delete_auth_user)
  SELECT expired.user_id, false
  FROM gdpr12_expired_member_ids AS expired
  ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  queued_count := queued_count + affected_count;

  CREATE TEMP TABLE IF NOT EXISTS gdpr12_inactive_account_ids (
    user_id uuid
  ) ON COMMIT DROP;
  TRUNCATE TABLE gdpr12_inactive_account_ids;

  -- A member row is created only after email confirmation. Use Auth's signup
  -- timestamp as the retention clock. Preserve admin accounts and any account
  -- that has ever had a membership date.
  WITH stale_accounts AS (
    SELECT member.id
    FROM public.members AS member
    JOIN auth.users AS auth_user ON auth_user.id = member.user_id
    WHERE member.is_member IS FALSE
      AND member.membership_valid_until IS NULL
      AND member.membership_ended_at IS NULL
      AND member.identity_anonymized_at IS NULL
      AND member.account_status = 'active'
      AND auth_user.created_at < now() - interval '12 months'
      AND NOT EXISTS (
        SELECT 1
        FROM public.admin_roles AS admin_role
        WHERE admin_role.user_id = member.user_id
      )
    ORDER BY auth_user.created_at, member.id
    FOR UPDATE OF member SKIP LOCKED
  ), scrubbed_accounts AS (
    UPDATE public.members AS member
    SET first_name = NULL,
        last_name = NULL,
        first_name_korean = NULL,
        last_name_korean = NULL,
        "University" = NULL,
        student_number = NULL,
        pending_student_number = NULL,
        major = NULL,
        education_level = NULL,
        year_number = NULL,
        year_of_birth = NULL,
        country_of_origin = NULL,
        gender = NULL,
        username = NULL,
        profile_image_url = NULL,
        session_token = NULL,
        is_member = false,
        account_status = 'anonymized',
        identity_anonymized_at = now()
    FROM stale_accounts
    WHERE member.id = stale_accounts.id
    RETURNING member.user_id
  )
  INSERT INTO gdpr12_inactive_account_ids (user_id)
  SELECT scrubbed_accounts.user_id
  FROM scrubbed_accounts
  WHERE scrubbed_accounts.user_id IS NOT NULL;

  SELECT count(*)::integer
  INTO inactive_count
  FROM gdpr12_inactive_account_ids;

  IF inactive_count > 0 THEN
    INSERT INTO public.privacy_action_log (action, record_count, details)
    VALUES (
      'anonymize_inactive_member_accounts',
      inactive_count,
      jsonb_build_object(
        'retention_rule', 'auth.users.created_at + 12 months; no membership dates',
        'auth_account_deletion_queued', true
      )
    );
  END IF;

  INSERT INTO public.privacy_sheet_sync_queue (user_id, delete_auth_user)
  SELECT DISTINCT inactive.user_id, true
  FROM gdpr12_inactive_account_ids AS inactive
  ON CONFLICT (user_id) DO UPDATE
  SET delete_auth_user = true,
      lease_until = NULL;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  queued_count := queued_count + affected_count;

  RETURN queued_count;
END;
$function$;

-- Keep old Edge Function deployments from treating Auth-deletion queue rows as
-- ordinary Google Sheets anonymization work during a staged deployment.
CREATE OR REPLACE FUNCTION public.claim_privacy_sheet_sync_batch(p_batch_size integer DEFAULT 50)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  WITH candidates AS (
    SELECT queue.user_id
    FROM public.privacy_sheet_sync_queue AS queue
    WHERE queue.delete_auth_user IS FALSE
      AND (queue.lease_until IS NULL OR queue.lease_until < now())
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

CREATE OR REPLACE FUNCTION public.claim_privacy_retention_batch(p_batch_size integer DEFAULT 50)
RETURNS TABLE (user_id uuid, delete_auth_user boolean)
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
  RETURNING queue.user_id, queue.delete_auth_user;
$function$;

CREATE OR REPLACE FUNCTION public.count_overdue_member_retention()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT count(*)::integer
  FROM public.members AS member
  WHERE member.identity_anonymized_at IS NULL
    AND (
      coalesce(member.membership_ended_at, member.membership_valid_until)
        < current_date - interval '12 months'
      OR (
        member.is_member IS FALSE
        AND member.membership_valid_until IS NULL
        AND member.membership_ended_at IS NULL
        AND member.account_status = 'active'
        AND EXISTS (
          SELECT 1
          FROM auth.users AS auth_user
          WHERE auth_user.id = member.user_id
            AND auth_user.created_at < now() - interval '12 months'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.admin_roles AS admin_role
          WHERE admin_role.user_id = member.user_id
        )
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.queue_expired_member_anonymizations()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_expired_member_anonymizations()
  TO service_role;
REVOKE ALL ON FUNCTION public.claim_privacy_sheet_sync_batch(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_privacy_sheet_sync_batch(integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.claim_privacy_retention_batch(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_privacy_retention_batch(integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.count_overdue_member_retention()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_overdue_member_retention()
  TO service_role;

COMMIT;
