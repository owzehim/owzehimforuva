-- Follow-up to SEC-55 (2026-11-05 audit of member write access).
--
-- Members could INSERT every column of restaurant_notes. The author trigger
-- already overwrites author fields, created_at and the source_* values, but
-- hidden_at is only guarded on UPDATE, so a member could create a note that
-- is already hidden (an admin-only state). id, created_at, updated_at,
-- profile_image_url and avatar_color_seed do not need to be member-writable
-- either.
--
-- Members may now insert only the columns the app sends (GoodToKnowNotesPanel
-- and reviewApi on main and dev). Everything else comes from defaults or the
-- prepare_restaurant_note trigger. No database function or Edge Function
-- inserts notes as a member.

BEGIN;

REVOKE INSERT ON TABLE public.restaurant_notes FROM authenticated;
REVOKE INSERT (
  id, restaurant_id, user_id, username, is_anonymous, body, created_at,
  updated_at, source_review_id, source_redemption_id, source_store_id,
  source_rating, source_tags, profile_image_url, avatar_color_seed, hidden_at
) ON public.restaurant_notes FROM authenticated;

GRANT INSERT (
  restaurant_id, user_id, username, body, is_anonymous,
  source_review_id, source_redemption_id, source_store_id,
  source_rating, source_tags
) ON public.restaurant_notes TO authenticated;

COMMIT;
