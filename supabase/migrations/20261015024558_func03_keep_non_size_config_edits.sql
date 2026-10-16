-- Keep config upserts working when only presentation fields change.
CREATE OR REPLACE FUNCTION public.prevent_stamp_card_size_change_after_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT'
     AND NOT EXISTS (
       SELECT 1
       FROM public.stamp_card_config AS existing
       WHERE existing.restaurant_id = NEW.restaurant_id
     )
     AND (
       EXISTS (
         SELECT 1
         FROM public.stamp_card_visits AS visit
         WHERE visit.restaurant_id = NEW.restaurant_id
       )
       OR EXISTS (
         SELECT 1
         FROM public.stamp_card_rewards AS reward
         WHERE reward.restaurant_id = NEW.restaurant_id
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'STAMP_CARD_TOTAL_STAMPS_LOCKED: 스탬프 기록이 있는 카드의 총 칸 수는 변경할 수 없습니다. 기록을 초기화한 뒤 다시 시도해 주세요.';
  ELSIF TG_OP = 'UPDATE'
     AND (
       NEW.total_stamps IS DISTINCT FROM OLD.total_stamps
       OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
     )
     AND (
       EXISTS (
         SELECT 1
         FROM public.stamp_card_visits AS visit
         WHERE visit.restaurant_id IN (OLD.restaurant_id, NEW.restaurant_id)
       )
       OR EXISTS (
         SELECT 1
         FROM public.stamp_card_rewards AS reward
         WHERE reward.restaurant_id IN (OLD.restaurant_id, NEW.restaurant_id)
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'STAMP_CARD_TOTAL_STAMPS_LOCKED: 스탬프 기록이 있는 카드의 총 칸 수는 변경할 수 없습니다. 기록을 초기화한 뒤 다시 시도해 주세요.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_stamp_card_size_change_after_progress()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS prevent_stamp_card_size_change_after_progress
  ON public.stamp_card_config;
CREATE TRIGGER prevent_stamp_card_size_change_after_progress
  BEFORE INSERT OR UPDATE OF restaurant_id, total_stamps
  ON public.stamp_card_config
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_stamp_card_size_change_after_progress();
