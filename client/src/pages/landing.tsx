import { Navigate } from 'react-router-dom'
import { useAuth } from '../state/auth'

/** The root of the app is a decision, not a page: in or out. */
export function Landing() {
  const { status } = useAuth()
  if (status === 'signed_in') return <Navigate to="/dashboard" replace />
  return <Navigate to="/login" replace />
}
