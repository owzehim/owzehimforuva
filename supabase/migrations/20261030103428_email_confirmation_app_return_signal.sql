-- Display-only, cross-browser handoff. These opaque signals never grant login
-- or membership; Auth and complete-login still independently enforce both.
BEGIN;
CREATE TABLE public.email_confirmation_return_signals (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('success', 'error', 'registration_error', 'email_change_error')),
  expires_at timestamptz NOT NULL
);
CREATE INDEX email_confirmation_return_signals_expiry_idx
  ON public.email_confirmation_return_signals (expires_at);
ALTER TABLE public.email_confirmation_return_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_confirmation_return_signals FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.email_confirmation_return_signals TO service_role;
COMMIT;
