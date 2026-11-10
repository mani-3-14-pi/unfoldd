import { useEffect, useState, type ReactNode } from 'react'
import {
  ApiError,
  brand as brandApi,
  canEditBrand,
  type AssetRequest,
  type Brand,
  type BrandReference,
  type ClientSection,
  type IntroData,
  type Me,
  type Onboarding,
  type OnboardingStep,
  type PersonalityData,
  type StyleData,
} from './api.ts'
import { fmtDate, titleCase } from './format.ts'
import { useDebouncedAction } from './useDebouncedAction.ts'

const STEPS: { key: OnboardingStep; title: string; hint: string }[] = [
  { key: 'intro', title: 'About your brand', hint: 'What you do, what you stand for, and who you’re for.' },
  { key: 'personality', title: 'Personality', hint: 'Where your brand sits between a few opposites.' },
  { key: 'likes', title: 'Styles you love', hint: 'The looks and moods that feel like you.' },
  { key: 'dislikes', title: 'Styles to avoid', hint: 'What should never show up in your content.' },
  { key: 'references', title: 'References', hint: 'Links to posts, brands or pages you like (or don’t).' },
  { key: 'assets', title: 'Brand assets', hint: 'Logos, fonts and photos your agency has asked for.' },
]

const SOCIALS: { key: keyof Omit<IntroData['socials'], 'other'>; label: string }[] = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'x', label: 'X' },
  { key: 'tiktok', label: 'TikTok' },
]

/** "velvetoven.com" → "https://velvetoven.com", so a bare domain still passes the server's URL check. */
const withScheme = (s: string) => {
  const v = s.trim()
  return !v || /^https?:\/\//i.test(v) ? v : `https://${v}`
}

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

export function BrandPage({ me }: { me: Me }) {
  const [brand, setBrand] = useState<Brand | null>(null)
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null)
  const [assets, setAssets] = useState<AssetRequest[]>([])
  const [error, setError] = useState<string | null>(null)
  const [openStep, setOpenStep] = useState<OnboardingStep | null>(null)
  const canEdit = canEditBrand(me.role)

  async function load() {
    try {
      const [{ brand: b }, o] = await Promise.all([brandApi.get(), brandApi.onboarding()])
      setBrand(b)
      setOnboarding(o.onboarding)
      setAssets(o.assetRequests)
      return o.onboarding
    } catch (err) {
      setError(errorText(err, 'Could not load your Brand DNA.'))
      return null
    }
  }

  useEffect(() => {
    void load().then((o) => {
      // Open the first step still to do, so the client can start right away.
      if (o && canEdit) setOpenStep(o.steps.find((s) => !s.completedAt)?.key ?? null)
    })
  }, [])

  if (!brand || !onboarding) {
    return error ? <div className="error">{error}</div> : <p className="empty">Loading…</p>
  }

  const isDone = (k: OnboardingStep) => !!onboarding.steps.find((s) => s.key === k)?.completedAt

  /** After a step is finished: record it, then move on to the next one still open. */
  async function finish(step: OnboardingStep) {
    const { onboarding: o } = await brandApi.complete(step)
    setOnboarding(o)
    const next = STEPS.find((s) => s.key !== step && !o.steps.find((x) => x.key === s.key)?.completedAt)
    setOpenStep(next?.key ?? null)
  }

  function saved<K extends ClientSection>(section: K, next: Brand['sections'][K]) {
    setBrand((b) => (b ? { ...b, sections: { ...b.sections, [section]: next } } : b))
  }

  const sectionProps = { canEdit, onSaved: saved, onFinish: finish, onReload: load }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Brand DNA</h1>
          <p className="sub">Your agency uses this for every post they make for you. Change it any time.</p>
        </div>
      </div>

      <div className="card progress-card">
        <div className="row">
          <p className="title">{onboarding.done === onboarding.total ? 'All sections done' : `${onboarding.done} of ${onboarding.total} sections done`}</p>
          <span className="meta">{onboarding.percent}%</span>
        </div>
        <div className="progress"><span style={{ width: `${onboarding.percent}%` }} /></div>
        {!canEdit && <p className="meta">Your role can view the Brand DNA but not change it. Ask an admin on your team.</p>}
      </div>

      <ol className="steps">
        {STEPS.map((s, i) => (
          <Step
            key={s.key}
            number={i + 1}
            title={s.title}
            hint={s.hint}
            done={isDone(s.key)}
            open={openStep === s.key}
            onToggle={() => setOpenStep(openStep === s.key ? null : s.key)}
          >
            {s.key === 'intro' && <IntroForm state={brand.sections.intro} {...sectionProps} />}
            {s.key === 'personality' && <PersonalityForm state={brand.sections.personality} axes={brand.meta.personalityAxes} {...sectionProps} />}
            {(s.key === 'likes' || s.key === 'dislikes') && <StyleForm section={s.key} state={brand.sections[s.key]} tags={brand.meta.styleTags} {...sectionProps} />}
            {s.key === 'references' && <References canEdit={canEdit} me={me} done={isDone('references')} onFinish={finish} />}
            {s.key === 'assets' && <Assets canEdit={canEdit} items={assets} done={isDone('assets')} onFinish={finish} />}
          </Step>
        ))}
      </ol>

      <AgencyLayer brand={brand} />
    </div>
  )
}

