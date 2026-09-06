// src/pages/SettingsPage.jsx
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import LoadingIndicator from '../components/LoadingIndicator'
import { updatePassword } from '../api/authRepository'
import { UserCircle, CaretLeft, Camera, PencilSimpleLine, Check, X } from '@phosphor-icons/react'
import Cropper from 'react-easy-crop'
import ThemeToggle from '../components/ThemeToggle'

// ─── Pastel avatar (must match MemberPage) ───────────────────────────────────
const PASTEL_COLORS = [
  '#FFB3B3',
  '#FFD9A0',
  '#FFF3A0',
  '#B3F0C2',
  '#A8D8FF',
  '#C5B3FF',
  '#FFB3E6',
  '#B3F0EE',
]

function getPastelColor(seed) {
  const str = seed || 'default'
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0
  }
  return PASTEL_COLORS[Math.abs(hash) % PASTEL_COLORS.length]
}

// ─── Image helpers ────────────────────────────────────────────────────────────

async function compressImage(file, maxWidth = 600, maxHeight = 600, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onerror = (err) => { URL.revokeObjectURL(url); reject(err) }
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        let { width, height } = img
        const ratio = Math.min(maxWidth / width, maxHeight / height, 1)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url)
          if (!blob) { reject(new Error('Failed to compress image')); return }
          resolve(blob)
        }, 'image/jpeg', quality)
      } catch (e) { URL.revokeObjectURL(url); reject(e) }
    }
    img.src = url
  })
}

