import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './api'

export type Resource<T> = {
  data: T | null
  loading: boolean
  error: ApiError | null
  /** Fetch again, e.g. from the retry button on an error state. */
  reload: () => void
  /** Patch local data after a mutation, so a save does not need a full round trip. */
  replace: (next: T) => void
}

/**
 * One loading/error/data shape for every screen, so no page invents its own
 * half-finished version of "the request failed".
 */
export function useResource<T>(loader: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]): Resource<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [nonce, setNonce] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    loaderRef
      .current(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setData(result)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof ApiError ? cause : new ApiError(0, 'internal_error', 'The request could not be completed.'))
        setLoading(false)
      })

    return () => controller.abort()
    // The spread is deliberate: each screen passes the values its loader closes over.
  }, [nonce, ...deps])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  return { data, loading, error, reload, replace: setData }
}
