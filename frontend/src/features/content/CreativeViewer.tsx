import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useQueries } from '@tanstack/react-query'
import { ArrowUpRight, ChevronLeft, ChevronRight, Circle, ImageOff, MapPin, PenLine, Square, Undo2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { contentApi, type Anchor, type Format, type Shape, type Thread, type Version } from './api'
import { formatAspect, formatTime, pinLabel } from './labels'

const INK = '#e5484d'

/** File name, type and a short-lived signed URL for every slide of a version (rule §12.6). */
function useSlides(version: Version) {
  const metas = useQueries({
    queries: version.files.map((f) => ({ queryKey: ['files', 'meta', f.file], queryFn: () => contentApi.file(f.file), staleTime: Infinity, retry: false })),
  })
  const urls = useQueries({
    queries: version.files.map((f) => ({
      queryKey: ['files', 'url', f.file],
      queryFn: () => contentApi.fileUrl(f.file),
      // Signed URLs expire; refetch well before they do.
      staleTime: 4 * 60_000,
      retry: false,
    })),
  })
  return version.files.map((f, i) => ({
    ...f,
    meta: metas[i]?.data?.file,
    url: urls[i]?.data?.url,
    unavailable: !!urls[i]?.isError,
  }))
}

/** The first point of a thread's drawing: where its numbered pin sits. */
const pinPoint = (t: Thread) => t.anchor?.shapes?.[0]?.points[0]

/**
 * The creative as the client will see it (P53/F23): image, carousel or video in its platform's frame, with
 * numbered pins for feedback. In `annotating` mode the person draws on the current slide; shapes are kept in
 * 0–1 coordinates so they land in the same place on any screen (D12). Video comments carry the paused time (D13).
 */
export function CreativeViewer({
  version,
  format,
  threads,
  selected,
  onSelect,
  annotating = false,
  onDraft,
  draft,
  compact = false,
}: {
  version: Version
  format: Format
  /** Threads on this version; their pins show on their slide. */
  threads: Thread[]
  selected?: string | null
  onSelect?: (threadId: string) => void
  annotating?: boolean
  /** The anchor being drawn: reported on every change, `null` when cleared. */
  onDraft?: (anchor: Anchor | null) => void
  draft?: Anchor | null
  compact?: boolean
}) {
  const slides = useSlides(version)
  const [index, setIndex] = useState(0)
  const [aspect, setAspect] = useState<number | null>(null)
  const [tool, setTool] = useState<Shape['type']>('circle')
  const [drawing, setDrawing] = useState<Shape | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const svg = useRef<SVGSVGElement>(null)

  const slide = slides[Math.min(index, slides.length - 1)]
  const isVideo = slide?.meta?.mimeType.startsWith('video/')
  const selectedThread = threads.find((t) => t._id === selected)

  // Jump to the slide (and video time) of the thread picked in the feedback list.
  useEffect(() => {
    if (!selectedThread?.anchor) return
    const i = slides.findIndex((s) => s._id === selectedThread.anchor?.versionFile)
    if (i >= 0) setIndex(i)
    if (selectedThread.anchor.timeMs != null && video.current) {
      video.current.currentTime = selectedThread.anchor.timeMs / 1000
      video.current.pause()
    }
    // Only when the selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  useEffect(() => setAspect(null), [slide?._id])

  const draftShapes = draft?.versionFile === slide?._id ? (draft?.shapes ?? []) : []
  const visibleThreads = threads.filter((t) => t.anchor?.versionFile === slide?._id && !t.draft)

  const toPoint = (e: ReactPointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const report = (shapes: Shape[]) => {
    const timeMs = isVideo && video.current ? Math.round(video.current.currentTime * 1000) : undefined
    onDraft?.({ versionFile: slide!._id, shapes, ...(timeMs != null ? { timeMs } : {}) })
  }

  const down = (e: ReactPointerEvent) => {
    if (!annotating || !slide) return
    video.current?.pause()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const p = toPoint(e)
    setDrawing({ type: tool, points: [p, p], color: INK })
  }
  const moveDraw = (e: ReactPointerEvent) => {
    if (!drawing) return
    const p = toPoint(e)
    setDrawing((d) => d && { ...d, points: d.type === 'pen' ? [...d.points, p].slice(-2000) : [d.points[0]!, p] })
  }
  const up = () => {
    if (!drawing) return
    report([...draftShapes, drawing])
    setDrawing(null)
  }

  if (!slide) {
    return <div className="grid aspect-square place-items-center rounded-xl bg-surface-input text-[13px] text-text-3">This version has no files.</div>
  }

  const frame = aspect ?? formatAspect[format]
  return (
    <div className="flex flex-col gap-3">
      <div className={cn('relative grid place-items-center rounded-xl bg-[#1d2420] p-3', compact ? 'min-h-64' : 'min-h-80')}>
        <div
          className="relative max-w-full overflow-hidden rounded-md bg-black/30"
          // As tall as the screen allows, narrower on small screens, always in the media's own aspect.
          style={{ aspectRatio: String(frame), width: `min(100%, calc(${compact ? 'min(52vh, 460px)' : 'min(68vh, 680px)'} * ${frame}))` }}
        >
          {slide.unavailable ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-[13px] text-white/70">
              <ImageOff size={28} />
              Preview unavailable. File storage may not be set up on this server.
              <span className="text-xs text-white/50">{slide.meta?.name}</span>
            </div>
          ) : !slide.url || !slide.meta ? (
            <div className="absolute inset-0 animate-pulse bg-white/5" />
          ) : isVideo ? (
            <video
              ref={video}
              key={slide.url}
              src={slide.url}
              controls={!annotating}
              playsInline
              className="absolute inset-0 size-full object-contain"
              onLoadedMetadata={(e) => setAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight || null)}
            />
          ) : (
            <img
              key={slide.url}
              src={slide.url}
              alt={slide.meta.name}
              className="absolute inset-0 size-full object-contain"
              onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight || null)}
            />
          )}

          <svg
            ref={svg}
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            className={cn('absolute inset-0 size-full', annotating ? 'cursor-crosshair touch-none' : 'pointer-events-none')}
            onPointerDown={down}
            onPointerMove={moveDraw}
            onPointerUp={up}
            onPointerCancel={() => setDrawing(null)}
          >
            {selectedThread?.anchor?.versionFile === slide._id && selectedThread.anchor.shapes?.map((s, i) => <ShapeView key={i} shape={s} />)}
            {draftShapes.map((s, i) => (
              <ShapeView key={`d${i}`} shape={s} />
            ))}
            {drawing && <ShapeView shape={drawing} />}
          </svg>

          {/* Pins are HTML so they stay round and readable whatever the frame's aspect. */}
          {!annotating &&
            visibleThreads.map((t) => {
              const p = pinPoint(t)
              if (!p) return null
              return (
                <button
                  key={t._id}
                  type="button"
                  onClick={() => onSelect?.(t._id)}
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                  aria-label={`Feedback ${pinLabel(t.visibility, t.pin)}`}
                  className={cn(
                    'absolute grid h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full px-1.5 text-[11px] font-semibold shadow-md ring-2 ring-white',
                    t.visibility === 'internal' ? 'bg-[#4b47c4] text-white' : 'bg-[#e5484d] text-white',
                    t.status === 'resolved' && 'opacity-50',
                    t._id === selected && 'scale-125',
                  )}
                >
                  {pinLabel(t.visibility, t.pin)}
                </button>
              )
            })}
        </div>

        {slides.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous slide"
              disabled={index === 0}
              onClick={() => setIndex((i) => i - 1)}
              className="absolute top-1/2 left-2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-text shadow disabled:opacity-0"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              aria-label="Next slide"
              disabled={index === slides.length - 1}
              onClick={() => setIndex((i) => i + 1)}
              className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-text shadow disabled:opacity-0"
            >
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {slides.length > 1 ? (
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Slides">
            {slides.map((s, i) => {
              const count = threads.filter((t) => t.anchor?.versionFile === s._id && !t.draft).length
              return (
                <button
                  key={s._id}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  onClick={() => setIndex(i)}
                  className={cn('relative grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-xs', i === index ? 'bg-brand text-white' : 'bg-surface-input text-text-2 hover:bg-border-strong')}
                >
                  {i + 1}
                  {count > 0 && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-[#e5484d]" aria-label={`${count} comments`} />}
                </button>
              )
            })}
          </div>
        ) : (
          <span className="text-xs text-text-4">{slide.meta?.name}</span>
        )}

        {annotating && (
          <div className="flex items-center gap-1 rounded-lg border border-border-strong bg-white p-1" role="toolbar" aria-label="Drawing tools">
            {(
              [
                ['circle', Circle, 'Circle'],
                ['rect', Square, 'Box'],
                ['arrow', ArrowUpRight, 'Arrow'],
                ['pen', PenLine, 'Pen'],
              ] as const
            ).map(([t, Icon, label]) => (
              <button
                key={t}
                type="button"
                aria-pressed={tool === t}
                aria-label={label}
                title={label}
                onClick={() => setTool(t)}
                className={cn('grid size-8 place-items-center rounded-md', tool === t ? 'bg-brand text-white' : 'text-text-2 hover:bg-black/5')}
              >
                <Icon size={16} />
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-border-strong" />
            <button type="button" aria-label="Undo" title="Undo" disabled={!draftShapes.length} onClick={() => report(draftShapes.slice(0, -1))} className="grid size-8 place-items-center rounded-md text-text-2 hover:bg-black/5 disabled:opacity-40">
              <Undo2 size={16} />
            </button>
            <button type="button" aria-label="Clear" title="Clear" disabled={!draftShapes.length} onClick={() => onDraft?.(null)} className="grid size-8 place-items-center rounded-md text-text-2 hover:bg-black/5 disabled:opacity-40">
              <X size={16} />
            </button>
          </div>
        )}
        {!annotating && isVideo && (
          <TimeMarkers
            threads={threads.filter((t) => t.anchor?.versionFile === slide._id && t.anchor.timeMs != null && !t.draft)}
            onSeek={(t) => {
              onSelect?.(t._id)
              if (video.current) video.current.currentTime = (t.anchor!.timeMs ?? 0) / 1000
            }}
          />
        )}
      </div>
      {annotating && (
        <p className="flex items-center gap-1.5 text-xs text-text-3">
          <MapPin size={13} /> Draw on the {isVideo ? 'paused frame' : 'slide'} to point at what you mean, then write your comment.
        </p>
      )}
    </div>
  )
}

function TimeMarkers({ threads, onSeek }: { threads: Thread[]; onSeek: (t: Thread) => void }) {
  if (!threads.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {threads.map((t) => (
        <button key={t._id} type="button" onClick={() => onSeek(t)} className="rounded-full bg-surface-input px-2.5 py-1 text-xs text-text-2 hover:bg-border-strong">
          {pinLabel(t.visibility, t.pin)} at {formatTime(t.anchor!.timeMs!)}
        </button>
      ))}
    </div>
  )
}

/** One shape in the 0–1 viewBox. Stroke widths are in screen pixels, so they look the same at any size. */
function ShapeView({ shape }: { shape: Shape }) {
  const stroke = { stroke: shape.color ?? INK, strokeWidth: 3, fill: 'none', vectorEffect: 'non-scaling-stroke' as const, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const [a, b = a] = shape.points
  if (!a) return null
  switch (shape.type) {
    case 'pen':
    case 'highlight':
      return <polyline points={shape.points.map((p) => `${p.x},${p.y}`).join(' ')} {...stroke} />
    case 'rect':
      return <rect x={Math.min(a.x, b!.x)} y={Math.min(a.y, b!.y)} width={Math.abs(b!.x - a.x)} height={Math.abs(b!.y - a.y)} {...stroke} />
    case 'circle': {
      // A click without a drag is a point: drawn as a small ring.
      const rx = Math.max(Math.abs(b!.x - a.x), 0.012)
      const ry = Math.max(Math.abs(b!.y - a.y), 0.012)
      return <ellipse cx={a.x} cy={a.y} rx={rx} ry={ry} {...stroke} />
    }
    case 'arrow': {
      const angle = Math.atan2(b!.y - a.y, b!.x - a.x)
      const head = 0.03
      const left = { x: b!.x - head * Math.cos(angle - 0.5), y: b!.y - head * Math.sin(angle - 0.5) }
      const right = { x: b!.x - head * Math.cos(angle + 0.5), y: b!.y - head * Math.sin(angle + 0.5) }
      return (
        <g>
          <line x1={a.x} y1={a.y} x2={b!.x} y2={b!.y} {...stroke} />
          <polyline points={`${left.x},${left.y} ${b!.x},${b!.y} ${right.x},${right.y}`} {...stroke} />
        </g>
      )
    }
    default:
      return null
  }
}
