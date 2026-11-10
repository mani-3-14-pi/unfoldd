import { useCallback, useRef } from 'react'

/**
 * Debounces an action button (leading edge): the first click runs right away, and further clicks are
 * ignored while it is still running and for `cooldownMs` after it finishes. This stops double clicks
 * from sending the same approval, comment or login twice.
 *
 * A ref is used rather than state because two fast clicks can land before React re-renders a
 * `disabled` button. Keep the `disabled={busy}` styling too, so people can see it is working.
 *
 *   const debounce = useDebouncedAction()
 *   <button onClick={debounce(save)}>Save</button>
 */
export function useDebouncedAction(cooldownMs = 600) {
  const running = useRef(false)
  const lockedUntil = useRef(0)

  return useCallback(
    <A extends unknown[]>(fn: (...args: A) => unknown) =>
      async (...args: A) => {
        if (running.current || Date.now() < lockedUntil.current) return
        running.current = true
        try {
          await fn(...args)
        } finally {
          running.current = false
          lockedUntil.current = Date.now() + cooldownMs
        }
      },
    [cooldownMs],
  )
}
