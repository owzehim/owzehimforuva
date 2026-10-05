import { useState, useEffect } from 'react'
import { DEFAULT_STAMP_CARD_CONFIG, fetchConfigBySpot } from '../api/config'

export function useStampCardConfig(restaurantId, { useDefault = false } = {}) {
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!restaurantId) return undefined

    let cancelled = false

    fetchConfigBySpot(restaurantId)
      .then((data) => {
        if (!cancelled) {
          setResult({
            key: `${restaurantId}:${useDefault}`,
            config: data ?? (useDefault ? DEFAULT_STAMP_CARD_CONFIG : null),
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResult({
            key: `${restaurantId}:${useDefault}`,
            config: useDefault ? DEFAULT_STAMP_CARD_CONFIG : null,
          })
        }
      })

    return () => { cancelled = true }
  }, [restaurantId, useDefault])

  if (!restaurantId) return { config: null, loading: false }

  const resultKey = `${restaurantId}:${useDefault}`
  if (result?.key !== resultKey) return { config: null, loading: true }

  return { config: result.config, loading: false }
}
