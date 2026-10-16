import { supabase } from '../../../lib/supabase'
import { compressImage } from '../../../lib/imageCompression'

export const DEFAULT_STAMP_CARD_CONFIG = {
  total_stamps: 10,
  stamps_per_row: 5,
  title: '',
  subtitle: '',
  reward_text: '',
  accent_color: '#ffffff',
  background_color: '#ffffff',
  text_color: '#111827',
  stamp_color: '#111827',
  wallpaper_url: null,
}

export async function fetchConfigBySpot(restaurantId) {
  const { data, error } = await supabase
    .from('stamp_card_config')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

export async function upsertConfig(restaurantId, data) {
  const { error } = await supabase
    .from('stamp_card_config')
    .upsert(
      {
        ...data,
        restaurant_id: restaurantId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'restaurant_id' }
    )

  if (error?.message?.includes('STAMP_CARD_TOTAL_STAMPS_LOCKED')) {
    throw new Error('이미 스탬프 기록이 있는 카드의 총 칸 수는 바꿀 수 없습니다. 기록을 초기화한 뒤 다시 시도해 주세요.')
  }
  if (error) throw error
}

export async function uploadWallpaper(restaurantId, file) {
  // Use existing compressImage helper (browser-image-compression)
  const compressed = await compressImage(file, {
    maxSizeMB: 0.8,
    maxWidthOrHeight: 1200,
  })

  const fileExt = file.name.split('.').pop() || 'jpg'
  const fileName = `${restaurantId}_${Date.now()}.${fileExt}`
  const contentType = compressed.type || file.type || 'image/jpeg'

  const { error: uploadError } = await supabase.storage
    .from('stamp-card-wallpapers')
    .upload(fileName, compressed, {
      contentType,
      upsert: true,
    })

  if (uploadError) throw uploadError

  const { data: urlData } = supabase.storage
    .from('stamp-card-wallpapers')
    .getPublicUrl(fileName)

  return urlData.publicUrl
}

export async function deleteWallpaper(wallpaperUrl) {
  const fileName = wallpaperUrl.split('/').pop()

  const { error } = await supabase.storage
    .from('stamp-card-wallpapers')
    .remove([fileName])

  if (error) throw error
  // Caller must call upsertConfig({ wallpaper_url: null }) after this
}
