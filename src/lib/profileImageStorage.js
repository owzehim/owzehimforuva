import { supabase } from './supabase'
import { getProfileImagePath } from './profileImagePath'

const PROFILE_BUCKET = 'profile-images'
const SIGNED_URL_TTL_SECONDS = 60 * 60

export async function createProfileImageSignedUrl(value) {
  const path = getProfileImagePath(value)
  if (!path) return null

  const { data, error } = await supabase.storage
    .from(PROFILE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

  if (error) {
    console.warn('Could not create a signed profile image URL:', error.message)
    return null
  }
  return data?.signedUrl || null
}
