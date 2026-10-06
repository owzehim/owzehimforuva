-- SEC-33: client-provided note metadata must be derived from trusted rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.prepare_restaurant_note()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  current_username text;
  current_profile_image_url text;
  current_avatar_color_seed text;
  current_member_is_active boolean;
  current_membership_valid_until date;
  normalized_body text;
  compact_body text;
  trusted_review record;
BEGIN
  SELECT btrim(m.username), m.profile_image_url,
         coalesce(m.first_name, '') || coalesce(m.last_name, ''),
         m.is_member, m.membership_valid_until
  INTO current_username, current_profile_image_url, current_avatar_color_seed,
       current_member_is_active, current_membership_valid_until
  FROM public.members AS m
  WHERE m.user_id = auth.uid();

  IF current_username IS NULL OR current_username = '' THEN
    RAISE EXCEPTION 'username is required before leaving a note';
  END IF;
  IF current_member_is_active IS NOT TRUE OR current_membership_valid_until IS NULL
     OR current_membership_valid_until < (now() AT TIME ZONE 'Europe/Amsterdam')::date THEN
    RAISE EXCEPTION 'only active members can leave notes';
  END IF;

  normalized_body := btrim(NEW.body);
  compact_body := lower(regexp_replace(normalized_body, '\s+', '', 'g'));
  IF compact_body ~ '(fuck|shit|bitch|asshole|cunt|klootzak|tering|hoer|개새끼|병신|씨발|시발|좆)' THEN
    RAISE EXCEPTION 'inappropriate language is not allowed';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id <> auth.uid() THEN
      RAISE EXCEPTION 'cannot leave a note for another user';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.restaurant_notes AS n
      WHERE n.restaurant_id = NEW.restaurant_id
        AND n.user_id = auth.uid()
        AND (n.created_at AT TIME ZONE 'Europe/Amsterdam')::date = (now() AT TIME ZONE 'Europe/Amsterdam')::date
    ) THEN
      RAISE EXCEPTION 'one note per restaurant per day';
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
        AND r.user_id = auth.uid()
        AND d.user_id = auth.uid()
        AND d.store_id = r.store_id
        AND d.redeemed_at IS NOT NULL
        AND d.redeemed_at <= now();

      IF NOT FOUND THEN
        RAISE EXCEPTION 'source review is not owned by this member or restaurant';
      END IF;

      NEW.source_redemption_id := trusted_review.redemption_id;
      NEW.source_store_id := trusted_review.store_id;
      NEW.source_rating := trusted_review.rating;
      NEW.source_tags := trusted_review.tags;
    ELSE
      NEW.source_review_id := NULL;
      NEW.source_redemption_id := NULL;
      NEW.source_store_id := NULL;
      NEW.source_rating := NULL;
      NEW.source_tags := NULL;
    END IF;
  ELSE
    IF OLD.user_id <> auth.uid() THEN
      RAISE EXCEPTION 'cannot edit another user note';
    END IF;
    NEW.user_id := OLD.user_id;
    NEW.restaurant_id := OLD.restaurant_id;
    NEW.source_review_id := OLD.source_review_id;
    NEW.source_redemption_id := OLD.source_redemption_id;
    NEW.source_store_id := OLD.source_store_id;
    NEW.source_rating := OLD.source_rating;
    NEW.source_tags := OLD.source_tags;
  END IF;

  NEW.username := current_username;
  NEW.profile_image_url := current_profile_image_url;
  NEW.avatar_color_seed := current_avatar_color_seed;
  NEW.body := normalized_body;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMIT;
