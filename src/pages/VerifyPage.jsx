import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { verifyTOTP } from '../lib/totp'
import LoadingIndicator from '../components/LoadingIndicator'

export default function VerifyPage() {
  const { token } = useParams()
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [timeLeft, setTimeLeft] = useState(15)
  const scanTimeRef = useRef(null)

  // Parse QR token into OTP and student number
  const parseToken = (qrToken) => {
    const parts = qrToken?.split('_')
    if (!parts || parts.length < 2) return null
    return { otpToken: parts[0], studentNumber: parts[1] }
  }

  // Verify the QR code against the database
  const verifyQRCode = async (qrToken) => {
    const parsed = parseToken(qrToken)
    if (!parsed) {
      setResult({ valid: false, reason: 'Invalid QR code.' })
      return
    }

    const { otpToken, studentNumber } = parsed
    try {
      // Fetch member data from database
      const { data: member, error: memberError } = await supabase
        .from('members')
        .select('*')
        .eq('student_number', studentNumber)
        .single()

      if (memberError || !member) {
        setResult({ valid: false, reason: 'Member not found.' })
        return
      }

      // Verify TOTP token
      const isValidToken = await verifyTOTP(otpToken, member.totp_secret)

      // Check if membership is active
      const isActiveMember =
        member.is_member &&
        member.membership_valid_until &&
        new Date(member.membership_valid_until) >= new Date()

      // Set result based on verification
      if (!isValidToken) {
        setResult({
          valid: false,
          reason: 'QR code has expired. Please ask the member to refresh.',
        })
      } else if (!isActiveMember) {
        setResult({
          valid: false,
          reason: 'Membership is not active.',
          member,
        })
      } else {
        setResult({ valid: true, member })
      }
    } catch (error) {
      console.error('Verification error:', error)
      setResult({
        valid: false,
        reason: 'Verification error. Please try again.',
      })
    }
  }

  // Initial verification when page loads
  useEffect(() => {
    const initialVerify = async () => {
      // Record the scan time in sessionStorage (persists across page refreshes in same tab)
      if (!scanTimeRef.current) {
        const existingScanTime = sessionStorage.getItem('qrScanTime')
        if (existingScanTime) {
          scanTimeRef.current = parseInt(existingScanTime)
        } else {
          scanTimeRef.current = Date.now()
          sessionStorage.setItem('qrScanTime', scanTimeRef.current.toString())
        }
      }

      await verifyQRCode(token)
      setLoading(false)
    }

    initialVerify()
  }, [token])

  // Countdown timer - stable across page refreshes
  useEffect(() => {
    if (loading || !result?.valid) return

    const interval = setInterval(() => {
      const scanTime = parseInt(sessionStorage.getItem('qrScanTime') || Date.now())
      const elapsedSeconds = Math.floor((Date.now() - scanTime) / 1000)
      const remaining = Math.max(0, 15 - elapsedSeconds)

      setTimeLeft(remaining)

      // Redirect to expired page after 15 seconds
      if (remaining === 0) {
        clearInterval(interval)
        setResult({
          valid: false,
          reason: 'QR code has expired.',
          member: result.member,
        })
        sessionStorage.removeItem('qrScanTime')
      }
    }, 100) // Update every 100ms for smooth countdown

    return () => clearInterval(interval)
  }, [loading, result])

  if (loading) {
    return (
      <div className="phone-app-shell min-h-screen flex items-center justify-center bg-gray-50">
        <LoadingIndicator label="Verifying..." />
      </div>
    )
  }

  return (
    <div className="phone-app-shell min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-gray-100 p-6 w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="font-bold text-gray-900 text-lg">UvA-IN Membership</h1>
          <p className="text-xs text-gray-400 mt-1">
            University of Amsterdam Korean Student Association
          </p>
        </div>

        {/* Valid Result - Show for 15 seconds then expire */}
        {result?.valid ? (
          <div className="space-y-4">
            {/* Status Badge */}
            <div className="bg-green-50 rounded-xl p-4 text-center">
              <p className="text-green-600 font-bold text-2xl">✓ Valid</p>
              <p className="text-green-500 text-sm mt-1">Membership is active</p>
            </div>

            {/* Member Details */}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-2 border-b border-gray-50">
                <span className="text-gray-400">Name</span>
                <span className="font-medium">{result.member.full_name}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-50">
                <span className="text-gray-400">Student No.</span>
                <span className="font-medium">{result.member.student_number}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-50">
                <span className="text-gray-400">Major</span>
                <span className="font-medium">{result.member.major}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-gray-400">Valid Until</span>
                <span className="font-medium text-green-600">
                  {result.member.membership_valid_until}
                </span>
              </div>
            </div>

            {/* Countdown Timer */}
            <div className="bg-blue-50 rounded-xl p-4 text-center mt-4">
              <p className="text-xs text-gray-500 mb-2">Expiring in:</p>
              <p className="text-3xl font-bold text-blue-600 font-mono">
                {timeLeft}s
              </p>
            </div>
          </div>
        ) : (
          /* Invalid Result */
          <div className="space-y-4">
            {/* Status Badge */}
            <div className="bg-red-50 rounded-xl p-4 text-center">
              <p className="text-red-600 font-bold text-2xl">✗ Invalid</p>
              <p className="text-red-400 text-sm mt-1">{result?.reason}</p>
            </div>

            {/* Member Details (if available) */}
            {result?.member && (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b border-gray-50">
                  <span className="text-gray-400">Name</span>
                  <span className="font-medium">{result.member.full_name}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-gray-400">Valid Until</span>
                  <span className="font-medium text-red-500">
                    {result.member.membership_valid_until}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <p className="text-xs text-gray-300 text-center mt-6">
          UvA-IN © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
