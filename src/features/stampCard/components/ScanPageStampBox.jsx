import { useEffect, useState } from 'react'
import { CheckCircle, Octagon } from '@phosphor-icons/react'
import { useStampCardConfig } from '../hooks/useStampCardConfig'
import { useUserStampVisits } from '../hooks/useUserStampVisits'
import { redeemReward } from '../api/rewards'
import { didRedeemRewardForCurrentScan, getScanResultIdentity } from '../utils'

const CLAIM_ORANGE = '#f97316'

export default function ScanPageStampBox({
  restaurantId,
  userId,
  scanResult,
  onRewardRedeemed,
}) {
  const { config } = useStampCardConfig(restaurantId, { useDefault: true })
  const { stampState, pendingReward: hookPendingReward, refetch } = useUserStampVisits({
    userId,
    restaurantId,
    totalStamps: config?.total_stamps,
  })

  const [redeeming, setRedeeming] = useState(false)
  const [redeemedScanId, setRedeemedScanId] = useState(null)
  const currentScanId = getScanResultIdentity(scanResult)

  useEffect(() => {
    if (scanResult && !scanResult.alreadyStamped) refetch()
  }, [scanResult, refetch])

  if (!config) return null

  const total = config.total_stamps
  const accentColor = CLAIM_ORANGE
  const effectivePendingReward = hookPendingReward || stampState.pendingReward
  const redeemedThisSession = didRedeemRewardForCurrentScan(scanResult, redeemedScanId)
  const isBenefitReady = !redeemedThisSession &&
    !!(
      effectivePendingReward ||
      scanResult?.rewardPending ||
      scanResult?.cycleCompleted ||
      stampState.hasPendingReward
    )
  const count = isBenefitReady ? total : stampState.stampsInCurrentCycle
  const remaining = Math.max(total - count, 0)

  const handleRedeem = async () => {
    if (!effectivePendingReward) return
    if (!window.confirm('Confirm applying benefits?')) return

    setRedeeming(true)
    try {
      const result = await redeemReward(effectivePendingReward.id, {
        redemptionId: scanResult?.redemptionId,
        storeId: scanResult?.storeId,
      })
      if (result?.sheetSync?.success === false) {
        alert('리워드는 사용 처리됐지만 매장 기록 동기화에 실패했습니다. 관리자에게 알려주세요.')
      }
      setRedeemedScanId(currentScanId ?? null)
      await refetch()
      onRewardRedeemed?.()
    } catch (e) {
      console.error('redeemReward error:', e)
      alert(e?.message || 'Failed to complete benefit application.')
    } finally {
      setRedeeming(false)
    }
  }

  return (
    <div className="w-full flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={isBenefitReady ? handleRedeem : undefined}
        disabled={!isBenefitReady || redeeming || !effectivePendingReward}
        className="w-full rounded-2xl border px-4 py-3 transition-transform active:scale-[0.99]"
        style={{
          borderColor: isBenefitReady ? CLAIM_ORANGE : '#e5e7eb',
          backgroundColor: isBenefitReady ? CLAIM_ORANGE : '#ffffff',
          cursor: isBenefitReady && effectivePendingReward ? 'pointer' : 'default',
          opacity: redeeming ? 0.75 : 1,
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <StampIcons
            count={count}
            total={total}
            accentColor={isBenefitReady ? CLAIM_ORANGE : accentColor}
            inverted={isBenefitReady}
          />
          <div className="text-right shrink-0">
            <p
              className="text-sm font-bold leading-none"
              style={{ color: isBenefitReady ? '#ffffff' : '#374151' }}
            >
              {count} / {total}
            </p>
            <p
              className="text-[11px] mt-1 leading-none"
              style={{ color: isBenefitReady ? 'rgba(255,255,255,0.86)' : '#9ca3af' }}
            >
              {isBenefitReady ? '혜택 준비 완료' : `남은 스탬프 ${remaining}개`}
            </p>
          </div>
        </div>

        <div className="mt-2 min-h-[16px] flex items-center justify-center">
          {scanResult?.alreadyStamped && !isBenefitReady && (
            <p className="text-xs text-gray-400 text-center">
              오늘은 이미 포인트가 적립되었어요
            </p>
          )}

          {isBenefitReady && (
            <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-white">
              <CheckCircle size={15} weight="fill" />
              {redeeming
                ? '혜택 적용 처리 중...'
                : effectivePendingReward
                  ? 'Staff Only: Tap to Complete Applying Benefits'
                  : '혜택 정보 불러오는 중...'}
            </div>
          )}
        </div>
      </button>
    </div>
  )
}

function StampIcons({ count, total, accentColor, inverted }) {
  return (
    <div className="flex flex-wrap gap-1">
      {Array.from({ length: total }, (_, i) => {
        const filled = i < count
        return (
          <Octagon
            key={i}
            size={20}
            weight={filled ? 'fill' : 'regular'}
            color={inverted ? '#ffffff' : filled ? accentColor : '#d1d5db'}
            style={{ opacity: filled || !inverted ? 1 : 0.45 }}
          />
        )
      })}
    </div>
  )
}