function Step(props: { number: number; title: string; hint: string; done: boolean; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <li className={`card step ${props.open ? 'open' : ''}`}>
      <button type="button" className="step-head" aria-expanded={props.open} onClick={props.onToggle}>
        <span className={`step-num ${props.done ? 'done' : ''}`} aria-hidden>{props.done ? '✓' : props.number}</span>
        <span className="step-text">
          <span className="title">{props.title}</span>
          <span className="meta">{props.hint}</span>
        </span>
        <span className={`pill ${props.done ? 'approved' : 'neutral'}`}>{props.done ? 'Done' : 'To do'}</span>
      </button>
      {props.open && <div className="step-body">{props.children}</div>}
    </li>
  )
}

interface SectionProps {
  canEdit: boolean
  onSaved: <K extends ClientSection>(section: K, next: Brand['sections'][K]) => void
  onFinish: (step: OnboardingStep) => Promise<void>
  onReload: () => Promise<unknown>
}

/** Save + mark done, with the shared busy / error / "someone else changed it" handling. */
function useSave<T>(section: ClientSection, rev: number, { onSaved, onFinish, onReload }: SectionProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const debounce = useDebouncedAction()

  const save = debounce(async (data: T) => {
    setBusy(true)
    setError(null)
    setStale(false)
    try {
      const { section: next } = await brandApi.save(section, rev, data)
      onSaved(section, next as never)
      await onFinish(section)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'stale') setStale(true)
      setError(errorText(err, 'Could not save. Please try again.'))
    } finally {
      setBusy(false)
    }
  })

  const footer = (canEdit: boolean, disabled = false) =>
    canEdit && (
      <>
        {error && (
          <div className="error">
            {error}
            {stale && (
              <button type="button" className="link-btn" onClick={() => void onReload().then(() => { setError(null); setStale(false) })}>
                Reload
              </button>
            )}
          </div>
        )}
        <div className="actions">
          <button type="submit" className="btn" disabled={busy || disabled}>{busy ? 'Saving…' : 'Save and continue'}</button>
        </div>
      </>
    )

  return { save, footer }
}

function UpdatedBy({ state }: { state: { updatedBy?: { name: string; side: string }; updatedAt?: string } }) {
  if (!state.updatedBy?.name) return null
  return <p className="meta">Last updated by {state.updatedBy.side === 'agency' ? `${state.updatedBy.name} (agency)` : state.updatedBy.name} on {fmtDate(state.updatedAt)}</p>
}

