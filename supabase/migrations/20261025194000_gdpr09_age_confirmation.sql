-- GDPR-09: allow a server-recorded age attestation receipt alongside legal consent receipts.
BEGIN;

ALTER TABLE public.legal_consent_receipts
  DROP CONSTRAINT IF EXISTS legal_consent_receipts_document_key_check;

ALTER TABLE public.legal_consent_receipts
  ADD CONSTRAINT legal_consent_receipts_document_key_check
  CHECK (document_key IN ('terms', 'privacy', 'community', 'age_16_plus'));

COMMIT;
