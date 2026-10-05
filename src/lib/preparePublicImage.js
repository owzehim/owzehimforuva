const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const MAX_IMAGE_PIXELS = 40_000_000
const MAX_EDGE = 2560

/** Re-encode public admin uploads so EXIF/GPS metadata and original formats are removed. */
export async function preparePublicImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) {
    throw new Error('JPG, PNG, WEBP 또는 AVIF 이미지 파일만 업로드할 수 있습니다.')
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('이미지는 15MB 이하만 업로드할 수 있습니다.')
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
      throw new Error('이미지 해상도가 너무 큽니다.')
    }

    const scale = Math.min(1, MAX_EDGE / bitmap.width, MAX_EDGE / bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('이미지를 처리하지 못했습니다.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result)
        else reject(new Error('이미지를 변환하지 못했습니다.'))
      }, 'image/webp', 0.9)
    })
    return new File([blob], `${crypto.randomUUID()}.webp`, { type: 'image/webp' })
  } finally {
    bitmap.close()
  }
}
