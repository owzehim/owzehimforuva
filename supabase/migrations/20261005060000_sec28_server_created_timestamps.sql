-- SEC-28: clients may not backdate or future-date comments/notes.

BEGIN;

CREATE OR REPLACE FUNCTION public.force_user_content_created_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := statement_timestamp();
  ELSE
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_force_server_created_at ON public.restaurant_comments;
CREATE TRIGGER a_force_server_created_at
BEFORE INSERT OR UPDATE ON public.restaurant_comments
FOR EACH ROW EXECUTE FUNCTION public.force_user_content_created_at();

DROP TRIGGER IF EXISTS a_force_server_created_at ON public.restaurant_notes;
CREATE TRIGGER a_force_server_created_at
BEFORE INSERT OR UPDATE ON public.restaurant_notes
FOR EACH ROW EXECUTE FUNCTION public.force_user_content_created_at();

-- SEC-34: the comment filter previously escaped the backslash itself, so
-- whitespace inside disallowed words was not removed before matching.
CREATE OR REPLACE FUNCTION public.prepare_restaurant_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  current_username text;
  current_member_is_active boolean;
  current_membership_valid_until date;
  normalized_body text;
  compact_body text;
BEGIN
  SELECT btrim(m.username), m.is_member, m.membership_valid_until
  INTO current_username, current_member_is_active, current_membership_valid_until
  FROM public.members AS m
  WHERE m.user_id = auth.uid();

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
      SELECT 1 FROM public.restaurant_comments AS c
      WHERE c.restaurant_id = NEW.restaurant_id
        AND c.user_id = auth.uid()
        AND (c.created_at AT TIME ZONE 'Europe/Amsterdam')::date = (now() AT TIME ZONE 'Europe/Amsterdam')::date
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
