export function resolveAppEnv({ isViteDev, configuredEnv }) {
  return isViteDev && configuredEnv === 'development' ? 'development' : 'production'
}
