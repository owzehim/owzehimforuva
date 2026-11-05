-- SEC-55 / SEC-56 (CITS report v3.0): note author fields and author-avatar access.
--
-- Problem (verified in production 2026-11-05):
--   * prepare_restaurant_note only fired on UPDATE OF body, is_anonymous, and it
--     derived the author display from the *requester*, while members held a
--     table-level UPDATE grant. A member could PATCH username / restaurant_id /
--     profile_image_url / source_* on their own note without the trigger running.
--   * The Storage policy for note author avatars trusted the note's
--     profile_image_url, so a forged path exposed another member's private photo.
--
-- Fix:
--   1. Members may UPDATE only body and is_anonymous (hidden_at stays grantable;
--      guard_restaurant_note_hidden_at + the admin policy restrict it to admins).
--   2. prepare_restaurant_note runs on every INSERT/UPDATE, keeps identity and
--      source fields immutable, checks requester/membership/profanity only when
--      the content changes, and always rebuilds author display fields from the
--      note *owner's* member row. Admin hides therefore keep the author's name.
--   3. Member profile changes refresh their notes server-side (replaces the
--      client-side sync in SettingsPage.jsx, which wrote author fields directly).
--   4. The avatar policy compares the object name with a path built from a
--      visible, non-anonymous note's user_id, never with a stored path.
--
-- Deploy order: frontend (stops sending author fields on note UPDATE) first,
-- then this migration. Test on the DEV project before production.

BEGIN;

-- 1. Column-level UPDATE privileges -------------------------------------------

REVOKE UPDATE ON TABLE public.restaurant_notes FROM authenticated;
REVOKE UPDATE (
  id, restaurant_id, user_id, username, is_anonymous, body, created_at,
  updated_at, source_review_id, source_redemption_id, source_store_id,
  source_rating, source_tags, profile_image_url, avatar_color_seed, hidden_at
) ON public.restaurant_notes FROM authenticated;
GRANT UPDATE (body, is_anonymous, hidden_at)
  ON public.restaurant_notes TO authenticated;

-- 2. Server-owned author fields on every write ---------------------------------

CREATE OR REPLACE FUNCTION public.prepare_restaurant_note()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  requester_id uuid := (SELECT auth.uid());
  content_changed boolean;
  needs_author_checks boolean;
  owner_username text;
  owner_profile_image_url text;
  owner_is_active boolean;
  owner_membership_valid_until date;
  normalized_body text;
  compact_body text;
  trusted_review record;
  note_day date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM requester_id THEN
      RAISE EXCEPTION 'cannot leave a note for another user';
    END IF;
    content_changed := true;
    needs_author_checks := true;
  ELSE
    -- Identity and provenance never change after creation.
    NEW.id := OLD.id;
    NEW.user_id := OLD.user_id;
    NEW.restaurant_id := OLD.restaurant_id;
    NEW.source_review_id := OLD.source_review_id;
    NEW.source_redemption_id := OLD.source_redemption_id;
    NEW.source_store_id := OLD.source_store_id;
    NEW.source_rating := OLD.source_rating;
    NEW.source_tags := OLD.source_tags;

    content_changed := NEW.body IS DISTINCT FROM OLD.body
      OR NEW.is_anonymous IS DISTINCT FROM OLD.is_anonymous;
    -- Making a note anonymous only hides the author, so it needs no author
    -- checks (used when a member clears their username). Any other content
    -- change must come from the active owner.
    needs_author_checks := NEW.body IS DISTINCT FROM OLD.body
      OR (NEW.is_anonymous IS DISTINCT FROM OLD.is_anonymous
          AND NEW.is_anonymous IS NOT TRUE);

    IF needs_author_checks AND OLD.user_id IS DISTINCT FROM requester_id THEN
      RAISE EXCEPTION 'cannot edit another user note';
    END IF;
  END IF;

  -- Author display always comes from the note owner, not the requester.
  SELECT btrim(m.username), m.profile_image_url,
         m.is_member, m.membership_valid_until
  INTO owner_username, owner_profile_image_url,
       owner_is_active, owner_membership_valid_until
  FROM public.members AS m
  WHERE m.user_id = NEW.user_id;

  IF needs_author_checks THEN
    IF owner_is_active IS NOT TRUE
       OR owner_membership_valid_until IS NULL
       OR owner_membership_valid_until < (now() AT TIME ZONE 'Europe/Amsterdam')::date THEN
      RAISE EXCEPTION 'only active members can leave notes';
    END IF;

    normalized_body := btrim(NEW.body);
    compact_body := lower(regexp_replace(normalized_body, '\s+', '', 'g'));
    IF compact_body ~ '(fuck|shit|bitch|asshole|cunt|klootzak|tering|hoer|개새끼|병신|씨발|시발|좆)' THEN
      RAISE EXCEPTION 'inappropriate language is not allowed';
    END IF;
    NEW.body := normalized_body;
  END IF;

  IF content_changed THEN
    NEW.updated_at := now();
  ELSE
    -- Moderation or profile refresh: content and its timestamp stay as they were.
    NEW.body := OLD.body;
    NEW.is_anonymous := OLD.is_anonymous;
    NEW.updated_at := OLD.updated_at;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.source_review_id IS NOT NULL THEN
      SELECT r.id, r.redemption_id, r.store_id, r.rating, r.tags
      INTO trusted_review
      FROM public.reviews AS r
      JOIN public.redemptions AS d ON d.id = r.redemption_id
      JOIN public.restaurants AS restaurant
        ON restaurant.id = NEW.restaurant_id
       AND restaurant.partnership_id = r.store_id
      WHERE r.id = NEW.source_review_id
        AND r.user_id = requester_id
        AND d.user_id = requester_id
        AND d.store_id = r.store_id
        AND d.redeemed_at IS NOT NULL
        AND d.redeemed_at <= now();

      IF NOT FOUND THEN
        RAISE EXCEPTION 'source review is not owned by this member or restaurant';
      END IF;

      IF owner_username IS NULL OR owner_username = '' THEN
        NEW.is_anonymous := true;
      END IF;
      NEW.source_redemption_id := trusted_review.redemption_id;
      NEW.source_store_id := trusted_review.store_id;
      NEW.source_rating := trusted_review.rating;
      NEW.source_tags := trusted_review.tags;
    ELSE
      IF owner_username IS NULL OR owner_username = '' THEN
        RAISE EXCEPTION 'username is required before leaving a note';
      END IF;

      NEW.source_review_id := NULL;
      NEW.source_redemption_id := NULL;
      NEW.source_store_id := NULL;
      NEW.source_rating := NULL;
      NEW.source_tags := NULL;
    END IF;

    note_day := (NEW.created_at AT TIME ZONE 'Europe/Amsterdam')::date;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        NEW.user_id::text || ':' || NEW.restaurant_id::text || ':' || note_day::text,
        0
      )
    );

    IF EXISTS (
      SELECT 1
      FROM public.restaurant_notes AS n
      WHERE n.restaurant_id = NEW.restaurant_id
        AND n.user_id = requester_id
        AND (n.created_at AT TIME ZONE 'Europe/Amsterdam')::date = note_day
    ) THEN
      RAISE EXCEPTION 'one note per restaurant per day';
    END IF;
  ELSIF needs_author_checks AND (owner_username IS NULL OR owner_username = '') THEN
    IF OLD.source_review_id IS NOT NULL OR NEW.is_anonymous IS TRUE THEN
      NEW.is_anonymous := true;
    ELSE
      RAISE EXCEPTION 'username is required before leaving a note';
    END IF;
  END IF;

  IF NEW.is_anonymous IS TRUE OR owner_username IS NULL OR owner_username = '' THEN
    NEW.username := '익명';
    NEW.profile_image_url := NULL;
    NEW.avatar_color_seed := NULL;
  ELSE
    NEW.username := owner_username;
    -- Build the path from the owner's id; never trust a stored path.
    NEW.profile_image_url := CASE
      WHEN owner_profile_image_url IS NOT NULL
        THEN 'avatars/' || NEW.user_id::text || '.jpg'
    END;
    NEW.avatar_color_seed := owner_username;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prepare_restaurant_note()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS prepare_restaurant_note ON public.restaurant_notes;
