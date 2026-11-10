-- 낙서장 (Scrap paper): per-place review box type and the admin-made board.
--
-- review_box_type picks what the first slide of the SpotCard review box shows:
--   usullang      current 우슐랭 + 멤버 평가 (default, unchanged for every place)
--   scrap         낙서장 board filling the whole box
--   scrap_rating  낙서장 board on top, 멤버 평가 below
--
-- scrap_board holds the board as JSON ({ v, h, items[] }). It is public like
-- the rest of the restaurants row and only admins can write it (existing
-- restaurants policies). The app also validates and clamps it on read; these
-- checks keep the stored value small and well-formed.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS review_box_type text NOT NULL DEFAULT 'usullang',
  ADD COLUMN IF NOT EXISTS scrap_board jsonb NOT NULL DEFAULT '{"v":1,"h":380,"items":[]}'::jsonb;

ALTER TABLE public.restaurants
  DROP CONSTRAINT IF EXISTS restaurants_review_box_type_check,
  ADD CONSTRAINT restaurants_review_box_type_check
    CHECK (review_box_type = ANY (ARRAY['usullang'::text, 'scrap'::text, 'scrap_rating'::text]));

ALTER TABLE public.restaurants
  DROP CONSTRAINT IF EXISTS restaurants_scrap_board_shape_check,
  ADD CONSTRAINT restaurants_scrap_board_shape_check
    CHECK (
      jsonb_typeof(scrap_board) = 'object'
      AND jsonb_typeof(scrap_board -> 'items') = 'array'
      AND jsonb_array_length(scrap_board -> 'items') <= 60
      AND pg_column_size(scrap_board) <= 65536
    );

COMMENT ON COLUMN public.restaurants.review_box_type IS
  'First slide of the SpotCard review box: usullang (default), scrap (낙서장), or scrap_rating (낙서장 + 멤버 평가).';
COMMENT ON COLUMN public.restaurants.scrap_board IS
  '낙서장 board JSON {v, h, items[]} edited by admins; photos must be in the place-images bucket.';
