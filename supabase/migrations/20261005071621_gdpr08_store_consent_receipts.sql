-- GDPR-08: keep server-recorded, per-document acceptance evidence for new signups.
BEGIN;

CREATE TABLE IF NOT EXISTS public.legal_consent_receipts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_key text NOT NULL CHECK (document_key IN ('terms', 'privacy', 'community')),
  document_version text NOT NULL CHECK (length(document_version) BETWEEN 1 AND 80),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, document_key, document_version)
);

ALTER TABLE public.legal_consent_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.legal_consent_receipts
  FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.legal_consent_receipts TO service_role;

COMMIT;
