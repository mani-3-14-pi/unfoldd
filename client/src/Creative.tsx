import { useRef, useState, type PointerEvent } from 'react'
import type { Anchor, ContentFile, Shape } from './api.ts'

/** The client's pin colour; the agency's viewer draws client marks the same way. */
const INK = '#e5484d'
/** Skip pointer moves shorter than this (in 0–1 units), so a stroke stays well under the server's 2000 points. */
const MIN_STEP = 0.004

const clamp = (n: number) => Math.min(1, Math.max(0, n))

/**
 * The creative, one slide at a time, with drawings on top. Points are 0–1 on the slide, so they line up
 * at any size. While `drawing` is on, dragging on the slide adds a pen stroke to the comment being written.
 */
export function Creative({
  files,
  slide,
  onSlide,
  drawing,
  draft,
  onDraw,
  shown,
}: {
  files: ContentFile[]
  slide: number
  onSlide: (i: number) => void
  drawing: boolean
  /** The marks on the comment being written. */
  draft: Anchor | null
  onDraw: (anchor: Anchor) => void
  /** A saved comment's marks, shown when someone picks "Show on creative". */
  shown: Anchor | null
}) {
  const file = files[slide]
  const surface = useRef<SVGSVGElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [stroke, setStroke] = useState<Shape | null>(null)

  if (!file) return null
  const isVideo = !!file.url && !!file.mimeType?.startsWith('video/')
  const drawable = !!file.url && (isVideo || !!file.mimeType?.startsWith('image/'))
  const onThisSlide = (a: Anchor | null) => (a?.versionFile === file.id ? (a.shapes ?? []) : [])

  function at(e: PointerEvent) {
    const r = surface.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) }
  }

  function down(e: PointerEvent<SVGSVGElement>) {
    if (!drawing) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    video.current?.pause()
    setStroke({ type: 'pen', points: [at(e)], color: INK })
  }

  function move(e: PointerEvent<SVGSVGElement>) {
    if (!stroke) return
    const p = at(e)
    const last = stroke.points[stroke.points.length - 1]
    if (stroke.points.length >= 2000 || Math.hypot(p.x - last.x, p.y - last.y) < MIN_STEP) return
    setStroke({ ...stroke, points: [...stroke.points, p] })
  }

  function up() {
    if (!stroke) return
    // Marks belong to one slide (and one moment of a video): drawing somewhere else starts over.
    const same = draft?.versionFile === file.id
    const timeMs = isVideo && video.current ? Math.round(video.current.currentTime * 1000) : undefined
    const shapes = [...(same ? (draft?.shapes ?? []) : []), stroke].slice(-50)
    onDraw({ versionFile: file.id, ...(same && draft?.timeMs != null ? { timeMs: draft.timeMs } : timeMs != null ? { timeMs } : {}), shapes })
    setStroke(null)
  }

  const shapes = [...onThisSlide(shown), ...onThisSlide(draft), ...(stroke ? [stroke] : [])]

  return (
    <div className="creative">
      <div className={`stage${drawing && drawable ? ' drawing' : ''}`}>
        {drawable ? (
          <div className="frame">
            {isVideo ? <video ref={video} src={file.url!} controls={!drawing} /> : <img src={file.url!} alt={file.name ?? ''} draggable={false} />}
            <svg
              ref={surface}
              className="marks"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              style={{ pointerEvents: drawing ? 'auto' : 'none' }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              aria-hidden={!drawing}
              aria-label={drawing ? 'Draw on the creative' : undefined}
            >
              {shapes.map((s, i) => (
                <ShapeView key={i} shape={s} />
              ))}
            </svg>
          </div>
        ) : (
          <div className="file">{file.name ?? 'File'}{file.url ? '' : ' (preview not available)'}</div>
        )}
      </div>
      {drawing && drawable && <p className="draw-hint">Drag on the creative to mark what you mean.</p>}
      {drawing && !drawable && <p className="draw-hint">This file can’t be drawn on. Pick an image or video.</p>}
      {files.length > 1 && (
        <div className="slides" role="tablist" aria-label="Slides">
          {files.map((f, i) => (
            <button key={f.id} type="button" role="tab" aria-selected={i === slide} aria-label={`Slide ${i + 1}`} onClick={() => onSlide(i)}>
              {f.url && f.mimeType?.startsWith('image/') ? <img src={f.url} alt="" /> : <span>{i + 1}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A pen stroke in the 0–1 viewBox. Strokes keep the same width on screen at any size. */
function ShapeView({ shape }: { shape: Shape }) {
  const props = { stroke: shape.color ?? INK, strokeWidth: 3, fill: 'none', vectorEffect: 'non-scaling-stroke' as const, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const [a, b = a] = shape.points
  if (!a) return null
  switch (shape.type) {
    case 'pen':
    case 'highlight':
      return <polyline points={shape.points.map((p) => `${p.x},${p.y}`).join(' ')} {...props} />
    case 'rect':
      return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} {...props} />
    case 'circle':
      return <ellipse cx={a.x} cy={a.y} rx={Math.max(Math.abs(b.x - a.x), 0.012)} ry={Math.max(Math.abs(b.y - a.y), 0.012)} {...props} />
    case 'arrow':
      return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...props} />
    default:
      return null
  }
}
