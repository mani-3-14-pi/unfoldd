import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { dismissToast, useToasts } from '@/lib/toast'

export function Toaster() {
  const toasts = useToasts()
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100%-32px))] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex items-start gap-2.5 rounded-xl bg-[#0f2f24] px-4 py-3 text-[13px] text-white shadow-xl"
        >
          {t.tone === 'error' ? (
            <CircleAlert size={18} className="mt-px shrink-0 text-[#f3a7a7]" />
          ) : (
            <CircleCheck size={18} className="mt-px shrink-0 text-[#9fe0bd]" />
          )}
          <span className="flex-1">{t.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="text-white/70 hover:text-white">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}
