-- PERF-04 (follow-up): check-in Google Sheets rows get the same durable retry
-- as reward claims (20261110110000). The check-in itself is recorded first
-- (unchanged); its Master and partner Sheet rows are queued here, sent in the
-- background, and re-sent by the sheet retry job until the Sheet confirms.
--
-- No personal data is stored: the check-in number, the store and the stamp
-- columns from the moment of the scan. The Master row is rebuilt from the
-- database when it is sent and is dropped if the member's account is gone.
-- Rows go away when the Sheet confirms, or with the check-in.
--
-- Deploy order: this migration → log-redemption and privacy-retention-sync.
-- Apply to DEV first, then production, as this single file with its ledger row.

BEGIN;

CREATE TABLE IF NOT EXISTS public.checkin_sheet_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  redemption_id bigint NOT NULL REFERENCES public.redemptions(id) ON DELETE CASCADE,
  target text NOT NULL CHECK (target IN ('master', 'partner')),
  store_id text NOT NULL CHECK (char_length(store_id) BETWEEN 1 AND 200),
  stamp_status text NOT NULL DEFAULT '' CHECK (char_length(stamp_status) <= 40),
  stamp_progress text NOT NULL DEFAULT '' CHECK (char_length(stamp_progress) <= 20),
  stamp_card_claimed_after_scan boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (redemption_id, target)
);

CREATE INDEX IF NOT EXISTS checkin_sheet_queue_due_idx
  ON public.checkin_sheet_queue (next_attempt_at);

ALTER TABLE public.checkin_sheet_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkin_sheet_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.checkin_sheet_queue TO service_role;

COMMIT;