function IntroForm({ state, ...props }: SectionProps & { state: Brand['sections']['intro'] }) {
  const d = state.data
  const [whatWeDo, setWhatWeDo] = useState(d.whatWeDo ?? '')
  const [standFor, setStandFor] = useState(d.standFor ?? '')
  const [audience, setAudience] = useState(d.audience ?? '')
  const [website, setWebsite] = useState(d.website ?? '')
  const [socials, setSocials] = useState<IntroData['socials']>({ instagram: '', facebook: '', linkedin: '', youtube: '', x: '', tiktok: '', other: [], ...d.socials })
  const [offerings, setOfferings] = useState<IntroData['offerings']>(d.offerings ?? [])
  const { save, footer } = useSave<IntroData>('intro', state.rev, props)
  const ro = !props.canEdit

  const setOffering = (i: number, patch: Partial<IntroData['offerings'][number]>) => setOfferings((o) => o.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save({
          whatWeDo,
          standFor,
          audience,
          website: withScheme(website),
          socials,
          offerings: offerings.filter((o) => o.name.trim()).map((o) => ({ name: o.name.trim(), description: o.description.trim() })),
        })
      }}
    >
      <UpdatedBy state={state} />
      <Field id="b-what" label="What does your brand do?" hint="One or two sentences, in your own words.">
        <textarea id="b-what" maxLength={500} disabled={ro} value={whatWeDo} onChange={(e) => setWhatWeDo(e.target.value)} placeholder="We bake small-batch breads and cakes for…" />
      </Field>
      <Field id="b-stand" label="What do you stand for?">
        <textarea id="b-stand" maxLength={500} disabled={ro} value={standFor} onChange={(e) => setStandFor(e.target.value)} placeholder="Real ingredients, no shortcuts…" />
      </Field>
      <Field id="b-aud" label="Who are your customers?">
        <textarea id="b-aud" maxLength={500} disabled={ro} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Young families in the city who…" />
      </Field>

      <div className="field">
        <label>Products or services</label>
        {offerings.length === 0 && <p className="meta">Add the main things you sell, so posts can feature them.</p>}
        {offerings.map((o, i) => (
          <div className="offering" key={i}>
            <input aria-label="Name" maxLength={100} disabled={ro} value={o.name} onChange={(e) => setOffering(i, { name: e.target.value })} placeholder="Name" />
            <input aria-label="Short description" maxLength={300} disabled={ro} value={o.description} onChange={(e) => setOffering(i, { description: e.target.value })} placeholder="Short description (optional)" />
            {!ro && <button type="button" className="btn ghost sm" aria-label={`Remove ${o.name || 'item'}`} onClick={() => setOfferings((x) => x.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        ))}
        {!ro && offerings.length < 30 && (
          <div>
            <button type="button" className="btn ghost sm" onClick={() => setOfferings((x) => [...x, { name: '', description: '' }])}>+ Add a product or service</button>
          </div>
        )}
      </div>

      <Field id="b-web" label="Website">
        <input id="b-web" inputMode="url" maxLength={480} disabled={ro} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="yourbrand.com" />
      </Field>
      <div className="field">
        <label>Social accounts</label>
        <div className="grid-2">
          {SOCIALS.map((s) => (
            <input
              key={s.key}
              aria-label={s.label}
              maxLength={200}
              disabled={ro}
              value={socials[s.key]}
              onChange={(e) => setSocials((x) => ({ ...x, [s.key]: e.target.value }))}
              placeholder={`${s.label} handle or link`}
            />
          ))}
        </div>
      </div>
      {footer(props.canEdit)}
    </form>
  )
}

function PersonalityForm({ state, axes, ...props }: SectionProps & { state: Brand['sections']['personality']; axes: Brand['meta']['personalityAxes'] }) {
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(axes.map((a) => [a.key, state.data.axes?.[a.key] ?? 50])))
  const [keywords, setKeywords] = useState(state.data.keywords ?? '')
  const { save, footer } = useSave<PersonalityData>('personality', state.rev, props)

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save({ axes: values, keywords }) }}>
      <UpdatedBy state={state} />
      <p className="meta">Drag each slider towards the side that sounds more like you. The middle means “a bit of both”.</p>
      {axes.map((a) => {
        const v = values[a.key]
        const lean = v < 40 ? a.left : v > 60 ? a.right : 'Balanced'
        return (
          <div className="slider" key={a.key}>
            <div className="slider-labels">
              <span className={v < 40 ? 'strong' : ''}>{a.left}</span>
              <span className="lean">{lean}</span>
              <span className={v > 60 ? 'strong' : ''}>{a.right}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              aria-label={`${a.left} to ${a.right}`}
              disabled={!props.canEdit}
              value={v}
              onChange={(e) => setValues((x) => ({ ...x, [a.key]: Number(e.target.value) }))}
            />
          </div>
        )
      })}
      <Field id="b-kw" label="Three to five words that describe your brand">
        <input id="b-kw" maxLength={200} disabled={!props.canEdit} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Warm, honest, homemade" />
      </Field>
      {footer(props.canEdit)}
    </form>
  )
}

