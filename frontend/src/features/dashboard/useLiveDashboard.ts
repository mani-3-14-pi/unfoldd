import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Keeps the dashboard current without polling: the server pushes a `change` event (backend `lib/live.ts`) whenever
 * something of this agency changes, and the dashboard refetches. After a dropped connection it refetches once on
 * reconnect, in case something changed in between. EventSource reconnects by itself.
 */
export function useLiveDashboard() {
  const qc = useQueryClient()
  useEffect(() => {
    const refresh = () => void qc.invalidateQueries({ queryKey: ['agency', 'dashboard'] })
    const source = new EventSource('/api/events')
    let dropped = false
    source.addEventListener('change', refresh)
    source.addEventListener('error', () => (dropped = true))
    source.addEventListener('open', () => {
      if (dropped) refresh()
      dropped = false
    })
    return () => source.close()
  }, [qc])
}
