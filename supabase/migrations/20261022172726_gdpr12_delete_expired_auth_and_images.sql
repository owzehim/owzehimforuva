-- GDPR-12: after the 12-month retention period, remove the login identity and
-- user-linked content only after the Master Sheet has confirmed anonymization.

BEGIN;

ALTER TABLE public.privacy_sheet_sync_queue
  ADD COLUMN IF NOT EXISTS sync_master_sheet boolean NOT NULL DEFAULT true;

-- Retain only anonymous review metrics after a member is removed. New app
-- writes remain protected by the existing authenticated policies.
ALTER TABLE public.reviews ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.redemptions ALTER COLUMN user_id DROP NOT NULL;

-- Preserve the old queue semantics during rollout: earlier Auth-deletion rows
-- were signup records with no Master Sheet entry; earlier other rows were
-- expired members whose sheet still needed anonymization.
UPDATE public.privacy_sheet_sync_queue
SET sync_master_sheet = NOT delete_auth_user;
UPDATE public.privacy_sheet_sync_queue
SET delete_auth_user = true
WHERE delete_auth_user IS FALSE;

CREATE OR REPLACE FUNCTION public.anonymize_expired_members_for_sheets()
RETURNS TABLE(anonymized_user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS expired_members_for_privacy_job (
    user_id uuid PRIMARY KEY
  ) ON COMMIT DROP;

  TRUNCATE TABLE pg_temp.expired_members_for_privacy_job;

  INSERT INTO pg_temp.expired_members_for_privacy_job (user_id)
  SELECT member.user_id
  FROM public.members AS member
  WHERE member.membership_ended_at IS NOT NULL
    AND member.membership_ended_at < current_date - interval '12 months'
    AND member.identity_anonymized_at IS NULL
    AND coalesce(member.is_test_account, false) IS FALSE
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = member.user_id
    );

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
  WHERE member.user_id IN (
    SELECT expired.user_id FROM pg_temp.expired_members_for_privacy_job AS expired
  );

  INSERT INTO public.privacy_action_log (action, record_count, details)
  SELECT
    'anonymize_expired_members',
    count(*),
    jsonb_build_object(
      'retention_rule', 'membership_ended_at + 12 months',
      'sheet_sync_required', true,
      'auth_account_deletion_queued', true
    )
  FROM pg_temp.expired_members_for_privacy_job;

  RETURN QUERY
  SELECT expired.user_id FROM pg_temp.expired_members_for_privacy_job AS expired;
END;
$function$;

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
  UPDATE public.members AS member
  SET membership_ended_at = membership_valid_until
  WHERE member.membership_ended_at IS NULL
    AND member.membership_valid_until IS NOT NULL
    AND member.membership_valid_until < current_date - interval '12 months'
    AND member.identity_anonymized_at IS NULL
    AND coalesce(member.is_test_account, false) IS FALSE
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = member.user_id
    );

  CREATE TEMP TABLE IF NOT EXISTS gdpr12_expired_member_ids (
    user_id uuid PRIMARY KEY
  ) ON COMMIT DROP;
  TRUNCATE TABLE pg_temp.gdpr12_expired_member_ids;

  INSERT INTO pg_temp.gdpr12_expired_member_ids (user_id)
  SELECT result.anonymized_user_id
  FROM public.anonymize_expired_members_for_sheets() AS result
  WHERE result.anonymized_user_id IS NOT NULL
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.members AS member
  SET username = NULL,
      pending_student_number = NULL,
      is_member = false
  WHERE member.user_id IN (
    SELECT expired.user_id FROM pg_temp.gdpr12_expired_member_ids AS expired
  );

  INSERT INTO public.privacy_sheet_sync_queue (
    user_id, delete_auth_user, sync_master_sheet
  )
  SELECT expired.user_id, true, true
  FROM pg_temp.gdpr12_expired_member_ids AS expired
  ON CONFLICT (user_id) DO UPDATE
  SET delete_auth_user = true,
      sync_master_sheet = true,
      lease_until = NULL;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  queued_count := queued_count + affected_count;

  CREATE TEMP TABLE IF NOT EXISTS gdpr12_inactive_account_ids (
    user_id uuid PRIMARY KEY
  ) ON COMMIT DROP;
  TRUNCATE TABLE pg_temp.gdpr12_inactive_account_ids;

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
      AND coalesce(member.is_test_account, false) IS FALSE
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_roles AS admin_role
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
  INSERT INTO pg_temp.gdpr12_inactive_account_ids (user_id)
  SELECT scrubbed_accounts.user_id
  FROM scrubbed_accounts
  WHERE scrubbed_accounts.user_id IS NOT NULL;

  SELECT count(*)::integer INTO inactive_count
  FROM pg_temp.gdpr12_inactive_account_ids;

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

  INSERT INTO public.privacy_sheet_sync_queue (
    user_id, delete_auth_user, sync_master_sheet
  )
  SELECT DISTINCT inactive.user_id, true, false
  FROM pg_temp.gdpr12_inactive_account_ids AS inactive
  ON CONFLICT (user_id) DO UPDATE
  SET delete_auth_user = true,
      sync_master_sheet = false,
      lease_until = NULL;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  queued_count := queued_count + affected_count;

  RETURN queued_count;
