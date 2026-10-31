import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { buttonClasses } from '../components/ui/button'

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-[14px] border border-line bg-surface text-faint">
        <Compass className="size-6" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold text-ink">There is nothing at this address</h1>
      <p className="mt-2 max-w-md text-sm text-muted">
        The page you asked for is not part of Digital Guardian. Nothing was lost - check the address or head back to your
        dashboard.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link to="/dashboard" className={buttonClasses('primary', 'md')}>
          Go to dashboard
        </Link>
        <Link to="/login" className={buttonClasses('secondary', 'md')}>
          Sign in
        </Link>
      </div>
    </div>
  )
}
