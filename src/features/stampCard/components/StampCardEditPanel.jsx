import { useEffect, useRef, useState } from 'react'
import { sanitizeRichText } from '../../../lib/sanitizeHtml'
import { ArrowLeft, ClockCounterClockwise, Trash, UploadSimple } from '@phosphor-icons/react'
import {
  DEFAULT_STAMP_CARD_CONFIG,
  deleteWallpaper,
  fetchConfigBySpot,
  uploadWallpaper,
  upsertConfig,
} from '../api/config'
import { resetStampCardProgress } from '../api/visits'
import StampCard from './StampCard'

export default function StampCardEditPanel({ restaurantId, spotName, onClose }) {
  const [savedConfig, setSavedConfig] = useState(null)
  const [draft, setDraft] = useState(DEFAULT_STAMP_CARD_CONFIG)
  const [slideIn, setSlideIn] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => setSlideIn(true), 30)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!restaurantId) return
    fetchConfigBySpot(restaurantId).then((config) => {
      const base = config ?? DEFAULT_STAMP_CARD_CONFIG
      setSavedConfig(base)
      setDraft({ ...DEFAULT_STAMP_CARD_CONFIG, ...base })
    })
  }, [restaurantId])

  const isDirty = JSON.stringify(draft) !== JSON.stringify(savedConfig ?? DEFAULT_STAMP_CARD_CONFIG)
  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }))

  const handleBack = () => {
    if (isDirty && !window.confirm('저장하지 않고 나가시겠어요?')) return
    onClose()
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await upsertConfig(restaurantId, draft)
      onClose()
    } catch (e) {
      console.error('upsertConfig error:', e)
      alert('저장 실패: ' + (e?.message || '알 수 없는 오류'))
    } finally {
      setSaving(false)
    }
  }

  const handleResetProgress = async () => {
    if (!window.confirm('이 스팟의 모든 멤버 스탬프와 리워드 기록을 0부터 다시 시작할까요?')) return
    setResetting(true)
    try {
      const result = await resetStampCardProgress(restaurantId)
      alert(result.auditLogged === false
        ? '스탬프 기록은 초기화됐지만 관리자 작업 기록 저장에 실패했습니다. 작업 기록을 확인해 주세요.'
        : '스탬프 카드가 0부터 다시 시작되도록 초기화되었습니다.')
    } catch (e) {
      console.error('resetStampCardProgress error:', e)
      alert('초기화 실패: ' + (e?.message || '알 수 없는 오류'))
    } finally {
      setResetting(false)
    }
  }

  const handleWallpaperChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const publicUrl = await uploadWallpaper(restaurantId, file)
      set('wallpaper_url', publicUrl)
    } catch (e) {
      console.error('uploadWallpaper error:', e)
      alert('이미지 업로드 실패: ' + (e?.message || '알 수 없는 오류'))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleDeleteWallpaper = async () => {
    if (!draft.wallpaper_url) return
    try {
      await deleteWallpaper(draft.wallpaper_url)
      set('wallpaper_url', null)
    } catch (e) {
      console.error('deleteWallpaper error:', e)
      alert('이미지 삭제 실패: ' + (e?.message || '알 수 없는 오류'))
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        transform: slideIn ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 350ms cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 flex-shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}
      >
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-gray-600 text-sm font-medium"
        >
          <ArrowLeft size={18} weight="bold" />
          스탬프 카드 편집
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handleResetProgress}
            disabled={resetting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-red-200 bg-red-50 text-red-600"
          >
            <ClockCounterClockwise size={15} weight="bold" />
            {resetting ? '초기화 중...' : '스탬프 초기화'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: saving ? '#9ca3af' : '#f97316' }}
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-4 max-w-3xl mx-auto">
          <div className="flex flex-col gap-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {spotName}
            </p>

            <Field label="총 스탬프 수">
              <input
                type="number"
                min="1"
                value={draft.total_stamps}
                onChange={(e) => set('total_stamps', Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="input-base"
              />
            </Field>

            <Field label="행당 스탬프 수">
              <input
                type="number"
                min="1"
                value={draft.stamps_per_row}
                onChange={(e) => set('stamps_per_row', Math.max(1, parseInt(e.target.value, 10) || 1))}
                onBlur={() => {
                  if (draft.stamps_per_row > draft.total_stamps) set('stamps_per_row', draft.total_stamps)
                }}
                className="input-base"
              />
            </Field>

            <Field label="카드 제목">
              <RichTextField
                placeholder="카드 제목"
                value={draft.title}
                onChange={(value) => set('title', value)}
              />
            </Field>

            <Field label="부제목">
              <RichTextField
                placeholder="부제목"
                value={draft.subtitle}
                onChange={(value) => set('subtitle', value)}
              />
            </Field>

            <Field label="리워드 문구">
              <RichTextField
                placeholder="예: 음료 1잔 무료"
                value={draft.reward_text}
                onChange={(value) => set('reward_text', value)}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="강조 색상">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.accent_color}
                    onChange={(e) => set('accent_color', e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer border border-gray-200"
                  />
                  <span className="text-xs text-gray-500 font-mono">{draft.accent_color}</span>
                </div>
              </Field>

              <Field label="배경 색상">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.background_color || '#ffffff'}
                    onChange={(e) => set('background_color', e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer border border-gray-200"
                  />
                  <span className="text-xs text-gray-500 font-mono">{draft.background_color || '#ffffff'}</span>
                </div>
              </Field>

              <Field label="텍스트 색상">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.text_color}
                    onChange={(e) => set('text_color', e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer border border-gray-200"
                  />
                  <span className="text-xs text-gray-500 font-mono">{draft.text_color}</span>
                </div>
              </Field>

              <Field label="스탬프 색상">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.stamp_color || draft.text_color || '#111827'}
                    onChange={(e) => set('stamp_color', e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer border border-gray-200"
                  />
                  <span className="text-xs text-gray-500 font-mono">{draft.stamp_color || draft.text_color || '#111827'}</span>
                </div>
              </Field>
            </div>

            <Field label="배경 이미지">
              {draft.wallpaper_url ? (
                <div className="flex items-center gap-3">
                  <img
                    src={draft.wallpaper_url}
                    alt="wallpaper"
                    className="w-16 h-16 rounded-lg object-cover border border-gray-200"
                  />
                  <button
                    onClick={handleDeleteWallpaper}
                    className="flex items-center gap-1.5 text-xs text-red-500 font-medium px-3 py-1.5 rounded-lg border border-red-200 bg-red-50"
                  >
                    <Trash size={14} weight="bold" />
                    삭제
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 text-sm text-gray-600 font-medium px-4 py-2 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100"
                >
                  <UploadSimple size={16} weight="bold" />
                  {uploading ? '업로드 중...' : '이미지 업로드'}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleWallpaperChange}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              미리보기
            </p>
            <StampCard
              size="full"
              config={draft}
              visits={[]}
              isCardFull={false}
            />
            <p className="text-xs text-gray-400 text-center">
              실제 카드는 멤버의 방문 기록에 따라 표시됩니다.
            </p>
          </div>
        </div>
      </div>

      <style>{`
        .input-base {
          width: 100%;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 14px;
          color: #111827;
          outline: none;
          background: #fff;
        }
        .input-base:focus {
          border-color: #f97316;
          box-shadow: 0 0 0 2px rgba(249,115,22,0.15);
        }
        .rich-text-box:empty:before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
        }
      `}</style>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      {children}
    </div>
  )
}

function RichTextField({ value, onChange, placeholder }) {
  const editorRef = useRef(null)

  useEffect(() => {
    if (!editorRef.current) return
    const safeValue = sanitizeRichText(value || '')
    if (editorRef.current.innerHTML !== safeValue) {
      editorRef.current.innerHTML = safeValue
    }
  }, [value])

  const emitChange = () => {
    const html = sanitizeRichText(editorRef.current?.innerHTML || '')
    onChange(html === '<br>' ? '' : html)
  }

  const format = (command) => {
    editorRef.current?.focus()
    document.execCommand(command, false, null)
    emitChange()
  }

  return (
    <div className="input-focus-frame border border-gray-200 rounded-lg overflow-hidden bg-white focus-within:border-orange-600 focus-within:shadow-[0_0_0_2px_rgba(249,115,22,0.15)]">
      <div className="flex items-center gap-1 border-b border-gray-100 bg-gray-50 px-2 py-1">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => format('bold')}
          className="w-7 h-7 rounded text-xs font-bold text-gray-700 hover:bg-white"
          title="Bold"
        >
          B
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => format('italic')}
          className="w-7 h-7 rounded text-xs italic font-semibold text-gray-700 hover:bg-white"
          title="Italic"
        >
          I
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => format('underline')}
          className="w-7 h-7 rounded text-xs underline font-semibold text-gray-700 hover:bg-white"
          title="Underline"
        >
          U
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-label={placeholder}
        data-placeholder={placeholder}
        className="rich-text-box min-h-9 px-3 py-2 text-sm text-gray-900 outline-none"
        onInput={emitChange}
        onBlur={emitChange}
        suppressContentEditableWarning
      />
    </div>
  )
}