function StyleForm({ section, state, tags, ...props }: SectionProps & { section: 'likes' | 'dislikes'; state: Brand['sections']['likes']; tags: string[] }) {
  const [picked, setPicked] = useState<string[]>(state.data.tags ?? [])
  const [note, setNote] = useState(state.data.note ?? '')
  const { save, footer } = useSave<StyleData>(section, state.rev, props)
  const toggle = (t: string) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]))

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save({ tags: picked, note }) }}>
      <UpdatedBy state={state} />
      <p className="meta">{section === 'likes' ? 'Pick every style that feels like your brand.' : 'Pick any style that does not fit your brand.'}</p>
      <div className="chips" role="group" aria-label={section === 'likes' ? 'Styles you love' : 'Styles to avoid'}>
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            className={`chip ${picked.includes(t) ? (section === 'likes' ? 'on' : 'on-avoid') : ''}`}
            aria-pressed={picked.includes(t)}
            disabled={!props.canEdit}
            onClick={() => toggle(t)}
          >
            {titleCase(t)}
          </button>
        ))}
      </div>
      <Field id={`b-${section}-note`} label="Anything to add? (optional)">
        <input
          id={`b-${section}-note`}
          maxLength={200}
          disabled={!props.canEdit}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={section === 'likes' ? 'Lots of natural light, close-ups of food' : 'No neon colours, no stock photos'}
        />
      </Field>
      {footer(props.canEdit)}
    </form>
  )
}

const SENTIMENTS: { key: BrandReference['sentiment']; label: string }[] = [
  { key: 'like', label: 'I like this' },
  { key: 'dislike', label: 'Avoid this' },
  { key: 'neutral', label: 'Just for context' },
]

