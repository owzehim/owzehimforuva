-- SEC-35: enforce canonical, non-impersonating usernames in the database.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_valid_member_username(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path TO 'pg_catalog'
AS $$
  WITH normalized AS (
    SELECT lower(normalize(btrim(value), NFKC)) AS name
  ), compact AS (
    SELECT name, regexp_replace(name, '[_-]+', '', 'g') AS compact_name
    FROM normalized
  )
  SELECT char_length(name) BETWEEN 2 AND 20
    AND name ~ '^[[:alnum:]_-]+$'
    AND compact_name NOT IN (
      'admin', 'administrator', 'moderator', 'mod', 'support',
      'uvain', 'uva-in', '운영진', '관리자', '운영자'
    )
  FROM compact;
$$;

ALTER TABLE public.members
  DROP CONSTRAINT IF EXISTS members_username_length_check;
ALTER TABLE public.members
  ADD CONSTRAINT members_username_length_check
  CHECK (username IS NULL OR public.is_valid_member_username(username));

CREATE UNIQUE INDEX IF NOT EXISTS members_username_canonical_unique
  ON public.members (
    regexp_replace(lower(normalize(btrim(username), NFKC)), '[_-]+', '', 'g')
  )
  WHERE username IS NOT NULL;

COMMIT;
