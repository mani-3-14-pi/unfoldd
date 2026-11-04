import { RotateCw } from 'lucide-react'
import { isStale } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

/**
 * A form's error line. For a stale save (409: someone else changed the record since it was opened, rule §12.3)
 * it offers "Reload", which throws away this form's edits and shows theirs.
 */
export function FormError({ error, onReload }: { error: unknown; onReload?: () => void }) {
  if (!error) return null
  return (
    <p role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-negative">
      {errorMessage(error)}
      {isStale(error) && onReload && (
        <button type="button" onClick={onReload} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
          <RotateCw size={13} /> Reload
        </button>
      )}
    </p>
  )
}
