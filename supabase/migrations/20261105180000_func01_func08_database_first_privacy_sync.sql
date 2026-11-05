-- FUNC-01 / FUNC-08 (CITS report v3.0): database-first privacy cleanup.
--
-- The Master Google Sheet link (partnership_integrations) is unchanged and is
-- still used for anonymization. What changes is the order: the database and
-- Auth side is finished first, and the Master Sheet anonymization stays in
-- privacy_sheet_sync_queue until the Sheet confirms it. A Sheet outage or a
-- missing/ambiguous Master URL therefore no longer blocks account deletion or
-- the daily retention cleanup; the Sheet step is retried every day.
--
-- complete_privacy_sheet_sync is left unchanged so the previously deployed
-- Edge Function keeps working until the new one is deployed.
-- Deploy order: this migration first, then delete-my-account and
-- privacy-retention-sync.

BEGIN;

CREATE OR REPLACE FUNCTION public.finish_privacy_retention_database(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  should_delete_auth boolean;
  should_sync_sheet boolean;
BEGIN
  SELECT queue.delete_auth_user, queue.sync_master_sheet
  INTO should_delete_auth, should_sync_sheet
  FROM public.privacy_sheet_sync_queue AS queue
  WHERE queue.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF should_delete_auth THEN
    -- Same database cleanup as complete_privacy_sheet_sync(…, true).
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

  IF should_sync_sheet THEN
    -- Database side is done; keep only the Master Sheet step queued.
    UPDATE public.privacy_sheet_sync_queue
    SET delete_auth_user = false
    WHERE user_id = p_user_id;
  ELSE
    DELETE FROM public.privacy_sheet_sync_queue WHERE user_id = p_user_id;
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.finish_privacy_retention_database(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_privacy_retention_database(uuid)
  TO service_role;

COMMIT;
