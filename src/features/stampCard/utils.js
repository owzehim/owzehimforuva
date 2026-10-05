// Derives the full stamp state from all visits for a user+spot.
// visits: all rows ordered by visited_at ASC.
export function computeStampState(visits, totalStamps, pendingReward = null) {
  const totalVisits = visits.length
  const hasPendingReward = !!pendingReward

  if (pendingReward) {
    const currentCycle = pendingReward.card_cycle ?? Math.floor(Math.max(totalVisits - 1, 0) / totalStamps) + 1
    const currentCycleVisits = visits
      .filter((visit) => visit.card_cycle === currentCycle)
      .slice(0, totalStamps)

    return {
      totalVisits,
      currentCycle,
      stampsInCurrentCycle: totalStamps,
      isCardFull: true,
      hasPendingReward: true,
      pendingReward,
      currentCycleVisits,
    }
  }

  if (totalVisits === 0) {
    return {
      totalVisits: 0,
      currentCycle: 1,
      stampsInCurrentCycle: 0,
      isCardFull: false,
      hasPendingReward,
      pendingReward,
      currentCycleVisits: [],
    }
  }

  const remainder = totalVisits % totalStamps
  const isCardFull = false
  const currentCycle = Math.floor(totalVisits / totalStamps) + 1
  const stampsInCurrentCycle = remainder

  // Visits that belong to the current (or just-completed) cycle
  const cycleStart = totalVisits - remainder
  const currentCycleVisits = remainder === 0 ? [] : visits.slice(cycleStart, cycleStart + totalStamps)

  return {
    totalVisits,
    currentCycle,
    stampsInCurrentCycle,
    isCardFull,
    hasPendingReward: false,
    pendingReward: null,
    currentCycleVisits,
  }
}
