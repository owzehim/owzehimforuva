// Any Phosphor icon by name, loaded on demand.
//
// Each icon is its own small file (built under assets/ph/ and left out of the
// app's offline pre-cache), so visitors only download the few icons a place
// actually uses, while admins can pick from the whole set.
const loaders = import.meta.glob('/node_modules/@phosphor-icons/react/dist/csr/*.es.js')

const PATH_PATTERN = /\/csr\/([A-Za-z0-9]+)\.es\.js$/
const byName = new Map()
Object.entries(loaders).forEach(([path, load]) => {
  const match = path.match(PATH_PATTERN)
  if (match) byName.set(match[1], load)
})

export const PHOSPHOR_ICON_NAMES = Array.from(byName.keys()).sort()

const cache = new Map()
const pending = new Map()

export function hasPhosphorIcon(name) {
  return byName.has(name)
}

export function getLoadedPhosphorIcon(name) {
  return cache.get(name) || null
}

export function loadPhosphorIcon(name) {
  if (cache.has(name)) return Promise.resolve(cache.get(name))
  if (pending.has(name)) return pending.get(name)
  const load = byName.get(name)
  if (!load) return Promise.resolve(null)
  const promise = load()
    .then((module) => {
      const component = module[name] || module[`${name}Icon`] || null
      cache.set(name, component)
      pending.delete(name)
      return component
    })
    .catch((error) => {
      pending.delete(name)
      console.warn('Icon failed to load:', name, error?.message || error)
      return null
    })
  pending.set(name, promise)
  return promise
}
