import { useDevInteractionLock } from '../lib/devInteractionLock'

export default function DevScreenInteractionLock({ children }) {
  const locked = useDevInteractionLock()
  if (!locked) return children

  return <div className="dev-no-zoom-selection">{children}</div>
}
