-- CITS report v4: SEC-66, SEC-67, FUNC-11.

-- SEC-66: the old comment feature is gone. Members can still read existing
-- rows (the admin reports tab and data export use them), but nobody outside
-- the server can add, change or delete comments any more.
REVOKE INSERT, UPDATE, DELETE ON public.restaurant_comments FROM anon, authenticated;

-- SEC-67: review prompts are for signed-in members only, a member can only
-- change their own prompt, and only its status (pending → submitted/dismissed).
DROP POLICY IF EXISTS "Users can read own prompts" ON public.review_prompts;
CREATE POLICY "Users can read own prompts" ON public.review_prompts
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own prompts" ON public.review_prompts;
CREATE POLICY "Users can update own prompts" ON public.review_prompts
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE UPDATE ON public.review_prompts FROM anon, authenticated;
GRANT UPDATE (status) ON public.review_prompts TO authenticated;

-- FUNC-11: the daily retention job must never be blocked by entries whose
-- Master Sheet step keeps failing.
--   * database_done marks entries where only the Sheet step is left;
--     entries that still need database/Auth cleanup are taken first.
--   * next_attempt_at spaces out retries (about 1, 2, 4, then 8 days).
--   * The job reports entries with 7+ attempts so a person looks at them.
ALTER TABLE public.privacy_sheet_sync_queue
  ADD COLUMN IF NOT EXISTS database_done boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS privacy_sheet_sync_queue_claim_idx
  ON public.privacy_sheet_sync_queue (database_done, next_attempt_at, queued_at);

CREATE OR REPLACE FUNCTION public.claim_privacy_retention_batch(p_batch_size integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, delete_auth_user boolean, sync_master_sheet boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  WITH candidates AS (
    SELECT queue.user_id
    FROM public.privacy_sheet_sync_queue AS queue
    WHERE (queue.lease_until IS NULL OR queue.lease_until < now())
      AND queue.next_attempt_at <= now()
    -- Database/Auth work first, so Sheet-only retries can never hold it up.
    ORDER BY queue.database_done, queue.next_attempt_at, queue.queued_at, queue.user_id
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
    SET delete_auth_user = false,
        database_done = true
    WHERE user_id = p_user_id;
  ELSE
    DELETE FROM public.privacy_sheet_sync_queue WHERE user_id = p_user_id;
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_privacy_sheet_sync(p_user_id uuid, p_success boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  should_delete_auth boolean;
  attempt_count integer;
  affected_count integer;
BEGIN
  SELECT queue.delete_auth_user, queue.attempts
  INTO should_delete_auth, attempt_count
  FROM public.privacy_sheet_sync_queue AS queue
  WHERE queue.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT coalesce(p_success, false) THEN
    -- FUNC-11: wait longer after each failure (about 1, 2, 4, then 8 days).
    UPDATE public.privacy_sheet_sync_queue
    SET lease_until = NULL,
        next_attempt_at = now()
          + interval '1 day' * least(power(2, greatest(coalesce(attempt_count, 1), 1) - 1), 8)
          - interval '4 hours'
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
