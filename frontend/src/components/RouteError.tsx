import { useEffect } from 'react'
import { CircleAlert, RotateCw } from 'lucide-react'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { buttonClass } from '@/components/ui/buttonClass'

/** A page's code couldn't be downloaded: a new version was deployed (or the dev server rebuilt) since this tab opened. */
const isStaleChunk = (error: unknown) =>
  error instanceof Error && /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch/i.test(error.message)

const RELOADED_KEY = 'unfoldd:stale-chunk-reload'

/**
 * Shown instead of React Router's developer screen when a page throws while rendering.
 * A page whose code is out of date reloads once on its own; anything else shows the message, for reporting.
 */
export function RouteError() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  const stale = isStaleChunk(error)
  const home = location.pathname.startsWith('/admin') ? '/admin' : location.pathname.startsWith('/app') ? '/app' : '/'
  const message = error instanceof Error ? error.message : isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : String(error)

  useEffect(() => {
    console.error(error)
    if (!stale) return
    // Reload at most once per tab, so a real outage can't cause a reload loop.
    try {
      if (sessionStorage.getItem(RELOADED_KEY)) return
      sessionStorage.setItem(RELOADED_KEY, '1')
    } catch {
      return
    }
    location.reload()
  }, [error, stale])

  return (
    <div className="grid min-h-screen place-items-center bg-bg px-4">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-red-soft text-red-ink">
          <CircleAlert size={24} />
        </span>
        <h1 className="text-lg font-semibold">{notFound ? 'Page not found' : stale ? 'A newer version is available' : 'Something went wrong on this page'}</h1>
        <p className="text-[13px] text-text-3">
          {notFound ? 'The link may be old or mistyped.' : stale ? 'Reload to get it.' : 'Reloading usually fixes it. If it keeps happening, tell us what you were doing.'}
        </p>
        <div className="mt-2 flex gap-2">
          {!notFound && (
            <button type="button" className={buttonClass('primary')} onClick={() => location.reload()}>
              <RotateCw size={15} /> Reload
            </button>
          )}
          <Link to={home} className={buttonClass('secondary')}>
            Go to home
          </Link>
        </div>
        {!notFound && (
          <details className="mt-4 w-full text-left text-xs text-text-3">
            <summary className="cursor-pointer text-center">Details</summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-surface-input p-3 whitespace-pre-wrap">{message}</pre>
          </details>
        )}
      </div>
    </div>
  )
}
