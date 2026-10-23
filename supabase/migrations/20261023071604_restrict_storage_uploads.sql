-- Keep each bucket's upload contract aligned with the app's image handling.
DO $$
DECLARE
  expected_count integer;
BEGIN
  SELECT count(*)
    INTO expected_count
    FROM storage.buckets
   WHERE id IN (
     'profile-images',
     'event-images',
     'place-images',
     'stamp-card-wallpapers'
   );

  IF expected_count <> 4 THEN
    RAISE EXCEPTION 'Expected all 4 application image buckets, found %', expected_count;
  END IF;
END
$$;

UPDATE storage.buckets
   SET file_size_limit = CASE id
         WHEN 'profile-images' THEN 5 * 1024 * 1024
         WHEN 'event-images' THEN 15 * 1024 * 1024
         WHEN 'place-images' THEN 15 * 1024 * 1024
         WHEN 'stamp-card-wallpapers' THEN 15 * 1024 * 1024
       END,
       allowed_mime_types = CASE id
         WHEN 'profile-images' THEN ARRAY['image/jpeg']::text[]
         WHEN 'event-images' THEN ARRAY['image/webp']::text[]
         WHEN 'place-images' THEN ARRAY['image/webp']::text[]
         WHEN 'stamp-card-wallpapers' THEN ARRAY[
           'image/jpeg', 'image/png', 'image/webp', 'image/avif'
         ]::text[]
       END
 WHERE id IN (
   'profile-images',
   'event-images',
   'place-images',
   'stamp-card-wallpapers'
 );
