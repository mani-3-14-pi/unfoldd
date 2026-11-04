import { useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { CircleAlert, Eye, EyeOff } from 'lucide-react'
import { authInputClass } from '@/layouts/authStyles'

/** Label, input and error for the login and signup forms. */
export function AuthField({
  id,
  label,
  error,
  hint,
  aside,
  password,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; error?: string; hint?: ReactNode; aside?: ReactNode; password?: boolean }) {
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState('CapsLock'))

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        {aside}
      </div>
      <div className="relative">
        <input
          id={id}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${authInputClass}${password ? ' pr-12' : ''}`}
          type={password ? (visible ? 'text' : 'password') : input.type}
          onKeyDown={password ? onKey : undefined}
          onKeyUp={password ? onKey : undefined}
          onBlur={() => setCapsLock(false)}
          {...input}
        />
        {password && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-[#3d4148] hover:bg-black/5"
          >
            {visible ? <Eye size={19} strokeWidth={1.6} /> : <EyeOff size={19} strokeWidth={1.6} />}
          </button>
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1.5 text-[13px] text-negative">
          <CircleAlert size={14} strokeWidth={2} />
          {error}
        </p>
      ) : capsLock ? (
        <p className="text-[13px] text-amber-ink">Caps Lock is on</p>
      ) : (
        hint && <p className="text-[13px] text-[#6b6f76]">{hint}</p>
      )}
    </div>
  )
}

export function AuthAlert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' }) {
  return (
    <div
      role="alert"
      className={
        tone === 'error'
          ? 'flex items-start gap-2 rounded-[10px] border border-red-soft bg-[#fdf3f3] px-3.5 py-3 text-[13px] text-red-ink'
          : 'flex items-start gap-2 rounded-[10px] border border-amber-soft bg-[#fdf8f1] px-3.5 py-3 text-[13px] text-amber-ink'
      }
    >
      <CircleAlert size={16} strokeWidth={2} className="mt-px shrink-0" />
      <div>{children}</div>
    </div>
  )
}
