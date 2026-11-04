import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, Mic, Pause, Play, Square, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useUpload } from '@/hooks/useUpload'
import { cn } from '@/lib/cn'
import { contentApi, type Message } from './api'
import { formatTime } from './labels'

export interface RecordedVoice {
  file: string
  durationMs: number
  /** Local playback of what was just recorded. */
  preview: string
}

type Phase = 'ready' | 'recording' | 'paused' | 'uploading' | 'recorded' | 'failed'

/** Wall-clock time, only ever read from handlers and timers (never during render). */
const now = () => Date.now()

/** The longest note the server takes (30 minutes). */
const MAX_MS = 30 * 60_000

/**
 * F32/P66: record a voice note. Ready → Recording ⇄ Paused → Recorded (preview) → sent with the comment, or
 * discarded. The audio is uploaded as soon as recording stops; it's no more private than the thread it's for.
 */
export function VoiceRecorder({
  client,
  visibility,
  value,
  onChange,
  disabled,
}: {
  client: string
  visibility: 'internal' | 'client'
  value: RecordedVoice | null
  onChange: (voice: RecordedVoice | null) => void
  disabled?: boolean
}) {
  const [phase, setPhase] = useState<Phase>(value ? 'recorded' : 'ready')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  // Time recorded before the current stretch, and when that stretch started (pauses don't count).
  const banked = useRef(0)
  const startedAt = useRef(0)
  const { upload } = useUpload()

  useEffect(() => {
    if (phase !== 'recording') return
    const t = setInterval(() => {
      const ms = banked.current + (now() - startedAt.current)
      setElapsed(ms)
      if (ms >= MAX_MS) recorder.current?.stop()
    }, 250)
    return () => clearInterval(t)
  }, [phase])

  // Release the microphone if the composer goes away mid-recording.
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((track) => track.stop()), [])

  const start = async () => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser can’t record audio.')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Allow microphone access to record a voice note.')
      return
    }
    const rec = new MediaRecorder(stream)
    chunks.current = []
    banked.current = 0
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    rec.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      const durationMs = Math.min(MAX_MS, Math.round(banked.current + (rec.state === 'inactive' && startedAt.current ? now() - startedAt.current : 0)))
      void finish(new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' }), durationMs)
    }
    recorder.current = rec
    rec.start()
    startedAt.current = now()
    setElapsed(0)
    setPhase('recording')
  }

  const pause = () => {
    recorder.current?.pause()
    banked.current += now() - startedAt.current
    startedAt.current = 0
    setPhase('paused')
  }
  const resume = () => {
    recorder.current?.resume()
    startedAt.current = now()
    setPhase('recording')
  }
  const stop = () => recorder.current?.stop()

  const finish = async (blob: Blob, durationMs: number) => {
    setPhase('uploading')
    // The server takes a plain media type ("audio/webm"), not one with codec parameters.
    const type = blob.type.split(';')[0] || 'audio/webm'
    const ext = type.split('/')[1] ?? 'webm'
    const file = new File([blob], `voice-note.${ext}`, { type })
    // `visibility` isn't in useUpload's option type, but it's passed through to the server as is.
    const options = { purpose: 'attachment' as const, client, visibility }
    const done = await upload(file, options)
    if (!done) {
      setPhase('failed')
      setError('The voice note couldn’t be uploaded. File storage may not be set up on this server.')
      return
    }
    onChange({ file: done.id, durationMs, preview: URL.createObjectURL(blob) })
    setPhase('recorded')
  }

  const discard = () => {
    if (value) URL.revokeObjectURL(value.preview)
    onChange(null)
    setElapsed(0)
    setPhase('ready')
  }

  if (phase === 'recorded' && value) {
    return (
      <div className="flex items-center gap-2 rounded-full bg-white py-1 pr-1 pl-2 ring-1 ring-border-strong">
        <Mic size={14} className="shrink-0 text-negative" />
        <audio src={value.preview} controls preload="metadata" className="h-8 max-w-56" aria-label="Your voice note" />
        <span className="text-xs text-text-3">{formatTime(value.durationMs)}</span>
        <button type="button" onClick={discard} aria-label="Discard voice note" className="grid size-7 place-items-center rounded-full text-text-3 hover:bg-black/5">
          <Trash2 size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {phase === 'ready' || phase === 'failed' ? (
        <Button size="sm" onClick={() => void start()} disabled={disabled} aria-label="Record a voice note">
          <Mic size={13} /> Voice
        </Button>
      ) : phase === 'uploading' ? (
        <span className="flex h-8 items-center gap-1.5 text-xs text-text-3">
          <LoaderCircle size={13} className="animate-spin" /> Saving voice note…
        </span>
      ) : (
        <div className="flex items-center gap-1.5 rounded-full bg-white py-0.5 pr-0.5 pl-2.5 ring-1 ring-border-strong" role="group" aria-label="Recording">
          <span className={cn('size-2 rounded-full bg-[#e5484d]', phase === 'recording' && 'animate-pulse')} aria-hidden="true" />
          <span className="w-10 text-xs tabular-nums">{formatTime(elapsed)}</span>
          {phase === 'recording' ? (
            <button type="button" onClick={pause} aria-label="Pause" className="grid size-7 place-items-center rounded-full hover:bg-black/5">
              <Pause size={14} />
            </button>
          ) : (
            <button type="button" onClick={resume} aria-label="Resume" className="grid size-7 place-items-center rounded-full hover:bg-black/5">
              <Mic size={14} />
            </button>
          )}
          <button type="button" onClick={stop} aria-label="Stop recording" className="grid size-7 place-items-center rounded-full bg-[#e5484d] text-white hover:opacity-90">
            <Square size={11} fill="currentColor" />
          </button>
        </div>
      )}
      {error && <span className="text-xs text-negative">{error}</span>}
    </div>
  )
}

/**
 * F33/F34: play a voice message. The signed URL is fetched only when someone presses play. The transcript is
 * shown as "Auto-transcript", read-only; the audio stays the source of truth (D22).
 */
export function VoicePlayer({ voice }: { voice: NonNullable<Message['voice']> }) {
  const [wanted, setWanted] = useState(false)
  const url = useQuery({ queryKey: ['files', 'url', voice.file], queryFn: () => contentApi.fileUrl(voice.file), enabled: wanted, staleTime: 4 * 60_000, retry: false })
  const audio = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    if (url.data && wanted) void audio.current?.play().catch(() => undefined)
  }, [url.data, wanted])

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {url.data ? (
        <audio ref={audio} src={url.data.url} controls preload="none" className="h-9 w-full max-w-xs" aria-label="Voice note" />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setWanted(true)
          }}
          disabled={url.isFetching}
          className="flex w-fit items-center gap-2 rounded-full bg-surface-input py-1.5 pr-3 pl-2 text-xs text-text-2 hover:bg-border-strong"
        >
          {url.isFetching ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
          Voice note · {formatTime(voice.durationMs)}
        </button>
      )}
      {url.isError && <span className="text-xs text-negative">Couldn’t load the audio. File storage may not be set up on this server.</span>}
      {voice.transcriptStatus === 'done' && voice.transcript ? (
        <span className="rounded bg-surface-input px-2 py-1 text-xs text-text-2">
          <span className="font-medium">{voice.transcriptLabel || 'Auto-transcript'}:</span> {voice.transcript}
        </span>
      ) : voice.transcriptStatus === 'pending' ? (
        <span className="text-xs text-text-4">Transcribing…</span>
      ) : null}
    </div>
  )
}
