import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import LoadingIndicator from '../components/LoadingIndicator'
import { useNavigate } from 'react-router-dom'
import { ImageCropper } from '../components/ImageCropper'
import { Plus, Eye, EyeSlash, MapPin, Ticket, StarFour } from '@phosphor-icons/react'
import StampCardEditPanel from '../features/stampCard/components/StampCardEditPanel'
import StampCardMemberPanel from '../features/stampCard/components/StampCardMemberPanel'
import { fetchConfigBySpot } from '../features/stampCard/api/config'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the date part "YYYY-MM-DD" from whatever Supabase returns.
 */
function toLocalDateString(isoString) {
  if (!isoString) return ''
  const s = String(isoString)
  if (s.includes('T') || s.includes('Z') || /[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        '0',
      )}-${String(d.getDate()).padStart(2, '0')}`
    }
  }
  return s.slice(0, 10)
}

/**
 * Extract the time part "HH:MM" from whatever Supabase returns.
 * Converts timestamptz to local time; if already local, slice it.
 */
function toLocalTimeString(isoString) {
  if (!isoString) return ''
  const s = String(isoString)
  if (s.includes('+') || s.endsWith('Z') || s.includes('Z')) {
    const d = new Date(s)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }
  return s.length >= 16 ? s.slice(11, 16) : ''
}

function toEventEndTimeInput(event) {
  const endTime = toLocalTimeString(event?.event_end_date)
  if (!endTime) return ''

  const startDate = toLocalDateString(event?.event_date)
  const endDate = toLocalDateString(event?.event_end_date)

  if (endTime === '00:00' && (!endDate || endDate === startDate)) {
    return ''
  }

  return endTime
}

/**
 * Combine local date "YYYY-MM-DD" and time "HH:MM" into ISO string.
 */
function combineDateTime(dateStr, timeStr, fallbackTime = '00:00') {
  if (!dateStr) return null
  const time = timeStr || fallbackTime
  if (!time) return null
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const local = new Date(y, mo - 1, d, h, mi, 0)
  return local.toISOString()
}

function getEventDateInputs(event) {
  const dates = Array.isArray(event?.event_dates) ? event.event_dates : []
  const fromList = dates.map((value) => toLocalDateString(value)).filter(Boolean)
  const fallback = toLocalDateString(event?.event_date)
  const uniqueDates = Array.from(new Set([...fromList, fallback].filter(Boolean)))
  return uniqueDates.length ? uniqueDates : ['']
}

/**
 * Validate & normalise a typed time string into "HH:MM".
 */
function normaliseTime(raw) {
  const s = raw.trim().replace(/[^0-9:]/g, '')
  const noColon = s.replace(':', '')
  if (noColon.length === 4) {
    const h = parseInt(noColon.slice(0, 2), 10)
    const m = parseInt(noColon.slice(2, 4), 10)
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
  }
  const parts = s.split(':')
  if (parts.length === 2) {
    const h = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10)
    if (!isNaN(h) && !isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
  }
  return ''
}

function koreanSort(arr, key) {
  return [...arr].sort((a, b) =>
    (a[key] || '').localeCompare(b[key] || '', ['ko', 'en'])
  )
}

// ─── Time Input ───────────────────────────────────────────────────────────────

function TimeInput({ value, onChange, className = '' }) {
  const [draft, setDraft] = useState(value || '')
  const [error, setError] = useState(false)

  useEffect(() => {
    setDraft(value || '')
  }, [value])

  const handleChange = (e) => {
    setDraft(e.target.value)
    setError(false)
  }

  const handleBlur = () => {
    if (draft === '') {
      onChange('')
      setError(false)
      return
    }
    const normalised = normaliseTime(draft)
    if (normalised) {
      setDraft(normalised)
      setError(false)
      onChange(normalised)
    } else {
      setError(true)
    }
  }

  return (
    <div>
      <input
        type="text"
        inputMode="numeric"
        placeholder="HH:MM"
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
        className={`${className} ${
          error ? 'border-red-400 bg-red-50' : ''
        }`}
      />
      {error && (
        <p className="text-xs text-red-500 mt-1">
          올바른 시간 형식을 입력하세요 (예: 14:30)
        </p>
      )}
    </div>
  )
}

// ─── AdminPage ────────────────────────────────────────────────────────────────

const ADMIN_ACTIVE_TAB_KEY = 'uvain_admin_active_tab'
const ADMIN_TABS = ['members', 'events', 'restaurants']

function getStoredAdminTab() {
  if (typeof window === 'undefined') return 'members'
  const storedTab = window.sessionStorage.getItem(ADMIN_ACTIVE_TAB_KEY)
  return ADMIN_TABS.includes(storedTab) ? storedTab : 'members'
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState(getStoredAdminTab)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const checkAdmin = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        navigate('/login')
        return
      }

      const isAdmin = user.user_metadata?.role === 'admin'

      if (!isAdmin) {
        navigate('/member')
        return
      }

      setLoading(false)
    }

    checkAdmin()
  }, [navigate])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingIndicator />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      {/* Header */}
      <div
        className="bg-white border-b border-gray-100 px-4 pb-3 flex items-center justify-between"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 12px)',
          minHeight: 'calc(env(safe-area-inset-top) + 56px)',
        }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/member')}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← 내 QR
          </button>
          <h1 className="font-bold text-gray-900">관리자 패널</h1>
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          로그아웃
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 px-4 flex gap-1 overflow-x-auto">
        {[
          { key: 'members', label: '멤버 관리' },
          { key: 'events', label: '이벤트' },
          { key: 'restaurants', label: '장소' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              window.sessionStorage.setItem(ADMIN_ACTIVE_TAB_KEY, tab.key)
              setActiveTab(tab.key)
            }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="w-full px-4 py-6">
        <div className="max-w-3xl mx-auto">
          {activeTab === 'members' && <MembersTab />}
          {activeTab === 'events' && <EventsTab />}
          {activeTab === 'restaurants' && <RestaurantsTab />}
        </div>
      </div>
    </div>
  )
}

// ─── Rich Text Editor ─────────────────────────────────────────────────────────

const COLORS = [
  '#000000',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ffffff',
]

function RichEditor({ value, onChange, placeholder, rows = 3 }) {
  const ref = useRef(null)
  const [showColors, setShowColors] = useState(false)
  const isInitialized = useRef(false)

  useEffect(() => {
    if (ref.current && !isInitialized.current) {
      ref.current.innerHTML = value || ''
      isInitialized.current = true
    }
  }, [])

  useEffect(() => {
    if (ref.current && value === '') ref.current.innerHTML = ''
  }, [value])

  const exec = (cmd, val = null) => {
    if (!ref.current) return
    ref.current.focus()
    document.execCommand(cmd, false, val)
    onChange(ref.current.innerHTML)
  }

  const handleInput = () => {
    if (!ref.current) return
    onChange(ref.current.innerHTML)
  }

  const applyColor = (color) => {
    exec('foreColor', color)
    setShowColors(false)
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-visible">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-100 bg-gray-50 flex-wrap">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            exec('bold')
          }}
          className="text-xs px-2 py-1 bg-white border border-gray-200 rounded font-bold hover:bg-gray-100"
        >
          B
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            exec('italic')
          }}
          className="text-xs px-2 py-1 bg-white border border-gray-200 rounded italic hover:bg-gray-100"
        >
          I
        </button>
        <div className="relative">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              setShowColors((v) => !v)
            }}
            className="text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-100"
          >
            🎨
          </button>
          {showColors && (
            <div
              className="absolute top-7 left-0 z-50 bg-white border border-gray-200 rounded-lg p-2 shadow-lg flex gap-1 flex-wrap"
              style={{ width: '120px' }}
            >
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    applyColor(c)
                  }}
                  className="w-6 h-6 rounded-full border border-gray-300 hover:scale-110 transition-transform"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            exec('removeFormat')
          }}
          className="text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-100 text-gray-500"
        >
          ✕
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={handleInput}
        data-placeholder={placeholder}
        className="px-3 py-2 text-sm outline-none"
        style={{
          minHeight: `${rows * 1.5}rem`,
          whiteSpace: 'pre-wrap',
          overflowY: 'auto',
          direction: 'ltr',
          unicodeBidi: 'plaintext',
        }}
      />
      <style>{`[contenteditable]:empty:before{content:attr(data-placeholder);color:#9ca3af}`}</style>
    </div>
  )
}

// ─── ImageUploadPanel ────────────────────────────────────────────────────────