CREATE TRIGGER prepare_restaurant_note
  BEFORE INSERT OR UPDATE ON public.restaurant_notes
  FOR EACH ROW EXECUTE FUNCTION public.prepare_restaurant_note();

-- 3. Refresh a member's notes when their public profile changes ----------------

CREATE OR REPLACE FUNCTION public.refresh_member_note_authors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Touching the rows makes prepare_restaurant_note rebuild the author fields
  -- from this member row. Clearing the username also makes the member's
  -- existing notes permanently anonymous (as the old client sync did), so
  -- choosing a new username later does not reveal them.
  UPDATE public.restaurant_notes AS n
  SET is_anonymous = CASE
        WHEN NULLIF(btrim(NEW.username), '') IS NULL THEN true
        ELSE n.is_anonymous
      END
  WHERE n.user_id = NEW.user_id;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_member_note_authors()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS refresh_member_note_authors ON public.members;
CREATE TRIGGER refresh_member_note_authors
  AFTER UPDATE OF username, profile_image_url ON public.members
  FOR EACH ROW
  WHEN (OLD.username IS DISTINCT FROM NEW.username
        OR OLD.profile_image_url IS DISTINCT FROM NEW.profile_image_url)
  EXECUTE FUNCTION public.refresh_member_note_authors();

-- 4. Author avatars: path derived from the note owner, not from stored values ---

CREATE OR REPLACE FUNCTION public.can_read_note_author_avatar(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT COALESCE((SELECT auth.jwt() ->> 'app_access') = 'true', false)
    AND (SELECT public.is_current_device_session())
    AND EXISTS (
      SELECT 1
      FROM public.restaurant_notes AS n
      JOIN public.members AS m ON m.user_id = n.user_id
      WHERE n.hidden_at IS NULL
        AND n.is_anonymous IS NOT TRUE
        AND m.profile_image_url IS NOT NULL
        AND object_name = 'avatars/' || n.user_id::text || '.jpg'
    );
$function$;

REVOKE ALL ON FUNCTION public.can_read_note_author_avatar(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_note_author_avatar(text)
  TO authenticated;

DROP POLICY IF EXISTS "SEC52 allow visible note author avatars" ON storage.objects;
DROP POLICY IF EXISTS "SEC56 read visible note author avatars" ON storage.objects;
CREATE POLICY "SEC56 read visible note author avatars"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND public.can_read_note_author_avatar(name)
  );

-- 5. Re-derive author fields on existing notes (repairs any forged values) -----

UPDATE public.restaurant_notes AS n
SET hidden_at = n.hidden_at;

COMMIT;
