import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

type Value = string | string[] | number | boolean | null | undefined

/**
 * List filters, sort and page live in the URL (?q=…&status=active,suspended&page=2), so they survive
 * reloads, can be shared, and the query string goes to the API as-is. Lists are comma-separated.
 */
export function useListState() {
  const [params, setParams] = useSearchParams()

  const get = useCallback((key: string, fallback = '') => params.get(key) ?? fallback, [params])
  const getList = useCallback((key: string) => (params.get(key) ?? '').split(',').filter(Boolean), [params])

  /** Applies a patch; empty values remove the key. Any change other than `page` goes back to page 1. */
  const update = useCallback(
    (patch: Record<string, Value>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(patch)) {
            const text = Array.isArray(value) ? value.join(',') : value === false || value == null ? '' : String(value)
            if (text) next.set(key, text)
            else next.delete(key)
          }
          if (!('page' in patch)) next.delete('page')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  const clear = useCallback((keys: string[]) => update(Object.fromEntries(keys.map((k) => [k, null]))), [update])

  return { params, get, getList, update, clear }
}

export type ListState = ReturnType<typeof useListState>

/** The query string for the API: the URL's params plus any fixed ones (e.g. a locked status). */
export function apiQuery(params: URLSearchParams, fixed: Record<string, string> = {}) {
  const query = new URLSearchParams(params)
  for (const [key, value] of Object.entries(fixed)) query.set(key, value)
  query.sort()
  return query.toString()
}
