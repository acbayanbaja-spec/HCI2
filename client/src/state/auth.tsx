import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, setSessionLostHandler } from '../lib/api'
import type { LoginMfaRequired, LoginPolicy, LoginSuccess, PublicUser, RegisterResult } from '../lib/api-types'

export type LoginResult = LoginSuccess | LoginMfaRequired

export type AuthStatus = 'booting' | 'signed_out' | 'signed_in'

type AuthValue = {
  status: AuthStatus
  user: PublicUser | null
  policy: LoginPolicy | null
  /** Set when the server ended our session, so the sign-in page can say why. */
  sessionNotice: string | null
  clearSessionNotice: () => void
  bootstrap: () => Promise<void>
  login: (email: string, password: string) => Promise<LoginResult>
  submitMfa: (sessionId: string, code: string) => Promise<LoginSuccess>
  register: (input: { email: string; password: string; displayName: string }) => Promise<RegisterResult>
  logout: () => Promise<void>
  applyUser: (user: PublicUser) => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('booting')
  const [user, setUser] = useState<PublicUser | null>(null)
  const [policy, setPolicy] = useState<LoginPolicy | null>(null)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)

  const bootstrap = useCallback(async () => {
    try {
      const me = await api.get<{ user: PublicUser }>('/api/auth/me')
      setUser(me.user)
      setStatus('signed_in')
    } catch (error) {
      // A missing session is the expected answer here; anything else is a real fault.
      if (!(error instanceof ApiError) || error.status !== 401) {
        setSessionNotice('Digital Guardian could not be reached. Check your connection and try again.')
      }
      setUser(null)
      setStatus('signed_out')
    }
  }, [])

  useEffect(() => {
    void bootstrap()
    api
      .get<LoginPolicy>('/api/auth/policy')
      .then(setPolicy)
      .catch(() => setPolicy(null))
  }, [bootstrap])

  useEffect(
    () =>
      setSessionLostHandler(() => {
        setUser(null)
        setStatus('signed_out')
        setSessionNotice('Your session ended. Please sign in again.')
      }),
    [],
  )

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<LoginResult>('/api/auth/login', { email, password })
    if (result.authenticated) {
      setUser(result.user)
      setStatus('signed_in')
    }
    return result
  }, [])

  const submitMfa = useCallback(async (sessionId: string, code: string) => {
    const result = await api.post<LoginResult>('/api/auth/login/mfa', { sessionId, code })
    if (!result.authenticated) {
      throw new ApiError(500, 'internal_error', 'The service did not finish the sign-in. Please try again.')
    }
    setUser(result.user)
    setStatus('signed_in')
    return result
  }, [])

  const register = useCallback(
    (input: { email: string; password: string; displayName: string }) =>
      api.post<RegisterResult>('/api/auth/register', input, { skipRefresh: true }),
    [],
  )

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout', undefined, { skipRefresh: true })
    } finally {
      setUser(null)
      setStatus('signed_out')
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      policy,
      sessionNotice,
      clearSessionNotice: () => setSessionNotice(null),
      bootstrap,
      login,
      submitMfa,
      register,
      logout,
      applyUser: (next: PublicUser) => setUser(next),
    }),
    [status, user, policy, sessionNotice, bootstrap, login, submitMfa, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
