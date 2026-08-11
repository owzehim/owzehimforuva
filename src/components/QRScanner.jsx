import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { VideoCameraSlash } from '@phosphor-icons/react'

const QR_BOX_SIZE = 220

export default function QRScanner({ onScan, darkMode = false }) {
  const scannerRef = useRef(null)
  const scannedRef = useRef(false)
  const onScanRef = useRef(onScan)
  const [cameraPermissionDenied, setCameraPermissionDenied] = useState(false)

  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  useEffect(() => {
    const scannerId = 'qr-scanner-container'
    let isMounted = true
    let stopRequested = false

    async function startScanner() {
      let scanner
      try {
        scanner = new Html5Qrcode(scannerId, { verbose: false })
        scannerRef.current = scanner

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: QR_BOX_SIZE, height: QR_BOX_SIZE },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            if (!isMounted || scannedRef.current) return
            scannedRef.current = true
            onScanRef.current(decodedText)
            setTimeout(() => {
              scannedRef.current = false
            }, 2000)
          },
          () => {},
        )

        if (stopRequested) {
          try {
            await scanner.stop()
          } catch (err) {
            console.warn('QR scanner late-stop error:', err?.message)
          }
        }
      } catch (err) {
        console.error('QR scanner start error:', err)
        const errorName = err?.name || ''
        const errorMessage = err?.message || ''
        if (
          errorName === 'NotAllowedError' ||
          errorName === 'PermissionDeniedError' ||
          /camera.*permission|permission.*camera|permission denied|not allowed/i.test(errorMessage)
        ) {
          setCameraPermissionDenied(true)
        }
      }
    }

    startScanner()

    return () => {
      isMounted = false
      stopRequested = true
      const scanner = scannerRef.current
      if (scanner) {
        try {
          const stopResult = scanner.stop()
          if (stopResult?.catch) {
            stopResult.catch((err) =>
              console.warn('QR scanner stop error:', err?.message),
            )
          }
        } catch (err) {
          console.warn('QR scanner stop threw:', err?.message)
        }
        scannerRef.current = null
      }
    }
  }, [])

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <style>{`
        #qr-scanner-container #qr-shaded-region {
          border-width: 0 !important;
        }
        #qr-scanner-container video {
          border-radius: 12px;
        }
        #qr-scanner-container #qr-shaded-region + div,
        #qr-scanner-container [id^="qr-code-full-region"] > div:last-child {
          border: none !important;
        }
        #qr-shaded-region {
          border: none !important;
          box-shadow: 0 0 0 9999px rgba(246, 244, 241, 0.75) !important;
        }
      `}</style>

      <div className="relative w-full max-w-xs" style={{ aspectRatio: '1' }}>
        <div
          id="qr-scanner-container"
          className="h-full w-full overflow-hidden rounded-2xl"
        />

        <div
          className="pointer-events-none absolute"
          style={{
            top: '50%',
            left: '50%',
            width: QR_BOX_SIZE,
            height: QR_BOX_SIZE,
            transform: 'translate(-50%, -50%)',
          }}
        >
          {[
            { top: 0, left: 0, borderTop: true, borderLeft: true, radius: '4px 0 0 0' },
            { top: 0, right: 0, borderTop: true, borderRight: true, radius: '0 4px 0 0' },
            { bottom: 0, left: 0, borderBottom: true, borderLeft: true, radius: '0 0 0 4px' },
            { bottom: 0, right: 0, borderBottom: true, borderRight: true, radius: '0 0 4px 0' },
          ].map((corner, i) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                width: 28,
                height: 28,
                ...(corner.top !== undefined && { top: corner.top }),
                ...(corner.bottom !== undefined && { bottom: corner.bottom }),
                ...(corner.left !== undefined && { left: corner.left }),
                ...(corner.right !== undefined && { right: corner.right }),
                ...(corner.borderTop && { borderTop: '3px solid #F6F4F1' }),
                ...(corner.borderBottom && { borderBottom: '3px solid #F6F4F1' }),
                ...(corner.borderLeft && { borderLeft: '3px solid #F6F4F1' }),
                ...(corner.borderRight && { borderRight: '3px solid #F6F4F1' }),
                borderRadius: corner.radius,
              }}
            />
          ))}
        </div>

        {cameraPermissionDenied && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-2xl"
            style={{
              zIndex: 1,
              background: darkMode ? '#2C2C2E' : '#E9E6DE',
              color: darkMode ? '#A1A1AA' : 'rgba(44,42,39,0.45)',
            }}
          >
            <VideoCameraSlash size={54} weight="regular" />
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-1 px-4 text-center">
        {cameraPermissionDenied && (
          <p
            style={{
              fontSize: '14px',
              fontWeight: 700,
              color: darkMode ? '#F7F8F9' : '#2C2A27',
              fontFamily: 'var(--font-app)',
              letterSpacing: '0.02em',
              margin: 0,
            }}
          >
            카메라 접근 권한을 허용해주세요.
          </p>
        )}
        <p
          style={{
            display: cameraPermissionDenied ? 'none' : undefined,
            fontSize: '14px',
            fontWeight: 600,
            color: darkMode ? '#F7F8F9' : '#2C2A27',
            fontFamily: 'var(--font-app)',
            letterSpacing: '0.04em',
            margin: 0,
          }}
        >
          매장 QR 코드를 스캔해주세요
        </p>
        <p
          style={{
            fontSize: '12px',
            color: darkMode ? '#A1A1AA' : 'rgba(44,42,39,0.45)',
            fontFamily: 'var(--font-app)',
            letterSpacing: '0.02em',
            margin: 0,
          }}
        >
          카메라가 실행되지 않으면 앱을 재시작해주세요
        </p>
      </div>
    </div>
  )
}
