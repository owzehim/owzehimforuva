import { useEffect, useState } from 'react'
import Cropper from 'react-easy-crop'
import { Check, Minus, Plus, X } from '@phosphor-icons/react'
import imageCompression from 'browser-image-compression'

const compressImage = async (file) => {
  try {
    return await imageCompression(file, {
      maxSizeMB: 1.2,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
    })
  } catch {
    return file
  }
}

const loadImage = (src) => new Promise((resolve, reject) => {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.onload = () => resolve(image)
  image.onerror = reject
  image.src = src
})

export function ImageCropper({
  file,
  imageUrl,
  onCrop,
  onCancel,
  aspectRatios = ['1:1', '4:5'],
}) {
  const [imageSrc, setImageSrc] = useState(imageUrl || null)
  const [selectedRatio, setSelectedRatio] = useState(aspectRatios[0])
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [isCompressing, setIsCompressing] = useState(false)

  useEffect(() => {
    if (!file) {
      setImageSrc(imageUrl || null)
      return undefined
    }

    const objectUrl = URL.createObjectURL(file)
    setImageSrc(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file, imageUrl])

  useEffect(() => {
    setSelectedRatio(aspectRatios[0])
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setCroppedAreaPixels(null)
  }, [imageSrc, aspectRatios])

  const [ratioWidth, ratioHeight] = selectedRatio.split(':').map(Number)
  const aspect = ratioWidth / ratioHeight

  const handleRatioChange = (ratio) => {
    setSelectedRatio(ratio)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
  }

  const handleCrop = async () => {
    if (!imageSrc || !croppedAreaPixels) return

    setIsCompressing(true)
    try {
      const image = await loadImage(imageSrc)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(croppedAreaPixels.width))
      canvas.height = Math.max(1, Math.round(croppedAreaPixels.height))
      const context = canvas.getContext('2d')
      context.drawImage(
        image,
        croppedAreaPixels.x,
        croppedAreaPixels.y,
        croppedAreaPixels.width,
        croppedAreaPixels.height,
        0,
        0,
        canvas.width,
        canvas.height,
      )

      const mimeType = file?.type || 'image/jpeg'
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, mimeType, 0.92),
      )
      if (!blob) return

      const fileName = file?.name || 'cropped.jpg'
      const croppedFile = await compressImage(
        new File([blob], fileName, { type: mimeType }),
      )
      onCrop(croppedFile)
    } finally {
      setIsCompressing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white">
        <div className="flex items-center justify-between px-4 pt-4">
          <h3 className="text-sm font-semibold text-gray-900">이미지 자르기</h3>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 text-gray-400 hover:text-gray-600"
            aria-label="닫기"
          >
            <X size={20} />
          </button>
        </div>

        <div className="relative mx-4 h-[340px] overflow-hidden rounded-xl bg-black">
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              objectFit="cover"
              restrictPosition
              showGrid
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, areaPixels) => setCroppedAreaPixels(areaPixels)}
            />
          )}
        </div>

        <p className="px-4 text-xs text-gray-400">
          이미지는 자르기 영역을 항상 채우므로 빈 공간이 생기지 않습니다.
        </p>

        <div className="flex items-center gap-2 px-4">
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(1, +(value - 0.1).toFixed(2)))}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200"
          >
            <Minus size={14} />
          </button>
          <input
            type="range"
            min="1"
            max="4"
            step="0.05"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="flex-1 accent-blue-600"
          />
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(4, +(value + 0.1).toFixed(2)))}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200"
          >
            <Plus size={14} />
          </button>
          <span className="w-8 text-right text-xs text-gray-400">{zoom.toFixed(1)}x</span>
        </div>

        <div className="px-4">
          <div className="flex gap-2">
            {aspectRatios.map((ratio) => (
              <button
                key={ratio}
                type="button"
                onClick={() => handleRatioChange(ratio)}
                className={
                  'flex-1 rounded-lg py-2 text-sm font-medium transition-colors ' +
                  (selectedRatio === ratio
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200')
                }
              >
                {ratio}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 px-4 pb-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isCompressing}
            className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-60"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleCrop}
            disabled={!croppedAreaPixels || isCompressing}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check size={16} weight="bold" />
            {isCompressing ? '저장 중...' : '자르기'}
          </button>
        </div>
      </div>
    </div>
  )
}