function ImageUploadPanel({
  imagePreviews,
  existingUrls,
  pendingReplacements,
  onAddFile,
  onAddCropped,
  onRemoveNew,
  onRemoveExisting,
  onPendingReplace,
  onReorder,
}) {
  const [cropperSource, setCropperSource] = useState(null)
  const dragIdx = useRef(null)

  const handleFileSelect = (e) => {
    Array.from(e.target.files || []).forEach((f) => onAddFile(f))
    e.target.value = ''
  }

  const handleFileSelectForCrop = (e) => {
    if (e.target.files && e.target.files[0]) {
      setCropperSource({ type: 'file', file: e.target.files[0] })
    }
    e.target.value = ''
  }

  const handleTapExisting = (idx) => {
    setCropperSource({ type: 'url', url: existingUrls[idx], idx })
  }

  const handleCropDone = (croppedFile) => {
    if (cropperSource?.type === 'url') {
      const previewUrl = URL.createObjectURL(croppedFile)
      onPendingReplace(cropperSource.idx, croppedFile, previewUrl)
    } else {
      onAddCropped(croppedFile)
    }
    setCropperSource(null)
  }

  const handleDragStart = (idx) => {
    dragIdx.current = idx
  }

  const handleDrop = (idx) => {
    if (dragIdx.current === null || dragIdx.current === idx) return
    const reordered = [...(existingUrls || [])]
    const [moved] = reordered.splice(dragIdx.current, 1)
    reordered.splice(idx, 0, moved)
    onReorder && onReorder(reordered)
    dragIdx.current = null
  }

  const getDisplayUrl = (idx) => {
    const pending = pendingReplacements?.find((p) => p.idx === idx)
    return pending ? pending.previewUrl : existingUrls[idx]
  }

  return (
    <div className="space-y-3">
      {(existingUrls?.length > 0 || imagePreviews.length > 0) && (
        <div className="flex gap-2 flex-wrap">
          {existingUrls?.map((_, idx) => (
            <div
              key={`ex-${idx}`}
              className="relative group cursor-grab"
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(idx)}
            >
              <img
                src={getDisplayUrl(idx)}
                alt=""
                onClick={() => handleTapExisting(idx)}
                className="w-20 h-20 object-cover rounded-lg border-2 border-gray-200 cursor-pointer hover:border-blue-400 transition-colors"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 rounded-lg transition-colors pointer-events-none flex items-center justify-center">
                <span className="text-white text-xs font-semibold opacity-0 group-hover:opacity-100 drop-shadow">
                  ✂️
                </span>
              </div>
              <button
                type="button"
                onClick={() => onRemoveExisting(existingUrls[idx])}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 z-10"
              >
                ✕
              </button>
            </div>
          ))}
          {imagePreviews.map((preview, idx) => (
            <div key={`new-${idx}`} className="relative">
              <img
                src={preview}
                alt=""
                className="w-20 h-20 object-cover rounded-lg border-2 border-blue-200"
              />
              <button
                type="button"
                onClick={() => onRemoveNew(idx)}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {existingUrls?.length > 0 && (
        <p className="text-xs text-gray-400">
          💡 기존 사진을 탭하면 자를 수 있어요 · 드래그로 순서 변경
        </p>
      )}

      <div className="flex gap-2">
        <label className="flex-1 cursor-pointer">
          <div className="border-2 border-dashed border-gray-300 rounded-lg px-3 py-3 text-center hover:border-gray-400 transition-colors">
            <p className="text-xs font-medium text-gray-600">📁 그냥 업로드</p>
            <p className="text-xs text-gray-400 mt-0.5">자르기 없이</p>
          </div>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </label>
        <label className="flex-1 cursor-pointer">
          <div className="border-2 border-dashed border-blue-300 rounded-lg px-3 py-3 text-center hover:border-blue-400 transition-colors">
            <p className="text-xs font-medium text-blue-600">✂️ 자르기 업로드</p>
            <p className="text-xs text-gray-400 mt-0.5">비율 선택 후 자르기</p>
          </div>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelectForCrop}
          />
        </label>
      </div>

      {cropperSource && (
        <ImageCropper
          file={cropperSource.type === 'file' ? cropperSource.file : null}
          imageUrl={cropperSource.type === 'url' ? cropperSource.url : null}
          onCrop={handleCropDone}
          onCancel={() => setCropperSource(null)}
          aspectRatios={['1:1', '4:5']}
        />
      )}
    </div>
  )
}

// ─── MembersTab ───────────────────────────────────────────────────────────────

function MembersTab() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)

   const [form, setForm] = useState({
  name: '',
  map_label: '',
  description: '',
  address: '',
  latitude: '',
  longitude: '',
  discount_info: '',
  discount_terms: '',
  one_line_review: '',
  rating: '',
  review: '',
  reviewer_name: '',
  category: '맛집',
  price_range: '',
  is_sponsored: false,
  show_rating: true,
  stamp_card_enabled: false,
})

  const [passwordStrength, setPasswordStrength] = useState(0)
  const [showPassword, setShowPassword] = useState(false)
  const [createdCredentials, setCreatedCredentials] = useState(null)

  const fetchMembers = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('fetchMembers error:', error)
    }

    setMembers(data || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchMembers()
  }, [])

  const checkPasswordStrength = (pwd) => {
    let s = 0
    if (pwd.length >= 8) s++
    if (pwd.match(/[a-z]/) && pwd.match(/[A-Z]/)) s++
    if (pwd.match(/[0-9]/)) s++
    if (pwd.match(/[^a-zA-Z0-9]/)) s++
    setPasswordStrength(s)
  }

  const generateRandomPassword = () => {
    const charset =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%'
    let password = ''
    for (let i = 0; i < 12; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length))
    }
    setForm((prev) => ({ ...prev, password, confirmPassword: password }))
    checkPasswordStrength(password)
  }

  const generateSecret = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    return Array.from(crypto.getRandomValues(new Uint8Array(20)))
      .map((b) => chars[b % 32])
      .join('')
  }

  const validateForm = () => {
    if (
      !form.email ||
      !form.password ||
      !form.first_name ||
      !form.last_name ||
      !form.student_number ||
      !form.major
    ) {
      alert('모든 필수 항목을 입력해주세요.')
      return false
    }
    if (form.password !== form.confirmPassword) {
      alert('비밀번호가 일치하지 않습니다.')
      return false
    }
    if (form.password.length < 8) {
      alert('비밀번호는 최소 8자 이상이어야 합니다.')
      return false
    }
    if (!form.email.includes('@')) {
      alert('유효한 이메일을 입력해주세요.')
      return false
    }
    return true
  }

  const handleAdd = async () => {
    if (!validateForm()) return

    try {
      const { data: authData, error: authError } =
        await supabase.auth.signUp({
          email: form.email,
          password: form.password,
        })

      if (authError) {
        alert('계정 생성 실패: ' + authError.message)
        return
      }

      const userId = authData.user?.id
      if (!userId) {
        alert('유저 ID를 가져오지 못했습니다.')
        return
      }

      const { error: memberError } = await supabase.from('members').insert({
        user_id: userId,
        first_name: form.first_name,
        last_name: form.last_name,
        student_number: form.student_number,
        major: form.major,
        is_member: form.is_member,
        membership_valid_until: form.membership_valid_until || null,
        totp_secret: generateSecret(),
      })

      if (memberError) {
        alert('멤버 추가 실패: ' + memberError.message)
        return
      }

      setCreatedCredentials({
        email: form.email,
        password: form.password,
        name: `${form.first_name} ${form.last_name}`,
      })

      setShowForm(false)
      setForm({
        email: '',
        password: '',
        confirmPassword: '',
        first_name: '',
        last_name: '',
        student_number: '',
        major: '',
        year_of_birth: '',
        gender: '',
        country_of_origin: '',
        University: '',
        education_level: '',
        year_number: '',
        is_member: true,
        membership_valid_until: '',
      })
      setPasswordStrength(0)
      fetchMembers()

      setTimeout(() => setCreatedCredentials(null), 10000)
    } catch (error) {
      alert('오류 발생: ' + error.message)
    }
  }

  const handleEdit = async () => {
    const { error } = await supabase
      .from('members')
      .update({
        first_name: form.first_name,
        last_name: form.last_name,
        student_number: form.student_number,
        major: form.major,
        year_of_birth: form.year_of_birth || null,
        gender: form.gender || null,
        country_of_origin: form.country_of_origin || null,
        University: form.University || null,
        education_level: form.education_level || null,
        year_number: form.year_number || null,
        is_member: form.is_member,
        membership_valid_until: form.membership_valid_until || null,
      })
      .eq('id', editTarget.id)

    if (error) {
      alert('수정 실패: ' + error.message)
      return
    }
    alert('수정 완료')
    setEditTarget(null)
    setShowForm(false)
    fetchMembers()
  }

  const handleDelete = async (id) => {
    if (!confirm('정말 삭제할까요?')) return
    await supabase.from('members').delete().eq('id', id)
    fetchMembers()
  }

  const toggleMembership = async (member) => {
    const nextIsMember = !member.is_member
    const nextValidUntil =
      nextIsMember && !member.membership_valid_until
        ? new Date(
            new Date().getFullYear(),
            11,
            31
          )
            .toISOString()
            .slice(0, 10)
        : member.membership_valid_until

    const { error } = await supabase
      .from('members')
      .update({
        is_member: nextIsMember,
        membership_valid_until: nextValidUntil || null,
      })
      .eq('id', member.id)

    if (error) {
      alert('멤버십 상태 변경 실패: ' + error.message)
      return
    }

    fetchMembers()
  }

  const openEdit = (member) => {
    setEditTarget(member)
    setForm({
      email: '',
      password: '',
      confirmPassword: '',
      first_name: member.first_name || '',
      last_name: member.last_name || '',
      student_number: member.student_number || '',
      major: member.major || '',
      year_of_birth: member.year_of_birth || '',
      gender: member.gender || '',
      country_of_origin: member.country_of_origin || '',
      University: member.University || '',
      education_level: member.education_level || '',
      year_number: member.year_number || '',
      is_member: member.is_member,
      membership_valid_until: member.membership_valid_until
        ? String(member.membership_valid_until).slice(0, 10)
        : '',
    })
    setShowForm(true)
  }

  const openAdd = () => {
    setEditTarget(null)
    setForm({
      email: '',
      password: '',
      confirmPassword: '',
      first_name: '',
      last_name: '',
      student_number: '',
      major: '',
      year_of_birth: '',
      gender: '',
      country_of_origin: '',
      University: '',
      education_level: '',
      year_number: '',
      is_member: true,
      membership_valid_until: '',
    })
    setPasswordStrength(0)
    setShowForm(true)
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
    alert('복사되었습니다!')
  }

  const strengthColor = () =>
    [
      'bg-red-200',
      'bg-orange-200',
      'bg-yellow-200',
      'bg-lime-200',
      'bg-green-200',
    ][passwordStrength] || 'bg-gray-200'

  const strengthText = () =>
    ['매우 약함', '약함', '보통', '강함', '매우 강함'][passwordStrength] || ''

  const sorted = koreanSort(members, 'last_name')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">
          멤버 목록 ({members.length}명)
        </h2>
        {!showForm && (
          <button
            onClick={openAdd}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-1 whitespace-nowrap"
          >
            <Plus size={16} weight="bold" />
            멤버 추가
          </button>
        )}
      </div>

      {createdCredentials && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-green-900">✓ 계정 생성 완료!</h3>
              <p className="text-sm text-green-700 mt-1">
                아래 정보를 멤버에게 전달해주세요.
              </p>
            </div>
            <button
              onClick={() => setCreatedCredentials(null)}
              className="text-green-600 text-xl"
            >
              ✕
            </button>
          </div>

          <div className="bg-white rounded-lg p-4 space-y-3 border border-green-100">
            <div>
              <p className="text-xs text-gray-500 mb-1">이름</p>
              <p className="text-sm font-medium">{createdCredentials.name}</p>
            </div>

            <div>
              <p className="text-xs text-gray-500 mb-1">이메일</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-50 px-3 py-2 rounded text-sm font-mono">
                  {createdCredentials.email}
                </code>
                <button
                  onClick={() => copyToClipboard(createdCredentials.email)}
                  className="text-blue-600 text-sm px-3 py-2 bg-blue-50 rounded whitespace-nowrap"
                >
                  복사
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs text-gray-500 mb-1">비밀번호</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-50 px-3 py-2 rounded text-sm font-mono">
                  {createdCredentials.password}
                </code>
                <button
                  onClick={() => copyToClipboard(createdCredentials.password)}
                  className="text-blue-600 text-sm px-3 py-2 bg-blue-50 rounded whitespace-nowrap"
                >
                  복사
                </button>
              </div>
            </div>

            <p className="text-xs text-gray-500 bg-yellow-50 p-2 rounded">
              ℹ️ 이 정보는 10초 후 자동으로 사라집니다.
            </p>
          </div>
        </div>
      )}

      {/* 새 멤버 추가 폼 */}
      {showForm && !editTarget && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <h3 className="font-medium text-gray-900">새 멤버 추가</h3>

          <div className="bg-blue-50 rounded-lg p-4 space-y-3 border border-blue-200">
            <p className="font-medium text-blue-900 text-sm">🔐 로그인 정보</p>

            <div>
              <label className="text-sm text-gray-700 block mb-1">이메일</label>
              <input
                placeholder="이메일"
                value={form.email}
                onChange={(e) =>
                  setForm({
                    ...form,
                    email: e.target.value,
                  })
                }
                type="email"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-gray-700">비밀번호</label>
                <button
                  type="button"
                  onClick={generateRandomPassword}
                  className="text-xs text-blue-600 bg-white px-2 py-1 rounded border border-blue-200"
                >
                  🎲 자동 생성
                </button>
              </div>
              <div className="relative">
                <input
                  placeholder="최소 8자 이상"
                  value={form.password}
                  onChange={(e) => {
                    setForm({ ...form, password: e.target.value })
                    checkPasswordStrength(e.target.value)
                  }}
                  type={showPassword ? 'text' : 'password'}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-gray-500"
                >
                  {showPassword ? <Eye size={16} /> : <EyeSlash size={16} />}
                </button>
              </div>
              {form.password && (
                <div className="mt-2 flex items-center gap-2">
                  <div className={`h-2 flex-1 rounded-full ${strengthColor()}`} />
                  <span className="text-xs text-gray-600 whitespace-nowrap">
                    {strengthText()}
                  </span>
                </div>
              )}
            </div>

            <div>
              <label className="text-sm text-gray-700 block mb-1">
                비밀번호 확인
              </label>
              <input
                placeholder="비밀번호 재입력"
                value={form.confirmPassword}
                onChange={(e) =>
                  setForm({ ...form, confirmPassword: e.target.value })
                }
                type={showPassword ? 'text' : 'password'}
                className={`w-full border rounded-lg px-3 py-2 text-sm ${
                  form.confirmPassword && form.password !== form.confirmPassword
                    ? 'border-red-300 bg-red-50'
                    : 'border-gray-200'
                }`}
              />
              {form.confirmPassword &&
                form.password !== form.confirmPassword && (
                  <p className="text-xs text-red-600 mt-1">
                    비밀번호가 일치하지 않습니다
                  </p>
                )}
            </div>
          </div>

          <div className="space-y-3">
            <p className="font-medium text-gray-900 text-sm">👤 멤버 정보</p>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm text-gray-700 block mb-1">
                  First Name *
                </label>
                <input
                  placeholder="John"
                  value={form.first_name}
                  onChange={(e) =>
                    setForm({ ...form, first_name: e.target.value })
                  }
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm text-gray-700 block mb-1">
                  Last Name *
                </label>
                <input
                  placeholder="Doe"
                  value={form.last_name}
                  onChange={(e) =>
                    setForm({ ...form, last_name: e.target.value })
                  }
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm text-gray-700 block mb-1">
                  학번 *
                </label>
                <input
                  placeholder="2024001"
                  value={form.student_number}
                  onChange={(e) =>
                    setForm({ ...form, student_number: e.target.value })
                  }
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm text-gray-700 block mb-1">
                  전공 *
                </label>
                <input
                  placeholder="컴퓨터과학"
                  value={form.major}
                  onChange={(e) =>
                    setForm({ ...form, major: e.target.value })
                  }
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_member"
                checked={form.is_member}
                onChange={(e) =>
                  setForm({ ...form, is_member: e.target.checked })
                }
              />
              <label htmlFor="is_member" className="text-sm text-gray-700">
                멤버십 활성화
              </label>
            </div>

            <div>
              <label className="text-sm text-gray-500 block mb-1">
                유효기간
              </label>
              <input
                type="date"
                value={form.membership_valid_until}
                onChange={(e) =>
                  setForm({
                    ...form,
                    membership_valid_until: e.target.value,
                  })
                }
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleAdd}
              className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 font-medium"
            >
              멤버 추가
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="flex-1 bg-gray-100 text-gray-700 rounded-lg py-2 text-sm"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <LoadingIndicator />
      ) : members.length === 0 ? (
        <p className="text-gray-500 text-sm">멤버가 없어요.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((member) => (
            <div key={member.id}>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm">
                      {member.first_name} {member.last_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {member.student_number} · {member.major}
                    </p>
                    <p className="text-xs text-gray-400">
                      유효기간:{' '}
                      {member.membership_valid_until || '없음'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => toggleMembership(member)}
                      className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap border ${
                        member.is_member
                          ? 'bg-green-50 text-green-700 border-green-200'
                          : 'bg-gray-50 text-gray-500 border-gray-200'
                      }`}
                    >
                      {member.is_member
                        ? '유효 (탭해서 비활성)'
                        : '비활성 (탭해서 활성)'}
                    </button>
                    <button
                      onClick={() => openEdit(member)}
                      className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDelete(member.id)}
                      className="text-xs text-red-500 hover:underline whitespace-nowrap"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>

              {showForm && editTarget && editTarget.id === member.id && (
                <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 mt-2">
                  <h3 className="font-medium text-gray-900">멤버 수정</h3>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        First Name *
                      </label>
                      <input
                        value={form.first_name}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            first_name: e.target.value,
                          })
                        }
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        Last Name *
                      </label>
                      <input
                        value={form.last_name}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            last_name: e.target.value,
                          })
                        }
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        학번 *
                      </label>
                      <input
                        value={form.student_number}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            student_number: e.target.value,
                          })
                        }
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        전공 *
                      </label>
                      <input
                        value={form.major}
                        onChange={(e) =>
                          setForm({ ...form, major: e.target.value })
                        }
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        Birth year
                      </label>
                      <input
                        value={form.year_of_birth}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            year_of_birth: e.target.value,
                          })
                        }
                        placeholder="2004"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        Gender
                      </label>
                      <input
                        value={form.gender}
                        onChange={(e) =>
                          setForm({ ...form, gender: e.target.value })
                        }
                        placeholder="male / female / ..."
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-gray-700 block mb-1">
                      Country of origin
                    </label>
                    <input
                      value={form.country_of_origin}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          country_of_origin: e.target.value,
                        })
                      }
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        University
                      </label>
                      <input
                        value={form.University}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            University: e.target.value,
                          })
                        }
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        Programme level
                      </label>
                      <input
                        value={form.education_level}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            education_level: e.target.value,
                          })
                        }
                        placeholder="bachelor / master / alumni"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-gray-700 block mb-1">
                      Year number
                    </label>
                    <input
                      value={form.year_number}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          year_number: e.target.value,
                        })
                      }
                      placeholder="1, 2, 3..."
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`ism_${member.id}`}
                      checked={form.is_member}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          is_member: e.target.checked,
                        })
                      }
                    />
                    <label
                      htmlFor={`ism_${member.id}`}
                      className="text-sm text-gray-700"
                    >
                      멤버십 활성화
                    </label>
                  </div>

                  <div>
                    <label className="text-sm text-gray-500 block mb-1">
                      유효기간
                    </label>
                    <input
                      type="date"
                      value={form.membership_valid_until}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          membership_valid_until: e.target.value,
                        })
                      }
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleEdit}
                      className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 font-medium"
                    >
                      수정 완료
                    </button>
                    <button
                      onClick={() => {
                        setShowForm(false)
                        setEditTarget(null)
                      }}
                      className="flex-1 bg-gray-100 text-gray-700 rounded-lg py-2 text-sm"
                    >
                      취소
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── EventsTab ────────────────────────────────────────────────────────────────

function EventForm({
  form,
  setForm,
  richEditorKey,
  editTarget,
  uploading,
  imagePreviews,
  pendingReplacements,
  handleAddFile,
  handleAddCropped,
  handleRemoveNew,
  handleRemoveExisting,
  handlePendingReplace,
  handleReorderImages,
  handleSave,
  resetForm,
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3 mt-2">
      <h3 className="font-medium text-gray-900">
        {editTarget ? '이벤트 수정' : '새 이벤트'}
      </h3>
      <input
        placeholder="이벤트 제목"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
      />
      <div>
        <label className="text-sm text-gray-500 block mb-1">내용</label>
        <RichEditor
          key={richEditorKey}
          value={form.description}
          onChange={(v) => setForm((f) => ({ ...f, description: v }))}
          placeholder="내용을 입력하세요"
          rows={3}
        />
      </div>
      <div>
        <label className="text-sm text-gray-500 block mb-1">장소</label>
        <RichEditor
          key={richEditorKey + 50}
          value={form.location}
          onChange={(v) => setForm((f) => ({ ...f, location: v }))}
          placeholder="장소를 입력하세요"
          rows={2}
        />
      </div>
      <div>
        <label className="text-sm text-gray-500 block mb-1">장소 description</label>
        <textarea
          value={form.location_description}
          onChange={(e) =>
            setForm((f) => ({ ...f, location_description: e.target.value }))
          }
          placeholder="장소 description을 입력하세요"
          rows={2}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-2">
        <div>
          <label className="text-sm text-gray-500 block mb-1">날짜</label>
          <div className="space-y-2">
            {(form.eventDates || ['']).map((date, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  type="date"
                  value={date}
                  onChange={(e) =>
                    setForm((f) => {
                      const next = [...(f.eventDates || [''])]
                      next[idx] = e.target.value
                      return { ...f, eventDates: next, eventDate: next[0] || '' }
                    })
                  }
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
                {(form.eventDates || []).length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => {
                        const next = (f.eventDates || ['']).filter((_, i) => i !== idx)
                        return { ...f, eventDates: next.length ? next : [''], eventDate: next[0] || '' }
                      })
                    }
                    className="px-3 rounded-lg bg-gray-100 text-gray-500 text-sm"
                  >
                    삭제
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setForm((f) => ({ ...f, eventDates: [...(f.eventDates || ['']), ''] }))
            }
            className="mt-2 text-xs text-orange-500 font-semibold"
          >
            + 날짜 추가
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="text-sm text-gray-500 block mb-1">
            시작 시간 (HH:MM)
          </label>
          <TimeInput
            value={form.eventTime}
            onChange={(v) => setForm((f) => ({ ...f, eventTime: v }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm text-gray-500 block mb-1">
            종료 시간 (HH:MM)
          </label>
          <TimeInput
            value={form.eventEndTime}
            onChange={(v) => setForm((f) => ({ ...f, eventEndTime: v }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        </div>
        {(form.eventDates || []).filter(Boolean).length > 1 && (
          <div>
            <label className="text-sm text-gray-500 block mb-1">
              캘린더 표시
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'separate', label: '각 날짜 따로' },
                { value: 'range', label: '날짜 연결 강조' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, calendarHighlightMode: option.value }))}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                    form.calendarHighlightMode === option.value
                      ? 'border-orange-400 bg-orange-50 text-orange-600'
                      : 'border-gray-200 bg-white text-gray-500'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <input
        placeholder="인스타그램 URL (선택)"
        value={form.instagram_url}
        onChange={(e) =>
          setForm((f) => ({ ...f, instagram_url: e.target.value }))
        }
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
      />
      <input
        placeholder="Google Form 참가 링크 (선택)"
        value={form.participation_url}
        onChange={(e) =>
          setForm((f) => ({ ...f, participation_url: e.target.value }))
        }
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
      />
      <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
        <span className="text-sm text-gray-600">참가 마감</span>
        <button
          type="button"
          onClick={() =>
            setForm((f) => ({
              ...f,
              is_registration_closed: !f.is_registration_closed,
            }))
          }
          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${
            form.is_registration_closed
              ? 'bg-gray-900 text-white border-gray-900'
              : 'bg-white text-gray-500 border-gray-200'
          }`}
        >
          {form.is_registration_closed ? '마감' : '접수중'}
        </button>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
        <span className="text-sm text-gray-600">참여하기 버튼 표시</span>
        <button
          type="button"
          onClick={() =>
            setForm((f) => ({
              ...f,
              show_participation_button: !f.show_participation_button,
            }))
          }
          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${
            form.show_participation_button
              ? 'bg-orange-500 text-white border-orange-500'
              : 'bg-white text-gray-500 border-gray-200'
          }`}
        >
          {form.show_participation_button ? '표시' : '숨김'}
        </button>
      </div>
      <div>
        <label className="text-sm text-gray-500 block mb-1">사진</label>
        <div className="mb-3 flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <span className="text-sm text-gray-600">신청 없이 참여</span>
          <button
            type="button"
            onClick={() =>
              setForm((f) => ({
                ...f,
                participation_without_signup: !f.participation_without_signup,
              }))
            }
            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${
              form.participation_without_signup
                ? 'bg-orange-500 text-white border-orange-500'
                : 'bg-white text-gray-500 border-gray-200'
            }`}
          >
            {form.participation_without_signup ? '표시' : '해제'}
          </button>
        </div>
        <ImageUploadPanel
          imagePreviews={imagePreviews}
          existingUrls={editTarget?.image_urls || []}
          pendingReplacements={pendingReplacements}
          onAddFile={handleAddFile}
          onAddCropped={handleAddCropped}
          onRemoveNew={handleRemoveNew}
          onRemoveExisting={handleRemoveExisting}
          onPendingReplace={handlePendingReplace}
          onReorder={handleReorderImages}
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={uploading}
          className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {uploading ? '업로드 중...' : editTarget ? '수정 완료' : '추가'}
        </button>
        <button
          onClick={resetForm}
          className="flex-1 bg-gray-100 text-gray-700 rounded-lg py-2 text-sm"
        >
          취소
        </button>
      </div>
    </div>
  )
}

