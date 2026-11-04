import { useState } from 'react'

/**
 * One `Idempotency-Key` per mounted form or dialog: a double click or a retry after a network error reuses it,
 * so the server answers with the first result instead of creating a second invitation or client.
 * Call `renew()` after a success when the same form stays open for another create.
 */
export function useIdempotencyKey() {
  const [key, setKey] = useState(() => crypto.randomUUID())
  return { key, renew: () => setKey(crypto.randomUUID()) }
}
