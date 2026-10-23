-- SEC-41: review-linked notes must share the restaurant/day limit, and adding
-- a note must never delete another member's older note.

BEGIN;

DROP TRIGGER IF EXISTS keep_ten_restaurant_notes ON public.restaurant_notes;

CREATE OR REPLACE FUNCTION public.prepare_restaurant_note()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_username text;
  current_profile_image_url text;
  current_member_is_active boolean;
  current_membership_valid_until date;
  normalized_body text;
  compact_body text;
  trusted_review record;
  note_day date;
BEGIN
  SELECT btrim(m.username), m.profile_image_url,
         m.is_member, m.membership_valid_until
  INTO current_username, current_profile_image_url,
       current_member_is_active, current_membership_valid_until
  FROM public.members AS m
  WHERE m.user_id = (SELECT auth.uid());

  IF current_member_is_active IS NOT TRUE
     OR current_membership_valid_until IS NULL
     OR current_membership_valid_until < (now() AT TIME ZONE 'Europe/Amsterdam')::date THEN
    RAISE EXCEPTION 'only active members can leave notes';
  END IF;

  normalized_body := btrim(NEW.body);
  compact_body := lower(regexp_replace(normalized_body, '\s+', '', 'g'));
  IF compact_body ~ '(fuck|shit|bitch|asshole|cunt|klootzak|tering|hoer|개새끼|병신|씨발|시발|좆)' THEN
    RAISE EXCEPTION 'inappropriate language is not allowed';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id <> (SELECT auth.uid()) THEN
      RAISE EXCEPTION 'cannot leave a note for another user';
    END IF;

    IF NEW.source_review_id IS NOT NULL THEN
      SELECT r.id, r.redemption_id, r.store_id, r.rating, r.tags
      INTO trusted_review
      FROM public.reviews AS r
      JOIN public.redemptions AS d ON d.id = r.redemption_id
      JOIN public.restaurants AS restaurant
        ON restaurant.id = NEW.restaurant_id
       AND restaurant.partnership_id = r.store_id
      WHERE r.id = NEW.source_review_id
        AND r.user_id = (SELECT auth.uid())
        AND d.user_id = (SELECT auth.uid())
        AND d.store_id = r.store_id
        AND d.redeemed_at IS NOT NULL
        AND d.redeemed_at <= now();

      IF NOT FOUND THEN
        RAISE EXCEPTION 'source review is not owned by this member or restaurant';
      END IF;

      IF current_username IS NULL OR current_username = '' THEN
        NEW.is_anonymous := true;
      END IF;
      NEW.source_redemption_id := trusted_review.redemption_id;
      NEW.source_store_id := trusted_review.store_id;
      NEW.source_rating := trusted_review.rating;
      NEW.source_tags := trusted_review.tags;
    ELSE
      IF current_username IS NULL OR current_username = '' THEN
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
        AND n.user_id = (SELECT auth.uid())
        AND (n.created_at AT TIME ZONE 'Europe/Amsterdam')::date = note_day
    ) THEN
      RAISE EXCEPTION 'one note per restaurant per day';
    END IF;
  ELSE
    IF OLD.user_id <> (SELECT auth.uid()) THEN
      RAISE EXCEPTION 'cannot edit another user note';
    END IF;
    NEW.user_id := OLD.user_id;
    NEW.restaurant_id := OLD.restaurant_id;
    NEW.source_review_id := OLD.source_review_id;
    NEW.source_redemption_id := OLD.source_redemption_id;
    NEW.source_store_id := OLD.source_store_id;
    NEW.source_rating := OLD.source_rating;
    NEW.source_tags := OLD.source_tags;

    IF current_username IS NULL OR current_username = '' THEN
      IF OLD.source_review_id IS NOT NULL OR NEW.is_anonymous IS TRUE THEN
        NEW.is_anonymous := true;
      ELSE
        RAISE EXCEPTION 'username is required before leaving a note';
      END IF;
    END IF;
  END IF;

  IF NEW.is_anonymous IS TRUE OR current_username IS NULL OR current_username = '' THEN
    NEW.username := '익명';
    NEW.profile_image_url := NULL;
    NEW.avatar_color_seed := NULL;
  ELSE
    NEW.username := current_username;
    NEW.profile_image_url := current_profile_image_url;
    NEW.avatar_color_seed := current_username;
  END IF;

  NEW.body := normalized_body;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMIT;