function References({ canEdit, me, done, onFinish }: { canEdit: boolean; me: Me; done: boolean; onFinish: (s: OnboardingStep) => Promise<void> }) {
  const [items, setItems] = useState<BrandReference[] | null>(null)
  const [link, setLink] = useState('')
  const [note, setNote] = useState('')
  const [sentiment, setSentiment] = useState<BrandReference['sentiment']>('like')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // "Done" right after "Add reference" is a separate intent, so it gets its own debounce window.
  const debounce = useDebouncedAction()
  const debounceDone = useDebouncedAction()

  const load = () => brandApi.references().then((r) => setItems(r.items)).catch((err) => setError(errorText(err, 'Could not load references.')))
  useEffect(() => {
    void load()
  }, [])

  async function attempt(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(errorText(err, 'That did not work. Please try again.'))
    } finally {
      setBusy(false)
    }
  }
  const run = debounce(attempt)
  const runDone = debounceDone(attempt)

  const add = () =>
    run(async () => {
      await brandApi.addReference(sentiment, withScheme(link), note.trim())
      setLink('')
      setNote('')
      await load()
    })

  return (
    <div>
      {items === null && !error && <p className="empty small">Loading…</p>}
      {items?.length === 0 && <p className="meta">No references yet. Paste links to posts, websites or brands that inspire you.</p>}
      {items && items.length > 0 && (
        <ul className="refs">
          {items.map((r) => (
            <li key={r._id} className="ref">
              {r.imageUrl && <img src={r.imageUrl} alt="" />}
              <div className="ref-text">
                <span className={`pill ${r.sentiment === 'like' ? 'approved' : r.sentiment === 'dislike' ? 'changes_requested' : 'neutral'}`}>
                  {SENTIMENTS.find((s) => s.key === r.sentiment)?.label}
                </span>
                {r.link && <a href={r.link} target="_blank" rel="noreferrer" className="ref-link">{r.link.replace(/^https?:\/\//, '')}</a>}
                {r.note && <span className="meta">{r.note}</span>}
                <span className="meta">Added by {r.addedBy.side === 'agency' ? `${r.addedBy.name} (agency)` : r.addedBy.name}</span>
              </div>
              {canEdit && r.addedBy.id === me.user.id && (
                <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => { await brandApi.removeReference(r._id); await load() })}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <div className="error">{error}</div>}
      {canEdit && (
        <form className="ref-form" onSubmit={(e) => { e.preventDefault(); if (link.trim()) add() }}>
          <div className="grid-2">
            <Field id="r-link" label="Link">
              <input id="r-link" inputMode="url" maxLength={1000} value={link} onChange={(e) => setLink(e.target.value)} placeholder="instagram.com/p/…" />
            </Field>
            <Field id="r-kind" label="This is something…">
              <select id="r-kind" value={sentiment} onChange={(e) => setSentiment(e.target.value as BrandReference['sentiment'])}>
                {SENTIMENTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Field>
          </div>
          <Field id="r-note" label="Why? (optional)">
            <input id="r-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Love the colours and the calm feel" />
          </Field>
          <div className="actions">
            <button type="submit" className="btn ghost" disabled={busy || !link.trim()}>Add reference</button>
            {!done && (
              <button type="button" className="btn" disabled={busy} onClick={() => runDone(() => onFinish('references'))}>
                {items?.length ? 'Done' : 'Nothing to add'}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  )
}

function Assets({ canEdit, items, done, onFinish }: { canEdit: boolean; items: AssetRequest[]; done: boolean; onFinish: (s: OnboardingStep) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = items.filter((a) => a.status === 'open').length

  return (
    <div>
      {items.length === 0 ? (
        <p className="meta">Your agency hasn’t asked for any files yet. When they do, the requests show up here and in Tasks.</p>
      ) : (
        <>
          <p className="meta">{open ? `${open} still to send. Answer them in Tasks.` : 'Everything your agency asked for has been sent.'}</p>
          <ul className="asset-list">
            {items.map((a) => (
              <li key={a._id} className="row">
                <span>{a.title}</span>
                <span className={`pill ${a.status === 'open' ? 'open' : 'completed'}`}>{a.status === 'open' ? 'To send' : a.status === 'submitted' ? 'Sent' : 'Done'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <div className="error">{error}</div>}
      <div className="actions">
        {open > 0 && <a className="btn ghost" href="#/tasks">Go to Tasks</a>}
        {canEdit && !done && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onFinish('assets')
              } catch (err) {
                setError(errorText(err, 'Could not save. Please try again.'))
              } finally {
                setBusy(false)
              }
            }}
          >
            Mark as done
          </button>
        )}
      </div>
    </div>
  )
}

/** The agency's professional write-up, read-only for the client. Hidden until the agency has written something. */
function AgencyLayer({ brand }: { brand: Brand }) {
  const s = brand.sections
  const audience = s.audience?.data ?? {}
  const parts = [
    { title: 'Audience', body: [audience.primary, audience.secondary, audience.age && `Age: ${audience.age}`, audience.location && `Location: ${audience.location}`, audience.behaviour, audience.interests].filter(Boolean).join('\n') },
    { title: 'Positioning', body: s.positioning?.data?.text ?? '' },
    { title: 'Tone of voice', body: s.tone?.data?.text ?? '' },
    { title: 'Visual identity', body: s.visualIdentity?.data?.text ?? '' },
  ].filter((p) => p.body.trim())
  if (!parts.length) return null

  return (
    <section className="group">
      <h2 className="group-title">From your agency</h2>
      <p className="meta" style={{ marginBottom: 10 }}>How your agency sums up your brand, based on your answers. Something off? Tell them in a comment or task.</p>
      <div className="card">
        {parts.map((p) => (
          <div key={p.title} className="agency-part">
            <p className="title">{p.title}</p>
            <p className="body-text">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <span className="hint">{hint}</span>}
      {children}
    </div>
  )
}
