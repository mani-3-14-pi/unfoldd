import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, LoaderCircle, Lock, Plus, Trash2 } from 'lucide-react'
import { useUpload } from '@/hooks/useUpload'
import { errorMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { clientRequestKey, clientRequestsApi, type ClientRequest } from './api'

const size = (n?: number) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/**
 * F55: the request's files. Each picked file uploads straight away and is attached to the request, so it's in
 * the brand's library too (D36). Files can be removed until the request is submitted; after that they're locked.
 */
export function RequestUploads({ request: r, canUpload }: { request: ClientRequest; canUpload: boolean }) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [picks, setPicks] = useState<{ key: string; file: File }[]>([])
  const open = r.status === 'open'
  const refresh = () => void qc.invalidateQueries({ queryKey: clientRequestKey(r.id) })

  const remove = useMutation({
    mutationFn: (file: string) => clientRequestsApi.detach(r.id, file),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e), 'error'),
  })
  const download = async (file: string) => {
    try {
      const { url } = await clientRequestsApi.fileUrl(file)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {r.files.length === 0 && picks.length === 0 && <p className="text-[13px] text-text-3">No files yet.</p>}
      <ul className="flex flex-col gap-2">
        {r.files.map((f) => (
          <li key={f.id} className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-white px-3 py-2">
            <FileText size={20} className="shrink-0 text-text-3" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px]">{f.name ?? 'File'}</span>
              <span className="block text-xs text-text-4">
                {size(f.size)}
                {f.locked && (
                  <span className="ml-1.5 inline-flex items-center gap-1">
                    <Lock size={11} /> Sent
                  </span>
                )}
              </span>
            </span>
            <button type="button" aria-label={`Open ${f.name ?? 'file'}`} onClick={() => void download(f.id)} className="grid size-10 place-items-center rounded-lg text-text-2 hover:bg-black/5">
              <Download size={18} />
            </button>
            {open && canUpload && !f.locked && (
              <button type="button" aria-label={`Remove ${f.name ?? 'file'}`} disabled={remove.isPending} onClick={() => remove.mutate(f.id)} className="grid size-10 place-items-center rounded-lg text-negative hover:bg-black/5">
                <Trash2 size={18} />
              </button>
            )}
          </li>
        ))}
        {picks.map((p) => (
          <UploadingRow
            key={p.key}
            requestId={r.id}
            file={p.file}
            onDone={() => {
              setPicks((x) => x.filter((y) => y.key !== p.key))
              refresh()
            }}
            onDismiss={() => setPicks((x) => x.filter((y) => y.key !== p.key))}
          />
        ))}
      </ul>
      {open && canUpload && (
        <>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex h-14 items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface text-[14px] font-medium text-text-2 hover:bg-surface-input"
          >
            <Plus size={18} /> Add files
          </button>
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              setPicks((x) => [...x, ...files.map((file) => ({ key: crypto.randomUUID(), file }))])
              e.target.value = ''
            }}
          />
        </>
      )}
    </div>
  )
}

/** Uploads one file as soon as it appears, then attaches it to the request. */
function UploadingRow({ requestId, file, onDone, onDismiss }: { requestId: string; file: File; onDone: () => void; onDismiss: () => void }) {
  const { state, upload } = useUpload()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      const done = await upload(file, { purpose: 'request' })
      if (!done) return
      try {
        await clientRequestsApi.attach(requestId, done.id)
        onDone()
      } catch (e) {
        setError(errorMessage(e))
      }
    })()
    // Once per picked file; the callbacks only update the parent's list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const failed = error ?? (state.phase === 'failed' ? state.message : null)
  return (
    <li className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-white px-3 py-2">
      {failed ? <FileText size={20} className="shrink-0 text-negative" /> : <LoaderCircle size={20} className="shrink-0 animate-spin text-brand" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px]">{file.name}</span>
        <span className={failed ? 'block text-xs text-negative' : 'block text-xs text-text-4'}>
          {failed ?? (state.phase === 'uploading' ? `Uploading… ${Math.round(state.progress * 100)}%` : 'Almost there…')}
        </span>
      </span>
      {failed && (
        <button type="button" onClick={onDismiss} className="h-10 rounded-lg px-3 text-xs font-medium text-text-2 hover:bg-black/5">
          Dismiss
        </button>
      )}
    </li>
  )
}
