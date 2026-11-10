import { createContext, useContext } from 'react'

export const FeedbackContext = createContext(null)

/** toast.success/info/error/warning, confirm(), notice() — see FeedbackProvider. */
export function useFeedback() {
  const api = useContext(FeedbackContext)
  if (!api) throw new Error('useFeedback must be used inside <FeedbackProvider>')
  return api
}
