import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'
import { logRedemption } from '../lib/redemption'
import QRScanner from '../components/QRScanner'
import ScanPageStampBox from '../features/stampCard/components/ScanPageStampBox'

const STATE = {
  SCANNING: 'scanning',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
}

export default function ScanPage() {
  const [state, setState] = useState(STATE.SCANNING)
  const [darkMode, setDarkMode] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark'),
  )
  const [storeName, setStoreName] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [member, setMember] = useState(null)
  const [scanTime, setScanTime] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()
  const handlingRef = useRef(false)
  const processedInitialScanRef = useRef(null)

  // Stamp card state
  const [scannedUserId, setScannedUserId] = useState(null)
  const [stampRestaurantId, setStampRestaurantId] = useState(null)
  const [stampCardEnabled, setStampCardEnabled] = useState(false)
  const [stampResult, setStampResult] = useState(null)

  const handleScan = useCallback(async (rawValue) => {
    if (handlingRef.current) return
    handlingRef.current = true

    let storeId = null
    try {
      const url = new URL(rawValue)
      storeId = url.searchParams.get('store_id')
    } catch {
      if (rawValue.startsWith('store:')) storeId = rawValue.replace('store:', '')
    }

    if (!storeId) {
      setState(STATE.ERROR)
      setErrorMsg('유효하지 않은 QR 코드입니다. 매장 QR을 스캔해주세요.')
      handlingRef.current = false
      return
    }

    setState(STATE.LOADING)

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()

      if (authError || !user) {
        setState(STATE.ERROR)
        setErrorMsg('로그인이 필요합니다.')
        handlingRef.current = false
        return
      }

      // Fetch user profile from members table
      const { data: memberRow, error: memberError } = await supabase
        .from('members')
        .select('first_name, last_name, student_number, "University", membership_valid_until, is_member')
        .eq('user_id', user.id)
        .single()

      if (memberError) {
        console.warn('members fetch error:', memberError)
      }

      // Log the redemption
      const result = await logRedemption({ storeId })

      if (result.success) {
        setStoreName(result.storeName || '매장')
        setMember(memberRow || null)
        setScanTime(new Date())
        setScannedUserId(user.id)

        // Stamp card logic — runs after logRedemption succeeds
        if (result.stampResult?.enabled && result.stampResult?.restaurantId) {
          setStampRestaurantId(result.stampResult.restaurantId)
          setStampCardEnabled(true)
          setStampResult({
            ...result.stampResult,
            redemptionId: result.redemptionId,
            storeId,
          })
        }

        setState(STATE.SUCCESS)
      } else {
        setState(STATE.ERROR)
        setErrorMsg(result.message || 'Check-IN을 기록할 수 없습니다. 다시 시도해주세요.')
      }
    } catch (err) {
      console.error('handleScan error:', err)
      setState(STATE.ERROR)
      setErrorMsg('오류가 발생했습니다: ' + (err?.message || '알 수 없는 오류'))
    }

    handlingRef.current = false
  }, [])

  useEffect(() => {
    const rawValue = location.state?.rawValue
    if (!rawValue || processedInitialScanRef.current === rawValue) return

    processedInitialScanRef.current = rawValue
    handleScan(rawValue)
  }, [handleScan, location.state])

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined

    const syncDarkMode = () => {
      setDarkMode(document.documentElement.classList.contains('dark'))
    }

    const observer = new MutationObserver(syncDarkMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    syncDarkMode()
    return () => observer.disconnect()
  }, [])

  const reset = () => {
    if (location.state?.returnToMemberScanner) {
      navigate('/member', {
        replace: true,
        state: { reopenQrScanner: Date.now() },
      })
      return
    }

    setState(STATE.SCANNING)
    setStoreName('')
    setErrorMsg('')
    setMember(null)
    setScanTime(null)
    setScannedUserId(null)
    setStampRestaurantId(null)
    setStampCardEnabled(false)
    setStampResult(null)
  }

  const formatScanTime = (date) => {
    if (!date) return ''
    const d = new Date(date)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${day} ${h}:${min}`
  }

  const formatMembershipDate = (dateStr) => {
    if (!dateStr) return 'N/A'
    const d = new Date(dateStr)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const fullName = member
    ? `${member.first_name || ''} ${member.last_name || ''}`.trim()
    : ''
  const isLoading = state === STATE.LOADING
  const loadingBg = darkMode ? '#121212' : '#ffffff'

  return (
    <div
      className="phone-app-shell force-light flex flex-col bg-white overflow-hidden"
      style={{
        height: '100dvh',
        backgroundColor: isLoading ? loadingBg : undefined,
      }}
    >
      {/* Header – white */}
      <div
        className="bg-white px-2 py-3 flex items-center flex-shrink-0"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 12px)',
          backgroundColor: isLoading ? loadingBg : undefined,
        }}
      >
        <button
          onClick={() => navigate('/member')}
          className="text-gray-500 hover:text-gray-800 px-2 py-1 rounded-lg hover:bg-gray-100"
          aria-label="뒤로"
        >
          <ArrowLeft size={20} weight="bold" />
        </button>
      </div>

      {/* Body */}
      <div
        className="flex-1 overflow-y-auto flex flex-col items-center bg-white px-4 pb-6 gap-4 relative"
        style={{
          paddingTop: isLoading ? 0 : 12,
          // Reserve room for the fixed result actions without changing the
          // position of the success/error content above them.
          paddingBottom:
            state === STATE.ERROR
              ? '218px'
              : state === STATE.SUCCESS
                ? '158px'
                : undefined,
          justifyContent: isLoading ? 'center' : 'flex-start',
          backgroundColor: isLoading ? loadingBg : undefined,
        }}
      >
        {/* Blinking orange dot – only on success */}
        {state === STATE.SUCCESS && (
          <>
            <style>{`
              @keyframes recordingDot {
                0%   { opacity: 1; }
                50%  { opacity: 1; }
                50.1% { opacity: 0; }
                100% { opacity: 0; }
              }
            `}</style>
            <div
              className="absolute"
              style={{ top: 4, left: 16, zIndex: 10 }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: 9999,
                  backgroundColor: '#f97316',
                  animation: 'recordingDot 1s step-start infinite',
                }}
              />
            </div>
          </>
        )}

        {state === STATE.SCANNING && <QRScanner onScan={handleScan} />}

        {state === STATE.LOADING && (
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-12 h-12 border-4 rounded-full animate-spin"
              style={{
                borderColor: darkMode ? '#2c2c2e' : '#e5e7eb',
                borderTopColor: '#f97316',
              }}
            />
            <p className="text-gray-500 text-sm">멤버십 확인 중...</p>
          </div>
        )}

        {state === STATE.SUCCESS && (
          <div className="flex flex-col items-center gap-4 mt-2 text-center max-w-sm w-full">
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
              <span className="text-green-600 text-4xl">✓</span>
            </div>

            <h2 className="font-bold text-gray-900 text-xl">Check-IN 완료!</h2>

            <p className="text-gray-500 text-sm">
              @{storeName}
            </p>

            <p className="text-base font-bold text-orange-500">
              이 <span className="text-orange-600 font-extrabold">화면과 학생증</span>을 함께 직원에게 제시해 주세요
            </p>

            {/* Member info card */}
            <div className="w-full mt-4 p-4 bg-white rounded-2xl border-2 border-orange-500 shadow-sm text-left space-y-3">
              <div className="flex justify-between items-center pb-3 border-b border-gray-100">
                <span className="text-xs font-medium text-gray-500">Scan Time</span>
                <span className="text-sm font-semibold text-gray-900">
                  {formatScanTime(scanTime)}
                </span>
              </div>

              <div className="flex justify-between items-center pb-3 border-b border-gray-100">
                <span className="text-xs font-medium text-gray-500">Full Name</span>
                <span className="text-sm font-semibold text-gray-900">
                  {fullName || 'N/A'}
                </span>
              </div>

              <div className="flex justify-between items-center pb-3 border-b border-gray-100">
                <span className="text-xs font-medium text-gray-500">Student ID</span>
                <span className="text-sm font-semibold text-gray-900">
                  {member?.student_number || 'N/A'}
                </span>
              </div>

              <div className="flex justify-between items-center pb-3 border-b border-gray-100">
                <span className="text-xs font-medium text-gray-500">University</span>
                <span className="text-sm font-semibold text-gray-900">
                  {member?.University || 'N/A'}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-xs font-medium text-gray-500">
                  Membership Valid Until
                </span>
                <span className="text-sm font-semibold text-gray-900">
                  {formatMembershipDate(member?.membership_valid_until)}
                </span>
              </div>
            </div>

            {/* Stamp card box — shown below member card when enabled */}
            {stampCardEnabled && scannedUserId && stampRestaurantId && (
              <ScanPageStampBox
                restaurantId={stampRestaurantId}
                userId={scannedUserId}
                scanResult={stampResult}
                onRewardRedeemed={() => {}}
              />
            )}

          </div>
        )}

        {state === STATE.ERROR && (
          <div className="flex flex-col items-center gap-4 mt-8 text-center max-w-xs">
            <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
              <span className="text-red-500 text-4xl">✕</span>
            </div>

            <h2 className="font-bold text-gray-900 text-xl">Check-IN 실패</h2>

            <p className="text-gray-500 text-sm">{errorMsg}</p>

          </div>
        )}
      </div>

      {(state === STATE.SUCCESS || state === STATE.ERROR) && (
        <div
          className="fixed left-4 right-4 z-20 flex flex-col gap-4"
          // Match the onboarding screen's "다음" button placement.
          style={{ bottom: '90px' }}
        >
          {state === STATE.ERROR && (
            <button
              onClick={reset}
              className="w-full py-3 bg-orange-500 text-white font-semibold rounded-2xl text-sm hover:bg-orange-600 transition-colors"
            >
              다시 시도하기
            </button>
          )}

          <button
            onClick={() => navigate('/member')}
            className="w-full py-3 bg-gray-100 text-gray-600 font-medium rounded-2xl text-sm hover:bg-gray-200 transition-colors"
          >
            홈으로 돌아가기
          </button>
        </div>
      )}
    </div>
  )
}
