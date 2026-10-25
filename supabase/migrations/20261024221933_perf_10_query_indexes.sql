-- PERF-10: indexes for high-frequency lookups and foreign-key filters.
-- These indexes do not change row access or application behavior.

CREATE INDEX IF NOT EXISTS redemptions_user_store_redeemed_idx
  ON public.redemptions (user_id, store_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS redemptions_user_redeemed_idx
  ON public.redemptions (user_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS review_prompts_pending_user_prompt_idx
  ON public.review_prompts (user_id, prompt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS review_prompts_user_id_idx
  ON public.review_prompts (user_id);

CREATE INDEX IF NOT EXISTS review_prompts_store_id_idx
  ON public.review_prompts (store_id);

CREATE INDEX IF NOT EXISTS reviews_user_id_idx
  ON public.reviews (user_id);

CREATE INDEX IF NOT EXISTS stamp_card_visits_restaurant_user_visited_idx
  ON public.stamp_card_visits (restaurant_id, user_id, visited_at);

CREATE INDEX IF NOT EXISTS restaurant_comments_user_id_idx
  ON public.restaurant_comments (user_id);

CREATE INDEX IF NOT EXISTS restaurant_notes_user_id_idx
  ON public.restaurant_notes (user_id);

CREATE INDEX IF NOT EXISTS restaurant_comment_reports_reporter_id_idx
  ON public.restaurant_comment_reports (reporter_id);

CREATE INDEX IF NOT EXISTS restaurant_note_reports_content_author_id_idx
  ON public.restaurant_note_reports (content_author_id);

CREATE INDEX IF NOT EXISTS restaurant_note_reports_reporter_id_idx
  ON public.restaurant_note_reports (reporter_id);

CREATE INDEX IF NOT EXISTS restaurants_partnership_id_idx
  ON public.restaurants (partnership_id);

CREATE INDEX IF NOT EXISTS stamp_card_rewards_restaurant_id_idx
  ON public.stamp_card_rewards (restaurant_id);
