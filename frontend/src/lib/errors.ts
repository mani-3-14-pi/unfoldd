import { ApiError } from './api'

export const errorMessage = (error: unknown, fallback = 'Something went wrong. Try again.') =>
  error instanceof ApiError ? error.message : fallback

/** Per-field messages from a 400 `invalid_input` error: { email: 'Enter a valid email' }. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== 'object') return {}
  return Object.fromEntries(
    Object.entries(error.details as Record<string, unknown>)
      .filter(([, v]) => Array.isArray(v) && typeof v[0] === 'string')
      .map(([k, v]) => [k, (v as string[])[0]!]),
  )
}
