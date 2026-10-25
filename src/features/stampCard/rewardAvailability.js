export function isPendingRewardAvailable(reward, now = new Date()) {
  if (!reward || reward.redeemed !== false) return false
  if (!reward.expires_at) return true
  const expiresAt = new Date(reward.expires_at).getTime()
  return Number.isFinite(expiresAt) && expiresAt > now.getTime()
}