function EventsTab() {
  const [events, setEvents] = useState([])
  const [archivedEvents, setArchivedEvents] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [showArchivedList, setShowArchivedList] = useState(false)

  const [form, setForm] = useState({
    title: '',
    description: '',
    eventDate: '',
    eventDates: [''],
    eventTime: '',
    eventEndTime: '',
    calendarHighlightMode: 'separate',
    location: '',
    location_description: '',
    instagram_url: '',
    participation_url: '',
    is_registration_closed: false,
    participation_without_signup: false,
    show_participation_button: true,
  })

  const [imageFiles, setImageFiles] = useState([])
  const [imagePreviews, setImagePreviews] = useState([])
  const [pendingReplacements, setPendingReplacements] = useState([])
  const [uploading, setUploading] = useState(false)
  const [richEditorKey, setRichEditorKey] = useState(0)

  const fetchEvents = async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('is_archived', false)
      .order('event_date', { ascending: false })
    setEvents(data || [])
  }

  const fetchArchivedEvents = async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('is_archived', true)
      .order('event_date', { ascending: false })
    setArchivedEvents(data || [])
  }

  useEffect(() => {
    fetchEvents()
    fetchArchivedEvents()
  }, [])

  const handleAddFile = (file) => {
    setImageFiles((prev) => [...prev, file])
    setImagePreviews((prev) => [...prev, URL.createObjectURL(file)])
  }

  const handleAddCropped = (croppedFile) => {
    setImageFiles((prev) => [...prev, croppedFile])
    setImagePreviews((prev) => [...prev, URL.createObjectURL(croppedFile)])
  }

  const handleRemoveNew = (idx) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== idx))
    setImagePreviews((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleRemoveExisting = async (url) => {
    if (!confirm('이 사진을 삭제할까요?')) return
    const fileName = url.split('/').pop()
    await supabase.storage.from('event-images').remove([fileName])
    const idx = (editTarget?.image_urls || []).indexOf(url)
    setPendingReplacements((prev) => prev.filter((p) => p.idx !== idx))
    setEditTarget((prev) => ({
      ...prev,
      image_urls: (prev.image_urls || []).filter((u) => u !== url),
    }))
  }

  const handlePendingReplace = (idx, file, previewUrl) => {
    setPendingReplacements((prev) => {
      const next = prev.filter((p) => p.idx !== idx)
      return [...next, { idx, file, previewUrl }]
    })
  }

  const handleReorderImages = (reorderedUrls) => {
    if (editTarget) {
      setEditTarget((prev) => ({ ...prev, image_urls: reorderedUrls }))
    }
  }

  const resetForm = () => {
    setShowForm(false)
    setEditTarget(null)
    setForm({
      title: '',
      description: '',
      eventDate: '',
      eventDates: [''],
      eventTime: '',
      eventEndTime: '',
      calendarHighlightMode: 'separate',
      location: '',
      location_description: '',
      instagram_url: '',
      participation_url: '',
      is_registration_closed: false,
      show_participation_button: true,
    })
    setImageFiles([])
    setImagePreviews([])
    setPendingReplacements([])
    setRichEditorKey((k) => k + 1)
  }

  const handleSave = async () => {
    if (!form.title) {
      alert('제목을 입력해주세요.')
      return
    }
    setUploading(true)
    const eventDates = Array.from(new Set((form.eventDates || [form.eventDate]).filter(Boolean))).sort()
    const primaryDate = eventDates[0] || form.eventDate
    const event_date = combineDateTime(primaryDate, form.eventTime)
    const event_end_date = combineDateTime(primaryDate, form.eventEndTime, '')
    const event_dates = eventDates
      .map((date) => combineDateTime(date, form.eventTime))
      .filter(Boolean)
    let image_urls = [...(editTarget?.image_urls || [])]

    for (const { idx, file } of pendingReplacements) {
      const oldFileName = image_urls[idx]?.split('/').pop()
      if (oldFileName) {
        await supabase.storage.from('event-images').remove([oldFileName])
      }
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}.${fileExt}`
      const { error } = await supabase.storage
        .from('event-images')
        .upload(fileName, file)
      if (error) {
        alert('업로드 실패: ' + error.message)
        setUploading(false)
        return
      }
      const { data: urlData } = supabase.storage
        .from('event-images')
        .getPublicUrl(fileName)
      image_urls[idx] = urlData.publicUrl
    }

    for (const file of imageFiles) {
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}.${fileExt}`
      const { error: uploadError } = await supabase.storage
        .from('event-images')
        .upload(fileName, file)
      if (uploadError) {
        alert('업로드 실패: ' + uploadError.message)
        setUploading(false)
        return
      }
      const { data: urlData } = supabase.storage
        .from('event-images')
        .getPublicUrl(fileName)
      image_urls = [...image_urls, urlData.publicUrl]
    }

    const payload = {
      title: form.title,
      description: form.description,
      event_date: event_date || null,
      event_end_date: event_end_date || null,
      event_dates,
      calendar_highlight_mode: form.calendarHighlightMode || 'separate',
      location: form.location,
      location_description: form.location_description,
      instagram_url: form.instagram_url,
      participation_url: form.participation_url,
      is_registration_closed: form.is_registration_closed,
      participation_without_signup: form.participation_without_signup,
      show_participation_button: form.show_participation_button,
      image_urls,
    }

    let saveError = null
    if (editTarget) {
      const { error } = await supabase
        .from('events')
        .update(payload)
        .eq('id', editTarget.id)
      saveError = error
    } else {
      const { error } = await supabase.from('events').insert(payload)
      saveError = error
    }

    if (saveError) {
      alert('저장 실패: ' + saveError.message)
      setUploading(false)
      return
    }

    setUploading(false)
    resetForm()
    fetchEvents()
  }

  const handleDelete = async (id) => {
    if (!confirm('삭제할까요?')) return
    await supabase.from('events').delete().eq('id', id)
    fetchEvents()
    fetchArchivedEvents()
  }

  const handleArchive = async (id) => {
    await supabase.from('events').update({ is_archived: true }).eq('id', id)
    fetchEvents()
    fetchArchivedEvents()
  }

  const handleRestore = async (id) => {
    await supabase.from('events').update({ is_archived: false }).eq('id', id)
    fetchEvents()
    fetchArchivedEvents()
  }

  const openEdit = (event) => {
    setEditTarget(event)
    setForm({
      title: event.title,
      description: event.description || '',
      eventDate: toLocalDateString(event.event_date),
      eventDates: getEventDateInputs(event),
      eventTime: toLocalTimeString(event.event_date),
      eventEndTime: toEventEndTimeInput(event),
      calendarHighlightMode: event.calendar_highlight_mode || 'separate',
      location: event.location || '',
      location_description: event.location_description || '',
      instagram_url: event.instagram_url || '',
      participation_url: event.participation_url || '',
      is_registration_closed: !!event.is_registration_closed,
      participation_without_signup: !!event.participation_without_signup,
      show_participation_button: event.show_participation_button !== false,
    })
    setImageFiles([])
    setImagePreviews([])
    setPendingReplacements([])
    setRichEditorKey((k) => k + 1)
    setShowForm(true)
  }

  const openAdd = () => {
    setEditTarget(null)
    setForm({
      title: '',
      description: '',
      eventDate: '',
      eventDates: [''],
      eventTime: '',
      eventEndTime: '',
      calendarHighlightMode: 'separate',
      location: '',
      location_description: '',
      instagram_url: '',
      participation_url: '',
      is_registration_closed: false,
      participation_without_signup: false,
      show_participation_button: true,
    })
    setImageFiles([])
    setImagePreviews([])
    setPendingReplacements([])
    setRichEditorKey((k) => k + 1)
    setShowForm(true)
  }

  const getPrimaryEventDate = (event) => {
    const dates = Array.isArray(event?.event_dates) ? event.event_dates : []
    return dates[0] || event?.event_date
  }

  const groupByYearMonth = (arr) => {
    const grouped = {}
    arr.forEach((ev) => {
      const eventDate = getPrimaryEventDate(ev)
      const label = eventDate
        ? `${new Date(eventDate).getFullYear()}.${String(
            new Date(eventDate).getMonth() + 1,
          ).padStart(2, '0')}`
        : '날짜 미정'
      if (!grouped[label]) grouped[label] = []
      grouped[label].push(ev)
    })
    return grouped
  }

  const formProps = {
    form,
    setForm,
    richEditorKey,
    editTarget,
    uploading,
    imagePreviews,
    pendingReplacements,
    handleAddFile,
    handleAddCropped,
    handleRemoveNew,
    handleRemoveExisting,
    handlePendingReplace,
    handleReorderImages,
    handleSave,
    resetForm,
  }

  const renderCard = (event, isArchived = false) => (
    <div key={event.id}>
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 text-sm">
              {event.title}
            </p>
            {event.location && (
              <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                <MapPin size={12} weight="fill" />
                {event.location.replace(/<[^>]+>/g, '')}
              </p>
            )}
            {event.event_date && (
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date(event.event_date).toLocaleString('ko-KR', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                })}
              </p>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {isArchived ? (
              <>
                <button
                  onClick={() => handleRestore(event.id)}
                  className="text-xs text-green-600 hover:underline whitespace-nowrap"
                >
                  복원
                </button>
                <button
                  onClick={() => openEdit(event)}
                  className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                >
                  수정
                </button>
                <button
                  onClick={() => handleDelete(event.id)}
                  className="text-xs text-red-500 hover:underline whitespace-nowrap"
                >
                  삭제
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleArchive(event.id)}
                  className="text-xs text-green-600 hover:underline whitespace-nowrap"
                >
                  보관
                </button>
                <button
                  onClick={() => openEdit(event)}
                  className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                >
                  수정
                </button>
                <button
                  onClick={() => handleDelete(event.id)}
                  className="text-xs text-red-500 hover:underline whitespace-nowrap"
                >
                  삭제
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {showForm && editTarget && editTarget.id === event.id && (
        <EventForm {...formProps} />
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-semibold text-gray-900">이벤트 관리</h2>
        <div className="flex gap-2">
          {showArchivedList ? (
            <button
              onClick={() => setShowArchivedList(false)}
              className="bg-green-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-700 whitespace-nowrap"
            >
              ← 이벤트 목록
            </button>
          ) : (
            <button
              onClick={() => setShowArchivedList(true)}
              className="bg-green-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-700 whitespace-nowrap"
            >
              보관된 이벤트
            </button>
          )}
          {!showForm && !showArchivedList && (
            <button
              onClick={openAdd}
              className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-1 whitespace-nowrap"
            >
              <Plus size={16} weight="bold" />
              이벤트 추가
            </button>
          )}
        </div>
      </div>

      {showArchivedList ? (
        <div className="space-y-3">
          {archivedEvents.length === 0 ? (
            <p className="text-gray-500 text-sm">
              보관된 이벤트가 없어요.
            </p>
          ) : (
            Object.entries(groupByYearMonth(archivedEvents)).map(
              ([month, evs]) => (
                <div key={month} className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">
                    {month}
                  </p>
                  {evs.map((e) => renderCard(e, true))}
                </div>
              )
            )
          )}
        </div>
      ) : (
        <>
          {showForm && !editTarget && <EventForm {...formProps} />}
          {events.length === 0 ? (
            <p className="text-gray-500 text-sm">이벤트가 없어요.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(groupByYearMonth(events)).map(
                ([month, evs]) => (
                  <div key={month} className="space-y-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">
                      {month}
                    </p>
                    {evs.map((e) => renderCard(e, false))}
                  </div>
                )
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── RestaurantsTab ───────────────────────────────────────────────────────────

const SPOT_CATEGORIES = [
  '맛집',
  '카페',
  '마트',
  '스터디',
  '학교',
  '의료',
  '운동',
  '미용/뷰티',
  '여가',
  '쇼핑',
  '기타',
]

function RestaurantForm({
  form,
  setForm,
  richEditorKey,
  editTarget,
  uploading,
  imagePreviews,
  pendingReplacements,
  handleAddFile,
  handleAddCropped,
  handleRemoveNew,
  handleRemoveExisting,
  handlePendingReplace,
  handleReorderImages,
  handleSave,
  resetForm,
  setStampCardEditOpen,
  setStampCardMemberOpen,
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3 mt-2">
      <h3 className="font-medium text-gray-900">
        {editTarget ? '장소 수정' : '새 장소 추가'}
      </h3>
      <input
        placeholder="장소 이름"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
      />
      <input
        placeholder="지도 표시 이름"
        value={form.map_label}
        onChange={(e) =>
          setForm((f) => ({ ...f, map_label: e.target.value }))
        }
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
      />
      <select
        value={form.category}
        onChange={(e) =>
          setForm((f) => ({ ...f, category: e.target.value }))
        }
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
      >
        {SPOT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <textarea
        placeholder="설명"
        value={form.description}
        onChange={(e) =>
          setForm((f) => ({ ...f, description: e.target.value }))
        }
        rows={2}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
      />
      <input
        placeholder="주소"
        value={form.address}
        onChange={(e) =>
          setForm((f) => ({ ...f, address: e.target.value }))
        }
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-sm text-gray-500 block mb-1">위도</label>
          <input
            placeholder="위도"
            value={form.latitude}
            onChange={(e) =>
              setForm((f) => ({ ...f, latitude: e.target.value }))
            }
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm text-gray-500 block mb-1">경도</label>
          <input
            placeholder="경도"
            value={form.longitude}
            onChange={(e) =>
              setForm((f) => ({ ...f, longitude: e.target.value }))
            }
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div>
        <label className="text-sm text-gray-500 block mb-1">할인 정보</label>
        <RichEditor
          key={richEditorKey}
          value={form.discount_info}
          onChange={(v) =>
            setForm((f) => ({ ...f, discount_info: v }))
          }
          placeholder="할인 정보 (예: 10% 할인)"
          rows={2}
        />
      </div>
      <div>
        <label className="text-sm text-gray-500 block mb-1">할인 조건</label>
        <RichEditor
          key={richEditorKey + 100}
          value={form.discount_terms}
          onChange={(v) =>
            setForm((f) => ({ ...f, discount_terms: v }))
          }
          placeholder="할인 조건 (예: 주말 제외)"
          rows={2}
        />
      </div>
      {/* 별점 표시 토글 */}
<div className="flex items-center justify-between">
  <span className="text-sm text-gray-500">별점 표시</span>
  <button
    type="button"
    onClick={() =>
      setForm((f) => ({ ...f, show_rating: !f.show_rating }))
    }
    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${
      form.show_rating
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-gray-50 text-gray-500 border-gray-200'
    }`}
  >
    {form.show_rating ? '켜짐' : '꺼짐'}
  </button>
</div>

{/* 스탬프 카드 사용 여부 */}
<div className="flex items-center justify-between">
  <span className="text-sm text-gray-500">Google Maps 버튼 표시</span>
  <button
    type="button"
    onClick={() =>
      setForm((f) => ({
        ...f,
        show_google_maps_button: !f.show_google_maps_button,
      }))
    }
    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${
      form.show_google_maps_button
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-gray-50 text-gray-500 border-gray-200'
    }`}
  >
    {form.show_google_maps_button ? '켜짐' : '꺼짐'}
  </button>
</div>

<div>
  <label className="text-sm text-gray-500 block mb-1">
    SpotCard preview height
  </label>
  <div className="grid grid-cols-2 gap-2">
    {[
      { value: 'compact', label: 'Compact' },
      { value: 'full', label: 'Full' },
    ].map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() =>
          setForm((f) => ({ ...f, spot_card_height: option.value }))
        }
        className={
          'rounded-lg border px-3 py-2 text-sm font-medium transition-colors ' +
          (form.spot_card_height === option.value
            ? 'border-orange-500 bg-orange-50 text-orange-600'
            : 'border-gray-200 bg-white text-gray-500')
        }
      >
        {option.label}
      </button>
    ))}
  </div>
</div>

<div className="flex items-center justify-between mt-3">
  <span className="text-sm text-gray-500">스탬프 카드 사용</span>
  <button
    type="button"
    onClick={() => setForm(f => ({ ...f, stamp_card_enabled: !f.stamp_card_enabled }))}
    className={
      'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ' +
      (form.stamp_card_enabled
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-gray-50 text-gray-500 border-gray-200')
    }
  >
    {form.stamp_card_enabled ? '켜짐' : '꺼짐'}
  </button>
</div>

{/* (수정 모드에서만) 스탬프 카드 편집 / 멤버 스탬프 관리 */}
{editTarget && (
  <div className="flex gap-2 mt-3">
    <button
      type="button"
      onClick={() => setStampCardEditOpen(true)}
      className="flex-1 text-xs bg-orange-500 text-white px-3 py-2 rounded-lg"
    >
      스탬프 카드 편집
    </button>
    <button
      type="button"
      onClick={() => setStampCardMemberOpen(true)}
      className="flex-1 text-xs bg-gray-900 text-white px-3 py-2 rounded-lg"
    >
      멤버 스탬프 현황
    </button>
  </div>
)}

{/* 가격대 */}
<div>
  <label className="text-sm text-gray-500 block mb-1">가격대</label>
  <select
    value={form.price_range}
    onChange={(e) =>
      setForm((f) => ({ ...f, price_range: e.target.value }))
    }
    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
  >
    <option value="">가격대 선택</option>
    <option value="€">€ (저렴)</option>
    <option value="€€">€€ (보통)</option>
    <option value="€€€">€€€ (비쌈)</option>
    <option value="€€€€">€€€€ (고급)</option>
  </select>
</div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`sp_${editTarget ? 'edit' : 'add'}`}
          checked={form.is_sponsored}
          onChange={(e) =>
            setForm((f) => ({ ...f, is_sponsored: e.target.checked }))
          }
        />
        <label
          htmlFor={`sp_${editTarget ? 'edit' : 'add'}`}
          className="text-sm text-gray-700 flex items-center gap-1"
        >
          <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />
          제휴/스폰서
        </label>
      </div>

      {/* 한 줄 평가 */}
<div>
  <label className="text-sm text-gray-500 block mb-1">한 줄 평가</label>
  <RichEditor
    key={richEditorKey + 200}
    value={form.one_line_review}
    onChange={v =>
      setForm(f => ({ ...f, one_line_review: v }))
    }
    placeholder="한 줄 평가"
    rows={2}
  />
</div>

<div>
  <label className="text-sm text-gray-500 block mb-1">우슐랭 스타</label>
  <div className="mb-2 flex items-center justify-between">
    <span className="text-xs text-gray-400">SpotCard에 표시</span>
    <button
      type="button"
      onClick={() =>
        setForm((f) => ({
          ...f,
          show_usullang_stars: !f.show_usullang_stars,
        }))
      }
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${
        form.show_usullang_stars
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-gray-50 text-gray-500 border-gray-200'
      }`}
      aria-pressed={form.show_usullang_stars}
    >
      {form.show_usullang_stars ? '켜짐' : '꺼짐'}
    </button>
  </div>
  <div
    className={
      'flex items-center gap-1 ' +
      (form.show_usullang_stars ? '' : 'pointer-events-none opacity-40')
    }
    aria-label="우슐랭 스타 채움 수"
  >
    {[1, 2, 3].map((star) => {
      const highlighted = star <= form.usullang_star_count
      return (
        <button
          key={star}
          type="button"
          onClick={() =>
            setForm((f) => ({
              ...f,
              usullang_star_count: highlighted ? star - 1 : star,
            }))
          }
          className="rounded-md p-1 transition-colors hover:bg-orange-50 focus:outline-none focus:ring-2 focus:ring-orange-300"
          aria-pressed={highlighted}
          aria-label={`우슐랭 스타 ${star}개${highlighted ? ' 해제' : ' 표시'}`}
        >
          <StarFour
            size={26}
            weight={highlighted ? 'fill' : 'regular'}
            className={highlighted ? 'text-orange-500' : 'text-gray-300'}
          />
        </button>
      )
    })}
  </div>
  <p className="mt-1 text-xs text-gray-400">켜진 뒤, 채울 별 개수를 선택하세요.</p>
</div>

{/* 임원 리뷰 */}
<div className="mt-3 space-y-2">
  <p className="text-sm font-medium text-gray-900">임원 리뷰</p>

  <input
    placeholder="리뷰어 이름"
    value={form.reviewer_name}
    onChange={(e) =>
      setForm((f) => ({ ...f, reviewer_name: e.target.value }))
    }
    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
  />

  <textarea
    placeholder="리뷰"
    value={form.review}
    onChange={(e) =>
      setForm((f) => ({ ...f, review: e.target.value }))
    }
    rows={3}
    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
  />



</div>
      <div>
        <label className="text-sm text-gray-500 block mb-1">사진</label>
        <ImageUploadPanel
          imagePreviews={imagePreviews}
          existingUrls={editTarget?.image_urls || []}
          pendingReplacements={pendingReplacements}
          onAddFile={handleAddFile}
          onAddCropped={handleAddCropped}
          onRemoveNew={handleRemoveNew}
          onRemoveExisting={handleRemoveExisting}
          onPendingReplace={handlePendingReplace}
          onReorder={handleReorderImages}
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={uploading}
          className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {uploading ? '업로드 중...' : editTarget ? '수정 완료' : '추가'}
        </button>
        <button
          onClick={resetForm}
          className="flex-1 bg-gray-100 text-gray-700 rounded-lg py-2 text-sm"
        >
          취소
        </button>
      </div>
    </div>
  )
}

function RestaurantsTab() {
  const [restaurants, setRestaurants] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)

  const [form, setForm] = useState({
    name: '',
    map_label: '',
    description: '',
    address: '',
    latitude: '',
    longitude: '',
    discount_info: '',
    discount_terms: '',
    one_line_review: '',
    rating: '',
    review: '',
    reviewer_name: '',
    category: '맛집',
    price_range: '',
    is_sponsored: false,
    show_rating: true,
    show_google_maps_button: true,
    show_usullang_stars: false,
    usullang_star_count: 0,
    stamp_card_enabled: false,
    spot_card_height: 'compact',
  })

  const [imageFiles, setImageFiles] = useState([])
  const [imagePreviews, setImagePreviews] = useState([])
  const [pendingReplacements, setPendingReplacements] = useState([])
  const [uploading, setUploading] = useState(false)
  const [richEditorKey, setRichEditorKey] = useState(0)

  // Stamp card overlays
  const [stampCardEditOpen, setStampCardEditOpen] = useState(false)
  const [stampCardMemberOpen, setStampCardMemberOpen] = useState(false)
  const [stampCardTotalStamps, setStampCardTotalStamps] = useState(10)

  const fetchRestaurants = async () => {
    const { data } = await supabase
      .from('restaurants')
      .select('*')
      .order('created_at', { ascending: false })
    setRestaurants(data || [])
  }

  useEffect(() => {
    fetchRestaurants()
  }, [])

  // When editTarget changes, load stamp card config total_stamps (for Member panel)
  useEffect(() => {
  if (!editTarget) return

  fetchConfigBySpot(editTarget.id)
    .then((config) => {
      setStampCardTotalStamps(config?.total_stamps ?? 10)
    })
    .catch(() => setStampCardTotalStamps(10))
}, [editTarget])

  const handleAddFile = (file) => {
    setImageFiles((prev) => [...prev, file])
    setImagePreviews((prev) => [...prev, URL.createObjectURL(file)])
  }

  const handleAddCropped = (croppedFile) => {
    setImageFiles((prev) => [...prev, croppedFile])
    setImagePreviews((prev) => [...prev, URL.createObjectURL(croppedFile)])
  }

  const handleRemoveNew = (idx) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== idx))
    setImagePreviews((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleRemoveExisting = async (url) => {
    if (!confirm('이 사진을 삭제할까요?')) return
    const fileName = url.split('/').pop()
    await supabase.storage.from('place-images').remove([fileName])
    const idx = (editTarget?.image_urls || []).indexOf(url)
    setPendingReplacements((prev) => prev.filter((p) => p.idx !== idx))
    setEditTarget((prev) => ({
      ...prev,
      image_urls: (prev.image_urls || []).filter((u) => u !== url),
    }))
  }

  const handlePendingReplace = (idx, file, previewUrl) => {
    setPendingReplacements((prev) => {
      const next = prev.filter((p) => p.idx !== idx)
      return [...next, { idx, file, previewUrl }]
    })
  }

  const handleReorderImages = (reorderedUrls) => {
    if (editTarget) {
      setEditTarget((prev) => ({ ...prev, image_urls: reorderedUrls }))
    }
  }

  const resetForm = () => {
    setShowForm(false)
    setEditTarget(null)
    setForm({
      name: '',
      map_label: '',
      description: '',
      address: '',
      latitude: '',
      longitude: '',
      discount_info: '',
      discount_terms: '',
      one_line_review: '',
      rating: '',
      review: '',
      reviewer_name: '',
      category: '맛집',
      price_range: '',
      is_sponsored: false,
      show_rating: true,
      show_google_maps_button: true,
      show_usullang_stars: false,
      usullang_star_count: 0,
      stamp_card_enabled: false,
      spot_card_height: 'compact',
    })
    setImageFiles([])
    setImagePreviews([])
    setPendingReplacements([])
    setRichEditorKey((k) => k + 1)
  }

  const handleSave = async () => {
    if (!form.name) {
      alert('장소 이름을 입력해주세요.')
      return
    }
    setUploading(true)
    let image_urls = [...(editTarget?.image_urls || [])]

    // Apply pending replacements
    for (const { idx, file } of pendingReplacements) {
      const oldFileName = image_urls[idx]?.split('/').pop()
      if (oldFileName) {
        await supabase.storage.from('place-images').remove([oldFileName])
      }
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}.${fileExt}`
      const { error } = await supabase.storage
        .from('place-images')
        .upload(fileName, file)
      if (error) {
        alert('업로드 실패: ' + error.message)
        setUploading(false)
        return
      }
      const { data: urlData } = supabase.storage
        .from('place-images')
        .getPublicUrl(fileName)
      image_urls[idx] = urlData.publicUrl
    }

    // New images
    for (const file of imageFiles) {
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}.${fileExt}`
      const { error: uploadError } = await supabase.storage
        .from('place-images')
        .upload(fileName, file)
      if (uploadError) {
        alert('업로드 실패: ' + uploadError.message)
        setUploading(false)
        return
      }
      const { data: urlData } = supabase.storage
        .from('place-images')
        .getPublicUrl(fileName)
      image_urls = [...image_urls, urlData.publicUrl]
    }

    const payload = {
      name: form.name,
      map_label: form.map_label,
      description: form.description,
      address: form.address,
      latitude: form.latitude ? parseFloat(form.latitude) : null,
      longitude: form.longitude ? parseFloat(form.longitude) : null,
      discount_info: form.discount_info,
      discount_terms: form.discount_terms,
      one_line_review: form.one_line_review,
      rating: form.rating ? parseFloat(form.rating) : 0,
      review: form.review,
      reviewer_name: form.reviewer_name,
      category: form.category,
      price_range: form.price_range,
      is_sponsored: form.is_sponsored,
      show_rating: form.show_rating,
      show_google_maps_button: form.show_google_maps_button,
      show_usullang_stars: form.show_usullang_stars,
      usullang_star_count: form.usullang_star_count,
      stamp_card_enabled: form.stamp_card_enabled,
      spot_card_height:
        form.spot_card_height === 'full' ? 'full' : 'compact',
      image_urls,
    }

    let saveError = null
    if (editTarget) {
      const { error } = await supabase
        .from('restaurants')
        .update(payload)
        .eq('id', editTarget.id)
      saveError = error
    } else {
      const { error } = await supabase.from('restaurants').insert(payload)
      saveError = error
    }

    if (saveError) {
      alert('저장 실패: ' + saveError.message)
      setUploading(false)
      return
    }

    setUploading(false)
    resetForm()
    fetchRestaurants()
  }

  const handleDelete = async (id) => {
    if (!confirm('삭제할까요?')) return
    await supabase.from('restaurants').delete().eq('id', id)
    fetchRestaurants()
  }

  const openEdit = (r) => {
    setEditTarget(r)
    setForm({
      name: r.name,
      map_label: r.map_label || '',
      description: r.description || '',
      address: r.address || '',
      latitude: r.latitude || '',
      longitude: r.longitude || '',
      discount_info: r.discount_info || '',
      discount_terms: r.discount_terms || '',
      one_line_review: r.one_line_review || '',
      rating: r.rating || '',
      review: r.review || '',
      reviewer_name: r.reviewer_name || '',
      category: r.category || '맛집',
      price_range: r.price_range || '',
      is_sponsored: r.is_sponsored || false,
      show_rating: typeof r.show_rating === 'boolean' ? r.show_rating : true,
      show_google_maps_button:
        typeof r.show_google_maps_button === 'boolean'
          ? r.show_google_maps_button
          : true,
      show_usullang_stars: r.show_usullang_stars === true,
      usullang_star_count: Math.max(
        0,
        Math.min(3, Number(r.usullang_star_count) || 0),
      ),
      stamp_card_enabled: r.stamp_card_enabled || false,
      spot_card_height: r.spot_card_height === 'full' ? 'full' : 'compact',
    })

    setRichEditorKey((k) => k + 1)
    setImageFiles([])
    setImagePreviews([])
    setPendingReplacements([])
    setShowForm(true)
  }

  const openAdd = () => {
    setEditTarget(null)
    setForm({
      name: '',
      map_label: '',
      description: '',
      address: '',
      latitude: '',
      longitude: '',
      discount_info: '',
      discount_terms: '',
      one_line_review: '',
      rating: '',
      review: '',
      reviewer_name: '',
      category: '맛집',
      price_range: '',
      is_sponsored: false,
      show_rating: true,
      show_google_maps_button: true,
      show_usullang_stars: false,
      usullang_star_count: 0,
      stamp_card_enabled: false,
      spot_card_height: 'compact',
    })
    setRichEditorKey((k) => k + 1)
    setImageFiles([])
    setImagePreviews([])
    setPendingReplacements([])
    setShowForm(true)
  }

  const sorted = koreanSort(restaurants, 'name')

  const formProps = {
    form,
    setForm,
    richEditorKey,
    editTarget,
    uploading,
    imagePreviews,
    pendingReplacements,
    handleAddFile,
    handleAddCropped,
    handleRemoveNew,
    handleRemoveExisting,
    handlePendingReplace,
    handleReorderImages,
    handleSave,
    resetForm,
    setStampCardEditOpen,
    setStampCardMemberOpen,
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">장소 관리</h2>
        {!showForm && (
          <button
            onClick={openAdd}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-1 whitespace-nowrap"
          >
            <Plus size={16} weight="bold" />
            장소 추가
          </button>
        )}
      </div>

      {showForm && !editTarget && <RestaurantForm {...formProps} />}

      {restaurants.length === 0 ? (
        <p className="text-gray-500 text-sm">등록된 장소가 없어요.</p>
      ) : (
        (() => {
          const grouped = {}
          sorted.forEach((r) => {
            const key = r.category || '기타'
            if (!grouped[key]) grouped[key] = []
            grouped[key].push(r)
          })
          return Object.entries(grouped).map(([cat, places]) => (
            <div key={cat} className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">
                {cat} ({places.length})
              </p>
              {places.map((r) => (
                <div key={r.id}>
                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="font-medium text-gray-900 text-sm">
                            {r.name}
                          </p>
                          {r.is_sponsored && (
                            <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                              제휴
                            </span>
                          )}
                        </div>
                        {r.address && (
                          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                            <MapPin size={12} weight="fill" /> {r.address}
                          </p>
                        )}
                        {r.discount_info && (
                          <p className="text-xs text-orange-500 mt-0.5 flex items-center gap-1">
                            <Ticket
                              size={12}
                              weight="fill"
                              color="#FF5252"
                            />{' '}
                            {r.discount_info.replace(/<[^>]+>/g, '')}
                          </p>
                        )}
                        {r.rating > 0 && (
                          <p className="text-xs text-amber-500 mt-0.5">
                            ★ {r.rating}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => openEdit(r)}
                          className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => handleDelete(r.id)}
                          className="text-xs text-red-500 hover:underline whitespace-nowrap"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>
                  {showForm && editTarget && editTarget.id === r.id && (
                    <RestaurantForm {...formProps} />
                  )}
                </div>
              ))}
            </div>
          ))
        })()
      )}

      {/* Stamp card overlay panels */}
      {stampCardEditOpen && editTarget && (
        <StampCardEditPanel
          restaurantId={editTarget.id}
          spotName={editTarget.name}
          onClose={() => setStampCardEditOpen(false)}
        />
      )}

      {stampCardMemberOpen && editTarget && (
        <StampCardMemberPanel
          restaurantId={editTarget.id}
          spotName={editTarget.name}
          totalStamps={stampCardTotalStamps}
          onClose={() => setStampCardMemberOpen(false)}
        />
      )}
    </div>
  )
}
