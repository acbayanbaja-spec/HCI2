import { StrictMode, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AppRouter } from './router'
import { ThemeProvider, useTheme } from './state/theme'
import { ToastProvider } from './state/toast'
import { AuthProvider, useAuth } from './state/auth'
import { api } from './lib/api'
import type { Profile } from './lib/api-types'

/** The account holds the theme preference; this applies it once per sign-in. */
function AccountThemeSync() {
  const { status } = useAuth()
  const { preference, setPreference } = useTheme()
  const applied = useRef(false)

  useEffect(() => {
    if (status !== 'signed_in' || applied.current) return
    applied.current = true
    let cancelled = false
    api
      .get<Profile>('/api/settings/profile')
      .then((profile) => {
        if (!cancelled && profile.theme !== preference) setPreference(profile.theme)
      })
      .catch(() => {
        // A failed profile read must not change a theme that already works.
      })
    return () => {
      cancelled = true
    }
  }, [status, preference, setPreference])

  return null
}

function Root() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <AccountThemeSync />
          <AppRouter />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('The #root element is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
