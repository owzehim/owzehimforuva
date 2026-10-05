-- SEC-34: remove all whitespace before checking the comment profanity list.
-- This forward migration repairs the function already installed in main/dev;
-- the original migration is corrected separately for fresh database setup.

BEGIN;

CREATE OR REPLACE FUNCTION public.prepare_restaurant_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  current_username text;
  current_member_is_active boolean;
  current_membership_valid_until date;
  normalized_body text;
  compact_body text;
BEGIN
  SELECT btrim(member.username), member.is_member, member.membership_valid_until
  INTO current_username, current_member_is_active, current_membership_valid_until
  FROM public.members AS member
  WHERE member.user_id = auth.uid();

  IF current_username IS NULL OR current_username = '' THEN
    RAISE EXCEPTION 'username is required before commenting';
  END IF;

  IF current_member_is_active IS NOT TRUE
     OR current_membership_valid_until IS NULL
     OR current_membership_valid_until < (now() AT TIME ZONE 'Europe/Amsterdam')::date THEN
    RAISE EXCEPTION 'only active members can comment';
  END IF;

  normalized_body := btrim(NEW.body);
  compact_body := lower(regexp_replace(normalized_body, '[[:space:]]+', '', 'g'));
  IF compact_body ~ '(fuck|shit|bitch|asshole|cunt|klootzak|tering|hoer|개새끼|병신|씨발|시발|좆)' THEN
    RAISE EXCEPTION 'inappropriate language is not allowed';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id <> auth.uid() THEN
      RAISE EXCEPTION 'cannot comment for another user';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.restaurant_comments AS comment
      WHERE comment.restaurant_id = NEW.restaurant_id
        AND comment.user_id = auth.uid()
        AND (comment.created_at AT TIME ZONE 'Europe/Amsterdam')::date =
            (now() AT TIME ZONE 'Europe/Amsterdam')::date
    ) THEN
      RAISE EXCEPTION 'one comment per restaurant per day';
    END IF;
    NEW.username := current_username;
  ELSE
    IF OLD.user_id <> auth.uid() THEN
      RAISE EXCEPTION 'cannot edit another user comment';
    END IF;
    NEW.user_id := OLD.user_id;
    NEW.restaurant_id := OLD.restaurant_id;
    NEW.username := current_username;
  END IF;

  NEW.body := normalized_body;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMIT;
