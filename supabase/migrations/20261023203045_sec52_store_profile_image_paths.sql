-- Normalize existing member avatar references to the private bucket object path.
-- The client generates a short-lived signed URL after authenticating the member.
UPDATE public.members
SET profile_image_url = regexp_replace(
  profile_image_url,
  '^.*?/object/(public|sign)/profile-images/([^?]+).*$',
  '\2'
)
WHERE profile_image_url ~ '/object/(public|sign)/profile-images/';
