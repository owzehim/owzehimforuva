-- Short-lived, opaque handoff from an email browser back to the app that
-- requested the password reset. Only the Edge Function's service role may
-- read or write these completion signals.

BEGIN;

CREATE TABLE public.password_reset_return_signals (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.password_reset_return_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.password_reset_return_signals FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.password_reset_return_signals TO service_role;

COMMIT;
