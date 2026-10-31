import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { RequireAuth, RedirectIfSignedIn } from './components/route-guards'
import { ErrorState } from './components/ui/feedback'
import { Landing } from './pages/landing'
import { NotFoundPage } from './pages/not-found'
import { LoginPage } from './pages/login'
import { RegisterPage } from './pages/register'
import { ForgotPasswordPage } from './pages/forgot-password'
import { ResetPasswordPage } from './pages/reset-password'
import { VerifyEmailPage } from './pages/verify-email'
import { DashboardPage } from './pages/dashboard'
import { ScorePage } from './pages/score'
import { AccountsPage } from './pages/accounts'
import { CheckLinkPage } from './pages/check-link'
import { RecommendationsPage } from './pages/recommendations'
import { AlertsPage } from './pages/alerts'
import { ActivityPage } from './pages/activity'
import { ProfileSettingsPage } from './pages/settings-profile'
import { SecuritySettingsPage } from './pages/settings-security'
import { NotificationSettingsPage } from './pages/settings-notifications'

class ScreenBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Digital Guardian screen failed', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-lg px-4 py-16">
          <ErrorState
            title="This screen could not be shown"
            message="Something on this page failed. Reloading is safe - your data is on the server."
            onRetry={() => window.location.reload()}
          />
        </div>
      )
    }
    return this.props.children
  }
}

/** One boundary per route so a broken screen offers a way out instead of a white page. */
function screen(element: ReactNode) {
  return <ScreenBoundary>{element}</ScreenBoundary>
}

const router = createBrowserRouter([
  { index: true, element: screen(<Landing />) },
  {
    element: <RedirectIfSignedIn />,
    children: [
      { path: 'login', element: screen(<LoginPage />) },
      { path: 'register', element: screen(<RegisterPage />) },
      { path: 'forgot-password', element: screen(<ForgotPasswordPage />) },
    ],
  },
  { path: 'verify-email', element: screen(<VerifyEmailPage />) },
  { path: 'reset-password', element: screen(<ResetPasswordPage />) },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      { path: 'dashboard', element: screen(<DashboardPage />) },
      { path: 'score', element: screen(<ScorePage />) },
      { path: 'accounts', element: screen(<AccountsPage />) },
      { path: 'check-link', element: screen(<CheckLinkPage />) },
      { path: 'recommendations', element: screen(<RecommendationsPage />) },
      { path: 'alerts', element: screen(<AlertsPage />) },
      { path: 'activity', element: screen(<ActivityPage />) },
      { path: 'settings/profile', element: screen(<ProfileSettingsPage />) },
      { path: 'settings/security', element: screen(<SecuritySettingsPage />) },
      { path: 'settings/notifications', element: screen(<NotificationSettingsPage />) },
    ],
  },
  { path: '*', element: screen(<NotFoundPage />) },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