END;
$function$;

DROP FUNCTION public.claim_privacy_retention_batch(integer);
CREATE FUNCTION public.claim_privacy_retention_batch(p_batch_size integer DEFAULT 50)
RETURNS TABLE (
  user_id uuid,
  delete_auth_user boolean,
  sync_master_sheet boolean
)
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
  RETURNING queue.user_id, queue.delete_auth_user, queue.sync_master_sheet;
$function$;

CREATE OR REPLACE FUNCTION public.complete_privacy_sheet_sync(
  p_user_id uuid,
  p_success boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  should_delete_auth boolean;
  affected_count integer;
BEGIN
  SELECT queue.delete_auth_user
  INTO should_delete_auth
  FROM public.privacy_sheet_sync_queue AS queue
  WHERE queue.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT coalesce(p_success, false) THEN
    UPDATE public.privacy_sheet_sync_queue
    SET lease_until = NULL
    WHERE user_id = p_user_id;
    RETURN true;
  END IF;

  IF should_delete_auth THEN
    DELETE FROM public.restaurant_comments WHERE user_id = p_user_id;
    DELETE FROM public.restaurant_notes WHERE user_id = p_user_id;
    UPDATE public.reviews
    SET user_id = NULL,
        comment = NULL
    WHERE user_id = p_user_id;
    UPDATE public.redemptions
    SET user_id = NULL
    WHERE user_id = p_user_id;
    DELETE FROM public.review_prompts WHERE user_id = p_user_id;
    DELETE FROM public.stamp_card_rewards WHERE user_id = p_user_id;
    DELETE FROM public.stamp_card_visits WHERE user_id = p_user_id;
    DELETE FROM public.member_analytics_profiles WHERE user_id = p_user_id;
    DELETE FROM public.legal_consent_receipts WHERE user_id = p_user_id;
    DELETE FROM public.login_otp_verified_sessions WHERE user_id = p_user_id;
    DELETE FROM public.login_otp_exempt_users WHERE user_id = p_user_id;
    DELETE FROM public.pending_email_changes
    WHERE old_user_id = p_user_id OR new_user_id = p_user_id;

    DELETE FROM public.members WHERE user_id = p_user_id;
  END IF;

  DELETE FROM public.privacy_sheet_sync_queue WHERE user_id = p_user_id;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count = 1;
END;
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
    AND coalesce(member.is_test_account, false) IS FALSE
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = member.user_id
    )
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
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.anonymize_expired_members_for_sheets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_expired_members_for_sheets() TO service_role;
REVOKE ALL ON FUNCTION public.queue_expired_member_anonymizations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_expired_member_anonymizations() TO service_role;
REVOKE ALL ON FUNCTION public.claim_privacy_retention_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_privacy_retention_batch(integer) TO service_role;
REVOKE ALL ON FUNCTION public.complete_privacy_sheet_sync(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_privacy_sheet_sync(uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.count_overdue_member_retention() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_overdue_member_retention() TO service_role;

COMMIT;