async function getCroppedImgAsBlob(imageSrc, pixelCrop) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = imageSrc
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject })
  const canvas = document.createElement('canvas')
  canvas.width = pixelCrop.width
  canvas.height = pixelCrop.height
  canvas.getContext('2d').drawImage(img, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, pixelCrop.width, pixelCrop.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('Canvas is empty')); return }
      resolve(blob)
    }, 'image/jpeg', 0.95)
  })
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function SettingsPage() {
  const navigate = useNavigate()
  const [member, setMember] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [passwordPanelOpen, setPasswordPanelOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [usernameEditing, setUsernameEditing] = useState(false)
  const [usernameDraft, setUsernameDraft] = useState('')
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [usernameError, setUsernameError] = useState('')
  const fileInputRef = useRef(null)

  const [cropImageSrc, setCropImageSrc] = useState(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [cropModalOpen, setCropModalOpen] = useState(false)

  useEffect(() => {
    const load = async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) { navigate('/login'); return }
      const { data: memberData, error: memberError } = await supabase
        .from('members').select('*').eq('user_id', user.id).maybeSingle()
      if (memberError) console.error('load member error:', memberError)
      setMember(memberData || null)
      setLoading(false)
    }
    load()
  }, [navigate])

  useEffect(() => {
    const edgeWidth = 30
    let touchStartX = 0
    let touchStartY = 0
    let startedAtHorizontalEdge = false
    const root = document.documentElement
    const body = document.body
    const previousRootOverscrollX = root.style.overscrollBehaviorX
    const previousBodyOverscrollX = body.style.overscrollBehaviorX

    root.style.overscrollBehaviorX = 'none'
    body.style.overscrollBehaviorX = 'none'

    const handleTouchStart = (event) => {
      if (event.touches.length !== 1) {
        startedAtHorizontalEdge = false
        return
      }

      const touch = event.touches[0]
      touchStartX = touch.clientX
      touchStartY = touch.clientY
      startedAtHorizontalEdge =
        touchStartX <= edgeWidth ||
        touchStartX >= window.innerWidth - edgeWidth
    }

    const handleTouchMove = (event) => {
      if (!startedAtHorizontalEdge || event.touches.length !== 1) return

      const touch = event.touches[0]
      const horizontalDistance = Math.abs(touch.clientX - touchStartX)
      const verticalDistance = Math.abs(touch.clientY - touchStartY)

      if (horizontalDistance > verticalDistance) event.preventDefault()
    }

    const handleTouchEnd = () => {
      startedAtHorizontalEdge = false
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd, { passive: true })
    document.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      root.style.overscrollBehaviorX = previousRootOverscrollX
      body.style.overscrollBehaviorX = previousBodyOverscrollX
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [])

  const handleLogout = async () => {
    navigate('/public', { replace: true })
    await supabase.auth.signOut()
  }

  const handlePasswordPanelToggle = () => {
    setPasswordPanelOpen((open) => !open)
    setPasswordError('')
    setPasswordSuccess('')
    setNewPassword('')
    setConfirmPassword('')
  }

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess('')

    if (newPassword.length < 8) {
      setPasswordError('비밀번호는 최소 8자 이상이어야 합니다.')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('비밀번호가 일치하지 않습니다.')
      return
    }

    setPasswordLoading(true)
    try {
      await updatePassword(newPassword)
      setPasswordSuccess('비밀번호가 변경되었습니다.')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setPasswordError(err.message || '비밀번호 변경 중 오류가 발생했습니다.')
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    const reader = new FileReader()
    reader.onload = () => {
      setCropImageSrc(reader.result)
      setCrop({ x: 0, y: 0 })
      setZoom(1)
      setCropModalOpen(true)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleCropConfirm = async () => {
    if (!member || !cropImageSrc || !croppedAreaPixels) return
    setUploading(true)
    setError('')
    try {
      const croppedBlob = await getCroppedImgAsBlob(cropImageSrc, croppedAreaPixels)
      const compressed = await compressImage(croppedBlob, 600, 600, 0.7)
      const filePath = `avatars/${member.user_id}.jpg`
      const { error: uploadError } = await supabase.storage
        .from('profile-images').upload(filePath, compressed, { contentType: 'image/jpeg', upsert: true })
      if (uploadError) throw uploadError
      const { data: publicData } = supabase.storage.from('profile-images').getPublicUrl(filePath)
      let url = publicData?.publicUrl || null
      if (url) url = `${url}?v=${Date.now()}`
      const { error: updateError } = await supabase
        .from('members').update({ profile_image_url: url }).eq('user_id', member.user_id)
      if (updateError) throw updateError
      setMember((prev) => prev ? { ...prev, profile_image_url: url } : prev)
      setCropModalOpen(false)
      setCropImageSrc(null)
      setCroppedAreaPixels(null)
    } catch (err) {
      console.error(err)
      setError('프로필 사진 변경 중 오류가 발생했습니다.')
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteProfileImage = async () => {
    if (!member) return
    setError('')
    setUploading(true)
    try {
      const filePath = `avatars/${member.user_id}.jpg`
      const { error: removeError } = await supabase.storage.from('profile-images').remove([filePath])
      if (removeError) throw removeError
      const { error: updateError } = await supabase
        .from('members').update({ profile_image_url: null }).eq('id', member.id)
      if (updateError) throw updateError
      setMember((prev) => prev ? { ...prev, profile_image_url: null } : prev)
    } catch (err) {
      console.error(err)
      setError('프로필 사진 삭제 중 오류가 발생했습니다.')
    } finally {
      setUploading(false)
    }
  }

  const handleUsernameEditStart = () => {
    setUsernameDraft(member?.username || '')
    setUsernameError('')
    setUsernameEditing(true)
  }

  const handleUsernameEditCancel = () => {
    setUsernameDraft('')
    setUsernameError('')
    setUsernameEditing(false)
  }

  const handleUsernameSave = async () => {
    if (!member || usernameSaving) return

    const trimmedUsername = usernameDraft.trim()
    setUsernameError('')

    if (trimmedUsername && !/^[A-Za-z0-9_]{2,20}$/.test(trimmedUsername)) {
      setUsernameError('2-20자의 영문, 숫자, 밑줄만 사용할 수 있습니다.')
      return
    }

    setUsernameSaving(true)
    try {
      const { error: updateError } = await supabase
        .from('members')
        .update({ username: trimmedUsername || null })
        .eq('id', member.id)

      if (updateError) throw updateError

      if (trimmedUsername) {
        const { error: notesUpdateError } = await supabase
          .from('restaurant_notes')
          .update({
            username: trimmedUsername,
            profile_image_url: member.profile_image_url || null,
          })
          .eq('user_id', member.user_id)

        if (notesUpdateError) throw notesUpdateError
      }

      setMember((prev) => prev ? { ...prev, username: trimmedUsername || null } : prev)
      setUsernameEditing(false)
      setUsernameDraft('')
    } catch (err) {
      console.error(err)
      setUsernameError('사용자 이름 저장 중 오류가 발생했습니다.')
    } finally {
      setUsernameSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#121212]">
        <LoadingIndicator />
      </div>
    )
  }

  const hasProfileImage = !!member?.profile_image_url
  const avatarSeed = `${member?.first_name || ''}${member?.last_name || ''}`
  const pastelBg = getPastelColor(avatarSeed)
  const koreanDisplayName = [
    member?.last_name_korean || member?.last_name_ko,
    member?.first_name_korean || member?.first_name_ko,
  ]
    .map((namePart) => namePart?.trim())
    .filter(Boolean)
    .join('')
  const englishDisplayName = [member?.first_name, member?.last_name]
    .map((namePart) => namePart?.trim())
    .filter(Boolean)
    .join(' ')
  const displayName = koreanDisplayName || englishDisplayName
  const username = member?.username?.trim()
  const usernameDisplay = username || displayName

  return (
    <div
      className="phone-app-shell flex flex-col bg-white no-highlight-zone dark:bg-[#121212]"
      style={{
        minHeight: '100dvh',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <style>{`
        .no-highlight-zone,
        .no-highlight-zone * {
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
      `}</style>
      {/* Header */}
      <div
        className="relative bg-white px-4 py-3 flex items-center gap-2 flex-shrink-0 dark:bg-[#121212]"
        style={settingsHeaderStyle}
      >
        <button
          type="button"
          onClick={() => navigate('/member')}
          className="text-[#374151] dark:text-[#c7c7cc]"
          style={settingsBackButtonStyle}
          aria-label="Back to member page"
        >
          <CaretLeft size={24} weight="bold" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto space-y-6 px-4 py-6" style={{ maxWidth: 'var(--app-screen-width)' }}>

          {/* Profile card */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 flex flex-col items-center gap-4 dark:border-[#2c2c2e] dark:bg-[#111111]">

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label="프로필 사진 변경"
              style={{
                width: '96px',
                height: '96px',
                position: 'relative',
                padding: 0,
                border: 'none',
                background: 'transparent',
                cursor: uploading ? 'not-allowed' : 'pointer',
                opacity: uploading ? 0.7 : 1,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: '96px',
                  height: '96px',
                  borderRadius: '50%',
                  background: hasProfileImage ? 'transparent' : pastelBg,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {hasProfileImage ? (
                  <img
                    src={member.profile_image_url}
                    alt="Profile"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <UserCircle size="72%" weight="fill" color="rgba(44,42,39,0.55)" />
                )}
              </div>
              <span
                style={{
                  position: 'absolute',
                  right: '-1px',
                  bottom: '1px',
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  backgroundColor: '#fff',
                  border: '1px solid #111827',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(17,24,39,0.14)',
                }}
              >
                <Camera size={19} weight="fill" color="#111827" />
              </span>
            </button>

            <div className="text-center">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {displayName}
              </p>
              <div className="mt-1 flex items-center justify-center">
                {usernameEditing ? (
                  <>
                    <input
                      type="text"
                      value={usernameDraft}
                      onChange={(event) => setUsernameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') handleUsernameSave()
                        if (event.key === 'Escape') handleUsernameEditCancel()
                      }}
                      disabled={usernameSaving}
                      autoFocus
                      className="h-8 w-36 rounded-none border-0 border-b border-dotted border-gray-400 bg-transparent px-1 text-center text-xs font-medium text-gray-700 outline-none focus:border-gray-800 dark:border-gray-500 dark:text-gray-200 dark:focus:border-white"
                      placeholder="username"
                    />
                    <button
                      type="button"
                      onClick={handleUsernameSave}
                      disabled={usernameSaving}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-gray-700 disabled:opacity-50 dark:text-gray-200"
                      aria-label="사용자 이름 저장"
                    >
                      <Check size={17} weight="bold" />
                    </button>
                    <button
                      type="button"
                      onClick={handleUsernameEditCancel}
                      disabled={usernameSaving}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 disabled:opacity-50 dark:text-gray-400"
                      aria-label="사용자 이름 편집 취소"
                    >
                      <X size={16} weight="bold" />
                    </button>
                  </>
                ) : (
                  <div className="relative inline-flex min-w-0 justify-center">
                    <span className={`text-xs font-medium text-gray-500 dark:text-gray-400 ${username ? '' : 'italic'}`}>
                      {usernameDisplay}
                    </span>
                    <button
                      type="button"
                      onClick={handleUsernameEditStart}
                      className="absolute left-full top-1/2 ml-1 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-gray-500 dark:text-gray-400"
                      aria-label="사용자 이름 편집"
                    >
                      <PencilSimpleLine size={15} weight="regular" />
                    </button>
                  </div>
                )}
              </div>
              {usernameError && <p className="mt-1 text-xs text-red-500">{usernameError}</p>}
              <p className="text-xs text-gray-400 mt-1 dark:text-gray-500">{member?.email}</p>
              {hasProfileImage && (
                <button
                  type="button"
                  onClick={handleDeleteProfileImage}
                  disabled={uploading}
                  className="mt-3 px-4 py-2 rounded-full border border-gray-300 text-gray-600 text-xs font-medium disabled:opacity-60 dark:border-gray-700 dark:text-gray-300"
                >
                  프로필 사진 지우기
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            {error && <p className="text-xs text-red-500 text-center mt-1">{error}</p>}
          </div>

          <div className="space-y-6 pb-6">
            <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-[#2c2c2e] dark:bg-[#111111]">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">화면 모드</p>
              </div>
              <ThemeToggle />
            </div>

            <button
              type="button"
              onClick={() => {
                // Keep a one-time fallback signal in case navigation state is lost
                // when the member page remounts in an installed PWA.
                window.sessionStorage.setItem('uvain_reopen_welcome_slides', '1')
                navigate('/member', { state: { reopenWelcomeSlides: true } })
              }}
              className="w-full rounded-full border border-gray-200 bg-white px-5 py-3 text-center text-sm font-semibold text-gray-700 shadow-sm dark:border-[#2c2c2e] dark:bg-[#111111] dark:text-gray-200"
            >
              앱 사용법 다시 보기
            </button>

            <button
              type="button"
              onClick={() => navigate('/settings/password')}
              className="w-full rounded-full border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 text-center shadow-sm dark:border-[#2c2c2e] dark:bg-[#111111] dark:text-gray-200"
            >
              비밀번호 바꾸기
            </button>

            {passwordPanelOpen && (
              <form
                onSubmit={handlePasswordChange}
                className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 dark:border-[#2c2c2e] dark:bg-[#111111]"
              >
                <label className="flex h-[54px] cursor-text flex-col justify-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-[#2c2c2e] dark:bg-[#121212]">
                  <span className="text-xs font-normal leading-none text-gray-500 dark:text-gray-400">새 비밀번호</span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full border-none bg-white p-0 text-sm text-gray-900 outline-none focus:outline-none dark:bg-[#121212] dark:text-white"
                    required
                  />
                </label>

                <label className="flex h-[54px] cursor-text flex-col justify-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-[#2c2c2e] dark:bg-[#121212]">
                  <span className="text-xs font-normal leading-none text-gray-500 dark:text-gray-400">새 비밀번호 확인</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full border-none bg-white p-0 text-sm text-gray-900 outline-none focus:outline-none dark:bg-[#121212] dark:text-white"
                    required
                  />
                </label>

                {passwordError && <p className="text-xs text-red-500">{passwordError}</p>}
                {passwordSuccess && <p className="text-xs text-green-600">{passwordSuccess}</p>}

                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="w-full rounded-full bg-orange-500 px-5 py-3 text-sm font-semibold text-white text-center shadow-sm disabled:opacity-50"
                >
                  {passwordLoading ? '변경 중...' : '변경 완료'}
                </button>
              </form>
            )}

            <button
              type="button"
              onClick={handleLogout}
              className="w-full rounded-full bg-gray-900 px-5 py-3 text-sm font-semibold text-white text-center shadow-sm dark:bg-gray-100 dark:text-gray-950"
            >
              로그아웃
            </button>
          </div>
        </div>
      </div>

      {/* Crop modal */}
      {cropModalOpen && cropImageSrc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-white rounded-2xl p-4 w-full max-w-sm flex flex-col gap-4 dark:bg-[#111111]">
            <h2 className="text-sm font-semibold text-gray-900 mb-1 dark:text-white">프로필 사진 자르기</h2>
            <div className="relative w-full h-64 rounded-xl overflow-hidden bg-gray-900">
              <Cropper
                image={cropImageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, areaPixels) => setCroppedAreaPixels(areaPixels)}
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="range" min={1} max={3} step={0.1} value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setCropModalOpen(false); setCropImageSrc(null); setCroppedAreaPixels(null) }}
                className="px-3 py-1.5 rounded-full text-xs text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleCropConfirm}
                disabled={uploading}
                className="px-4 py-1.5 rounded-full bg-gray-900 text-white text-xs font-medium disabled:opacity-60 dark:bg-gray-100 dark:text-gray-950"
              >
                {uploading ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const settingsBackButtonStyle = {
  position: 'fixed',
  left: '14px',
  top: 'calc(env(safe-area-inset-top) + 6px)',
  zIndex: 10,
  background: 'none',
  border: 'none',
  fontSize: '24px',
  cursor: 'pointer',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'color 0.2s',
  width: '44px',
  height: '44px',
}

const settingsHeaderStyle = {
  paddingTop: 'calc(env(safe-area-inset-top) + 6px)',
  minHeight: 'calc(env(safe-area-inset-top) + 56px)',
}
