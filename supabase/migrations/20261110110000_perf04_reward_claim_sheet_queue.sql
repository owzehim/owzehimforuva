-- PERF-04 (CITS report v2.0/v3.0): a reward claim no longer waits for Google
-- Sheets. The reward is marked used first (unchanged); the Master and partner
-- Sheet rows are then written in the background. Any write that does not
-- succeed stays in this queue and is re-sent by the sheet retry job
-- (privacy-retention-sync, task "sheet_retry", every 15 minutes).
--
-- The queue holds no personal data: only the reward and check-in references,
-- the store and the claim time, which are re-read into the same payload the
-- Sheet already receives. Rows go away when the Sheet confirms, and with the
-- reward (account deletion, admin progress reset).
--
-- Deploy order: this migration → redeem-stamp-card-reward and
-- privacy-retention-sync → frontend. Apply to DEV first, then production.

BEGIN;

CREATE TABLE IF NOT EXISTS public.reward_claim_sheet_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reward_id uuid NOT NULL REFERENCES public.stamp_card_rewards(id) ON DELETE CASCADE,
  target text NOT NULL CHECK (target IN ('master', 'partner')),
  store_id text NOT NULL CHECK (char_length(store_id) BETWEEN 1 AND 200),
  redemption_id bigint NOT NULL,
  claimed_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reward_id, target)
);

CREATE INDEX IF NOT EXISTS reward_claim_sheet_queue_due_idx
  ON public.reward_claim_sheet_queue (next_attempt_at);

ALTER TABLE public.reward_claim_sheet_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reward_claim_sheet_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.reward_claim_sheet_queue TO service_role;

COMMIT;
