ALTER TABLE public.restaurants
  ADD COLUMN commercial_display_type text NOT NULL DEFAULT 'none';

UPDATE public.restaurants
SET commercial_display_type = 'member_discount'
WHERE is_sponsored = true;

ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_commercial_display_type_check
  CHECK (commercial_display_type IN ('none', 'member_discount', 'paid_ad'));

COMMENT ON COLUMN public.restaurants.commercial_display_type IS
  'Public disclosure label for member discounts or paid advertising.';
