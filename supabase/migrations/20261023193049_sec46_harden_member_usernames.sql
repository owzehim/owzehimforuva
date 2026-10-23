-- SEC-46: reject lookalike and reserved usernames at the database boundary.
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
    SELECT name, regexp_replace(name, '_+', '', 'g') AS compact_name
    FROM normalized
  )
  SELECT char_length(name) BETWEEN 2 AND 20
    AND name ~ '^[a-z0-9_가-힣]+$'
    AND compact_name !~ '(admin|administrator|moderator|support|uvain|운영|관리|익명)'
    AND compact_name <> 'mod'
  FROM compact;
$$;

-- Recreate the check so all stored values are verified against the new rule.
ALTER TABLE public.members
  DROP CONSTRAINT IF EXISTS members_username_length_check;
ALTER TABLE public.members
  ADD CONSTRAINT members_username_length_check
  CHECK (username IS NULL OR public.is_valid_member_username(username));

DO $$
BEGIN
  IF public.is_valid_member_username('admin1')
     OR public.is_valid_member_username('uvain_staff')
     OR public.is_valid_member_username('운영진팀')
     OR public.is_valid_member_username('관리자1')
     OR public.is_valid_member_username('익명이')
     OR public.is_valid_member_username('аdmin')
     OR public.is_valid_member_username('user-name')
     OR NOT public.is_valid_member_username('우재임')
     OR NOT public.is_valid_member_username('woojay_1') THEN
    RAISE EXCEPTION 'SEC-46: username validation regression check failed';
  END IF;
END;
$$;

COMMIT;
