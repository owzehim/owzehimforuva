-- FUNC-14 (reviews): a review's Google Sheets rows (Master and partner) get the
-- same durable retry as check-ins (20261110120000) and reward claims. Before,
-- a failed review write was lost: the rating never reached the Sheet.
--
-- No personal data is stored: the check-in number and the store. The review
-- (rating, tags, place criteria) is read from the database when it is sent;
-- the row is dropped if the review is gone. Rows go away when the Sheet
-- confirms, or with the check-in. The comment is never sent (GDPR-14).
--
-- Deploy order: this migration → sync-to-sheets and privacy-retention-sync.
-- Apply to DEV first, then production, as this single file with its ledger row.

CREATE TABLE IF NOT EXISTS public.review_sheet_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  redemption_id bigint NOT NULL REFERENCES public.redemptions(id) ON DELETE CASCADE,
  target text NOT NULL CHECK (target IN ('master', 'partner')),
  store_id text NOT NULL CHECK (char_length(store_id) BETWEEN 1 AND 200),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (redemption_id, target)
);

CREATE INDEX IF NOT EXISTS review_sheet_queue_due_idx
  ON public.review_sheet_queue (next_attempt_at);

ALTER TABLE public.review_sheet_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.review_sheet_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.review_sheet_queue TO service_role;
