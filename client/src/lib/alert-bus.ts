type Listener = () => void

const listeners = new Set<Listener>()

/**
 * Alerts are read from two places at once - the alerts screen and the count in the
 * header - so a mutation has to tell the other one. Smaller than lifting the count
 * into a context, and it cannot drift because there is only ever one signal.
 */
export function onAlertsChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyAlertsChanged(): void {
  for (const listener of listeners) listener()
}
