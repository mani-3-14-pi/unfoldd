import { useEffect, useRef, useState } from 'react'
import { ApiError, files, type Message, type VoiceInput } from './api.ts'

export interface RecordedVoice extends VoiceInput {
  /** Local playback of what was just recorded. */
  preview: string
}

type Phase = 'ready' | 'recording' | 'paused' | 'saving' | 'recorded'

/** The longest note the server takes (30 minutes). */
const MAX_MS = 30 * 60_000

const now = () => Date.now()

export function formatDuration(ms: number) {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Record a voice note: Record → Recording ⇄ Paused → Stop → listen back, then send it or record again.
 * The audio is uploaded as soon as recording stops.
 */
export function VoiceRecorder({ value, onChange, disabled }: { value: RecordedVoice | null; onChange: (voice: RecordedVoice | null) => void; disabled?: boolean }) {
  const [phase, setPhase] = useState<Phase>(value ? 'recorded' : 'ready')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  // Time recorded before the current stretch, and when that stretch started (pauses don't count).
  const banked = useRef(0)
  const startedAt = useRef(0)

  useEffect(() => {
    if (phase !== 'recording') return
    const t = setInterval(() => {
      const ms = banked.current + (now() - startedAt.current)
      setElapsed(ms)
      if (ms >= MAX_MS) recorder.current?.stop()
    }, 250)
    return () => clearInterval(t)
  }, [phase])

  // Let go of the microphone if the comment box goes away mid-recording.
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((track) => track.stop()), [])

  async function start() {
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
      const durationMs = Math.min(MAX_MS, Math.round(banked.current + (startedAt.current ? now() - startedAt.current : 0)))
      void save(new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' }), durationMs)
    }
    recorder.current = rec
    rec.start()
    startedAt.current = now()
    setElapsed(0)
    setPhase('recording')
  }

  function pause() {
    recorder.current?.pause()
    banked.current += now() - startedAt.current
    startedAt.current = 0
    setPhase('paused')
  }

  function resume() {
    recorder.current?.resume()
    startedAt.current = now()
    setPhase('recording')
  }

  async function save(blob: Blob, durationMs: number) {
    setPhase('saving')
    // The server takes a plain media type ("audio/webm"), not one with codec parameters.
    const type = blob.type.split(';')[0] || 'audio/webm'
    const file = new File([blob], `voice-note.${type.split('/')[1] ?? 'webm'}`, { type })
    try {
      const done = await files.upload(file, 'attachment')
      onChange({ file: done.id, durationMs, preview: URL.createObjectURL(blob) })
      setPhase('recorded')
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : 'The voice note couldn’t be saved. Please try again.')
      setPhase('ready')
    }
  }

  function discard() {
    if (value) URL.revokeObjectURL(value.preview)
    onChange(null)
    setElapsed(0)
    setPhase('ready')
  }

  return (
    <div className="voice">
      {phase === 'recorded' && value ? (
        <div className="voice-bar">
          <audio src={value.preview} controls preload="metadata" aria-label="Your voice note" />
          <span className="voice-time">{formatDuration(value.durationMs)}</span>
          <button type="button" className="btn ghost sm" onClick={discard}>Record again</button>
        </div>
      ) : phase === 'saving' ? (
        <p className="voice-status">Saving voice note…</p>
      ) : phase === 'recording' || phase === 'paused' ? (
        <div className="voice-bar" role="group" aria-label="Recording">
          <span className={`voice-dot${phase === 'recording' ? ' live' : ''}`} aria-hidden="true" />
          <span className="voice-time">{formatDuration(elapsed)}</span>
          <span className="voice-status">{phase === 'recording' ? 'Recording…' : 'Paused'}</span>
          {phase === 'recording' ? (
            <button type="button" className="btn ghost sm" onClick={pause}>Pause</button>
          ) : (
            <button type="button" className="btn ghost sm" onClick={resume}>Resume</button>
          )}
          <button type="button" className="btn sm" onClick={() => recorder.current?.stop()}>Stop</button>
        </div>
      ) : (
        <button type="button" className="btn ghost" onClick={() => void start()} disabled={disabled}>
          <span className="voice-dot" aria-hidden="true" /> Record voice note
        </button>
      )}
      {error && <p className="voice-error">{error}</p>}
    </div>
  )
}

/** Plays a voice note. The signed link is only fetched when someone presses play. */
export function VoicePlayer({ voice }: { voice: NonNullable<Message['voice']> }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    if (url) void audio.current?.play().catch(() => undefined)
  }, [url])

  async function load() {
    setLoading(true)
    setError(false)
    try {
      setUrl((await files.url(voice.file)).url)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="voice">
      {url ? (
        <audio ref={audio} src={url} controls preload="none" aria-label="Voice note" />
      ) : (
        <button type="button" className="voice-play" onClick={() => void load()} disabled={loading}>
          ▶ Voice note · {formatDuration(voice.durationMs)}
        </button>
      )}
      {error && <p className="voice-error">Couldn’t load the audio. Please try again.</p>}
      {voice.transcriptStatus === 'done' && voice.transcript && (
        <p className="voice-transcript"><b>Auto-transcript:</b> {voice.transcript}</p>
      )}
    </div>
  )
}
