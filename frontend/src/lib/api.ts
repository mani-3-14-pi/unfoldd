// Calls to the Unfoldd API (backend/). The session lives in an httpOnly cookie,
// so requests only need to be same-origin; Vite proxies /api in development.

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

/** True when the API couldn't be reached at all (server not running), as opposed to an error it returned. */
export const isOffline = (error: unknown) => error instanceof ApiError && error.code === 'offline'

/** True for a 409 the server sends when someone else changed the record first (`rev` mismatch). */
export const isStale = (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === 'stale'

export interface ApiInit {
  method?: string
  body?: unknown
  /**
   * Sent as `Idempotency-Key` on create actions, so a retried request can't create a duplicate (rule §12.4).
   * Make one per user intent (e.g. per dialog), not per request: see `useIdempotencyKey`.
   */
  idempotencyKey?: string
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData
  const headers: Record<string, string> = {}
  if (init.body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      headers,
      body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
    })
  } catch {
    throw new ApiError(0, 'offline', 'Can’t reach the server. Check your connection and try again.')
  }
  if (res.status === 204) return undefined as T
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null
  if (!res.ok) {
    // Without a JSON error body the proxy answered, not the API: treat it as unreachable.
    if (!data?.error) throw new ApiError(res.status, 'offline', 'Can’t reach the server. Check your connection and try again.')
    throw new ApiError(res.status, data.error.code, data.error.message, data.error.details)
  }
  return data as T
}
