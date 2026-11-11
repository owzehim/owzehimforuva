-- CITS report v4: SEC-63 (single test account), SEC-36 (WebP-only wallpapers), SEC-62 (notice log).

-- SEC-63: at most one account may be exempt as the test
-- account. Edge Functions already check that single account three ways;
-- this makes the database enforce the same limit.
CREATE UNIQUE INDEX IF NOT EXISTS login_otp_exempt_users_single_test_account
  ON public.login_otp_exempt_users (reason)
  WHERE reason = 'test';

-- SEC-36 (CITS report v4): the app always uploads stamp-card wallpapers as
-- re-encoded WebP (no EXIF/location data). Refuse other formats, so a direct
-- API upload cannot store an original photo with its location data.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/webp']
WHERE id = 'stamp-card-wallpapers';

-- SEC-62 (CITS report v4): remember which report notices were sent, so the
-- same notice (same report, recipient and text) is never e-mailed twice, even
-- after Resend has forgotten the idempotency key. Server only (no policies).
CREATE TABLE IF NOT EXISTS public.content_report_notice_log (
  report_id uuid NOT NULL REFERENCES public.restaurant_note_reports(id) ON DELETE CASCADE,
  recipient_kind text NOT NULL CHECK (recipient_kind IN ('reporter', 'author')),
  content_digest text NOT NULL CHECK (char_length(content_digest) BETWEEN 16 AND 64),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, recipient_kind, content_digest)
);
ALTER TABLE public.content_report_notice_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_report_notice_log FROM anon, authenticated;
