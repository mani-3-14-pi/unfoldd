import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, CircleAlert, FileImage, FileVideo, LoaderCircle, Plus, X } from 'lucide-react'
import { FormError } from '@/components/FormError'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Textarea } from '@/components/ui/Field'
import { TagsInput } from '@/components/ui/TagsInput'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { useUpload } from '@/hooks/useUpload'
import { cn } from '@/lib/cn'
import { fieldErrors } from '@/lib/errors'
import { contentApi, type ContentRecord, type Thread } from './api'
import { pinLabel, versionLabel } from './labels'

interface Pick {
  key: string
  file: File
  /** Set once the upload finished and the server checked it. */
  id: string | null
  failed: boolean
}

/**
 * Upload the next version (P77). Files go straight to storage first; the version is created once they're all in.
 * The server numbers it (D60), moves the content back to production and voids any approval (D76).
 */
export function VersionUploadDialog({ content, threads, onClose, onDone }: { content: ContentRecord; threads: Thread[]; onClose: () => void; onDone: () => void }) {
  const current = content.versions.find((v) => v._id === content.currentVersion)
  const nextNumber = (content.versions[0]?.number ?? 0) + 1
  const [picks, setPicks] = useState<Pick[]>([])
  const [caption, setCaption] = useState(current?.caption ?? '')
  const [hashtags, setHashtags] = useState<string[]>(current?.hashtags ?? [])
  const [changeNote, setChangeNote] = useState('')
  const [resolves, setResolves] = useState<string[]>([])
  const [resolutionNote, setResolutionNote] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const idem = useIdempotencyKey()

  // "Which feedback does this version address?" (Flow 7, step 7): open client feedback on this content.
  const openFeedback = threads.filter((t) => t.kind === 'feedback' && t.visibility === 'client' && !t.draft && t.status !== 'resolved')
  const uploading = picks.some((p) => !p.id && !p.failed)
  const ready = picks.length > 0 && picks.every((p) => p.id)
  const voidsApproval = ['approved', 'scheduled'].includes(content.state)
  const withdraws = ['client_review', 'changes_requested'].includes(content.state)

  const save = useMutation({
    mutationFn: () =>
      contentApi.uploadVersion(
        content._id,
        { files: picks.map((p) => p.id!), caption, hashtags, changeNote: changeNote.trim(), resolves, resolutionNote: resolutionNote.trim() },
        idem.key,
      ),
    onSuccess: onDone,
  })
  const errors = fieldErrors(save.error)

  const add = (files: FileList | null) => {
    if (!files) return
    const room = 20 - picks.length
    setPicks((p) => [...p, ...[...files].slice(0, room).map((file) => ({ key: crypto.randomUUID(), file, id: null, failed: false }))])
  }
  const update = (key: string, patch: Partial<Pick>) => setPicks((p) => p.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const move = (i: number, by: number) =>
    setPicks((p) => {
      const next = [...p]
      const [item] = next.splice(i, 1)
      next.splice(i + by, 0, item!)
      return next
    })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ready) save.mutate()
  }

  return (
    <Dialog
      title={`Upload ${versionLabel(nextNumber)}`}
      description={`${content.title} · the files, caption and hashtags the client will approve together.`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="version-form" loading={save.isPending} disabled={!ready}>
            {uploading ? 'Uploading files…' : `Create ${versionLabel(nextNumber)}`}
          </Button>
        </>
      }
    >
      <form id="version-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
        {(voidsApproval || withdraws) && (
          <p className="flex gap-2 rounded-lg border border-amber-soft bg-[#fdf8f1] px-3 py-2.5 text-[13px] text-amber-ink">
            <CircleAlert size={16} className="mt-px shrink-0" />
            {voidsApproval
              ? `This voids the client’s approval${content.state === 'scheduled' ? ' and cancels the scheduled publish' : ''}. ${versionLabel(nextNumber)} will need approval again.`
              : `The client is looking at ${current ? versionLabel(current.number) : 'the current version'}. They’ll be told it was withdrawn and a new version is coming.`}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-text-2">Files {content.format === 'carousel' && <span className="font-normal text-text-4">· slides, in order</span>}</span>
          {picks.length > 0 && (
            <ol className="flex flex-col gap-1.5">
              {picks.map((p, i) => (
                <UploadRow
                  key={p.key}
                  pick={p}
                  index={i}
                  last={i === picks.length - 1}
                  client={content.client._id}
                  onDone={(id) => update(p.key, { id })}
                  onFailed={() => update(p.key, { failed: true })}
                  onRemove={() => setPicks((x) => x.filter((y) => y.key !== p.key))}
                  onMove={(by) => move(i, by)}
                />
              ))}
            </ol>
          )}
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              add(e.dataTransfer.files)
            }}
            disabled={picks.length >= 20}
            className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-6 text-[13px] text-text-2 hover:bg-surface-input disabled:opacity-50"
          >
            <Plus size={18} />
            {picks.length ? 'Add more files' : 'Choose images or videos, or drop them here'}
            <span className="text-xs text-text-4">Up to 20 files</span>
          </button>
          {errors.files && <p className="text-xs text-negative">{errors.files}</p>}
          <input
            ref={input}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              add(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        <Field label="Caption" htmlFor="v-caption" hint="Part of the version: the client approves this exact text." error={errors.caption}>
          <Textarea id="v-caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={5000} className="min-h-24" />
        </Field>
        <Field label="Hashtags" htmlFor="v-hashtags" error={errors.hashtags}>
          <TagsInput id="v-hashtags" value={hashtags} onChange={(v) => setHashtags(v.map((h) => (h.startsWith('#') ? h : `#${h}`)))} max={60} placeholder="#diwali" />
        </Field>
        <Field label="What changed (optional)" htmlFor="v-note" hint="Shown to your team and the client with the version." error={errors.changeNote}>
          <Textarea id="v-note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} maxLength={2000} />
        </Field>

        {openFeedback.length > 0 && (
          <fieldset className="flex flex-col gap-2 rounded-xl border border-border-strong p-4">
            <legend className="px-1 text-xs font-medium text-text-2">Which feedback does {versionLabel(nextNumber)} address?</legend>
            <p className="text-xs text-text-3">Ticked items are marked “Resolved in {versionLabel(nextNumber)}” for the client, with your note.</p>
            <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              {openFeedback.map((t) => (
                <li key={t._id}>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-surface-input">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-brand"
                      checked={resolves.includes(t._id)}
                      onChange={(e) => setResolves((r) => (e.target.checked ? [...r, t._id] : r.filter((x) => x !== t._id)))}
                    />
                    <span className="min-w-0 text-[13px]">
                      <span className="mr-1.5 font-semibold">{pinLabel(t.visibility, t.pin)}</span>
                      {t.messages[0]?.body || 'Voice note'}
                      <span className="ml-1.5 text-xs text-text-4">on {t.versionNumber ? versionLabel(t.versionNumber) : '—'}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {resolves.length > 0 && (
              <Field label="Your response" htmlFor="v-resolution" hint="Shown to the client on each ticked item.">
                <Textarea id="v-resolution" value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} maxLength={2000} placeholder="e.g. Logo moved to the top right and enlarged." />
              </Field>
            )}
          </fieldset>
        )}

        {save.isError && Object.keys(errors).length === 0 && <FormError error={save.error} />}
      </form>
    </Dialog>
  )
}

/** One picked file: uploads itself as soon as it appears, and reports the stored file's id. */
function UploadRow({
  pick,
  index,
  last,
  client,
  onDone,
  onFailed,
  onRemove,
  onMove,
}: {
  pick: Pick
  index: number
  last: boolean
  client: string
  onDone: (id: string) => void
  onFailed: () => void
  onRemove: () => void
  onMove: (by: number) => void
}) {
  const { state, upload, cancel } = useUpload()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void upload(pick.file, { purpose: 'version', client }).then((done) => (done ? onDone(done.id) : onFailed()))
    // Run once per row; the callbacks only update the parent's list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const Icon = pick.file.type.startsWith('video/') ? FileVideo : FileImage
  return (
    <li className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', state.phase === 'failed' ? 'border-red-soft bg-[#fdf3f3]' : 'border-border-strong bg-white')}>
      <span className="w-5 text-center text-xs text-text-4">{index + 1}</span>
      <Icon size={18} className="shrink-0 text-text-3" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">{pick.file.name}</div>
        <div className="text-xs text-text-4">
          {state.phase === 'uploading' && (
            <span className="flex items-center gap-2">
              <span className="h-1 w-32 overflow-hidden rounded-full bg-surface-input">
                <span className="block h-full bg-brand transition-[width]" style={{ width: `${Math.round(state.progress * 100)}%` }} />
              </span>
              {Math.round(state.progress * 100)}%
            </span>
          )}
          {state.phase === 'processing' && (
            <span className="flex items-center gap-1.5">
              <LoaderCircle size={12} className="animate-spin" /> Checking…
            </span>
          )}
          {state.phase === 'done' && 'Uploaded'}
          {state.phase === 'failed' && <span className="text-negative">{state.message}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)} className="grid size-7 place-items-center rounded text-text-3 hover:bg-black/5 disabled:opacity-30">
          <ArrowUp size={14} />
        </button>
        <button type="button" aria-label="Move down" disabled={last} onClick={() => onMove(1)} className="grid size-7 place-items-center rounded text-text-3 hover:bg-black/5 disabled:opacity-30">
          <ArrowDown size={14} />
        </button>
        <button
          type="button"
          aria-label={`Remove ${pick.file.name}`}
          onClick={() => {
            cancel()
            onRemove()
          }}
          className="grid size-7 place-items-center rounded text-text-3 hover:bg-black/5"
        >
          <X size={14} />
        </button>
      </div>
    </li>
  )
}
