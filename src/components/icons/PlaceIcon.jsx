import { useEffect, useState } from 'react'
import { BowlSteam, CoinVertical, HandHeart, Wine } from '@phosphor-icons/react'

// The full icon list is its own file, fetched only when a custom icon is shown.
let loaderModule = null
const getLoader = () => import('./phosphorIconLoader').then((module) => {
  loaderModule = module
  return module
})

// The default 멤버 평가 icons ship with the app so restaurants never wait.
const BUILT_IN = { BowlSteam, CoinVertical, HandHeart, Wine }

/** Renders a Phosphor icon by name; other icons load on demand. */
export default function PlaceIcon({ name, size = 16, weight = 'regular', color, className }) {
  const builtIn = BUILT_IN[name]
  const [loaded, setLoaded] = useState(() => (builtIn ? null : { name, component: loaderModule?.getLoadedPhosphorIcon(name) || null }))

  useEffect(() => {
    if (builtIn) return undefined
    let active = true
    getLoader()
      .then((loader) => loader.loadPhosphorIcon(name))
      .then((component) => {
        if (active) setLoaded({ name, component })
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [name, builtIn])

  const Icon = builtIn || (loaded?.name === name ? loaded.component : null)
  if (!Icon) {
    return <span aria-hidden="true" className={className} style={{ display: 'inline-block', width: size, height: size, flexShrink: 0 }} />
  }
  return <Icon size={size} weight={weight} color={color} className={className} />
}
