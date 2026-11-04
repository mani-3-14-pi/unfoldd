import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, LoaderCircle, Pencil } from 'lucide-react'
import { Link } from 'react-router'
import { FormError } from '@/components/FormError'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { SOCIALS, type AudienceData, type Brand, type IntroData, type OnboardingStep, type PersonalityData, type TasteData, type TextData } from '@/features/brand/api'
import { leaning, sectionHint, sectionLabel, stepLabel, tagLabel } from '@/features/brand/labels'
import { clientBrandApi, clientBrandKey, clientOnboardingKey, type ClientEditableSection } from '@/features/client-app/brand/api'
import { AssetsPanel, IntroQuestion, LinksEditor, OfferingsEditor, PersonalityEditor, ReferenceList, TasteEditor } from '@/features/client-app/brand/editors'
import { cleanIntro, EMPTY_INTRO, EMPTY_PERSONALITY, EMPTY_TASTE } from '@/features/client-app/brand/empty'
import { useSectionDraft } from '@/features/client-app/brand/useSectionDraft'
import { useClientSpace } from '@/features/client-app/space'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'

/**
 * F09/F10 Brand DNA, as a hub once onboarding is done (D73): the client's own sections with ✓ and Edit at any
 * time (D41), and the agency's professional layer read-only. Until the agency writes a professional section,
 * it shows the client's own answers in its place (D82).
 */
export function ClientBrandPage() {
  const space = useClientSpace()
  const brand = useQuery({ queryKey: clientBrandKey, queryFn: clientBrandApi.get })
  const onboarding = useQuery({ queryKey: clientOnboardingKey, queryFn: clientBrandApi.onboarding })
  const [editing, setEditing] = useState<ClientEditableSection | null>(null)

  if (brand.isPending || space.isPending) {
    return (
      <div className="grid place-items-center py-24 text-text-3">
        <LoaderCircle className="animate-spin" />
      </div>
    )
  }
  if (brand.isError || space.isError) return <EmptyState title="Couldn’t load your Brand DNA">{errorMessage(brand.error ?? space.error)}</EmptyState>

  const b = brand.data.brand
  const canEdit = space.data.can.editBrand
  const done = (step: OnboardingStep) => !!b.onboarding.steps.find((x) => x.key === step)?.completedAt
  const intro = { ...EMPTY_INTRO, ...(b.sections.intro.data as Partial<IntroData>) }
  const personality = { ...EMPTY_PERSONALITY, ...(b.sections.personality.data as Partial<PersonalityData>) }
  const likes = { ...EMPTY_TASTE, ...(b.sections.likes.data as Partial<TasteData>) }
  const dislikes = { ...EMPTY_TASTE, ...(b.sections.dislikes.data as Partial<TasteData>) }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-[32px] leading-tight text-brand">Brand DNA</h1>
        <p className="mt-1 text-[14px] text-text-2">Everything {space.data.agency.name} knows about {space.data.client.brandName}. Change it any time.</p>
      </header>

      {b.onboarding.mode === 'wizard' && canEdit && (
        <section className="rounded-2xl bg-brand p-5 text-white">
          <p className="text-xs font-semibold tracking-wide uppercase opacity-80">
            Brand setup · {b.onboarding.done} of {b.onboarding.total}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
            <span className="block h-full rounded-full bg-white" style={{ width: `${b.onboarding.percent}%` }} />
          </div>
          <p className="mt-3 text-[15px]">Finish setting up so your agency gets your brand right from the first post.</p>
          <Link to="/c/onboarding" className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-brand">
            {b.onboarding.done ? 'Continue' : 'Start'} <ArrowRight size={16} />
          </Link>
        </section>
      )}

      <SectionCard title={stepLabel.intro} done={done('intro')} updated={b.sections.intro} onEdit={canEdit ? () => setEditing('intro') : undefined}>
        <Answer label="What we do" value={intro.whatWeDo} />
        <Answer label="What we stand for" value={intro.standFor} />
        <Answer label="Who it’s for" value={intro.audience} />
        {intro.offerings.length > 0 && <Answer label="Offerings" value={intro.offerings.map((o) => (o.description ? `${o.name}: ${o.description}` : o.name)).join('\n')} />}
        {(intro.website || SOCIALS.some((s) => intro.socials[s])) && (
          <Answer
            label="Links"
            value={[intro.website, ...SOCIALS.filter((s) => intro.socials[s]).map((s) => `${s}: ${intro.socials[s]}`)].filter(Boolean).join('\n')}
          />
        )}
      </SectionCard>

      <SectionCard title={stepLabel.personality} done={done('personality')} updated={b.sections.personality} onEdit={canEdit ? () => setEditing('personality') : undefined}>
        <ul className="flex flex-col gap-2">
          {b.meta.personalityAxes.map((a) => {
            const v = personality.axes[a.key]
            return (
              <li key={a.key} className="flex items-center gap-3 text-[13px]">
                <span className="w-20 shrink-0 text-text-3">{a.left}</span>
                <span className="relative h-1.5 flex-1 rounded-full bg-surface-input">
                  {v != null && <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand" style={{ left: `${v}%` }} />}
                </span>
                <span className="w-20 shrink-0 text-right text-text-3">{a.right}</span>
              </li>
            )
          })}
        </ul>
        <Answer label="In words" value={personality.keywords || b.meta.personalityAxes.map((a) => leaning(personality.axes[a.key], a.left, a.right)).filter((l) => l !== 'Not set').join(' · ')} />
      </SectionCard>

      {(['likes', 'dislikes'] as const).map((k) => {
        const d = k === 'likes' ? likes : dislikes
        return (
          <SectionCard key={k} title={stepLabel[k]} done={done(k)} updated={b.sections[k]} onEdit={canEdit ? () => setEditing(k) : undefined}>
            {d.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {d.tags.map((t) => (
                  <span key={t} className="rounded-full bg-surface-input px-3 py-1 text-xs">
                    {tagLabel(t)}
                  </span>
                ))}
              </div>
            )}
            <Answer label="Note" value={d.note} />
            <ReferenceList sentiment={k === 'likes' ? 'like' : 'dislike'} canEdit={canEdit} />
          </SectionCard>
        )
      })}

      <Card title={stepLabel.references} description="Mood boards, competitors, past campaigns.">
        <div className="px-5 py-4">
          <ReferenceList sentiment="neutral" canEdit={canEdit} />
        </div>
      </Card>

      <Card title={stepLabel.assets} description="Your brand files live in the library.">
        <div className="flex flex-col gap-4 px-5 py-4">
          <AssetsPanel canUpload={space.data.can.upload} requests={onboarding.data?.assetRequests ?? []} />
          <Link to="/c/library" className="self-start text-[13px] font-medium text-brand hover:underline">
            Open the library
          </Link>
        </div>
      </Card>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">From {space.data.agency.name}</h2>
          <p className="text-[13px] text-text-3">Built by your agency from your answers. Ask them in Messages if something’s off.</p>
        </div>
        <ProfessionalCard title={sectionLabel.audience} hint={sectionHint.audience} section={b.sections.audience} fallback={intro.audience}>
          {(data) => {
            const a = data as Partial<AudienceData>
            return (
              <>
                <Answer label="Primary" value={a.primary} />
                <Answer label="Secondary" value={a.secondary} />
                <Answer label="Age" value={a.age} />
                <Answer label="Location" value={a.location} />
                <Answer label="Behaviour" value={a.behaviour} />
                <Answer label="Interests" value={a.interests} />
              </>
            )
          }}
        </ProfessionalCard>
        <ProfessionalCard title={sectionLabel.positioning} hint={sectionHint.positioning} section={b.sections.positioning} fallback={[intro.whatWeDo, intro.standFor].filter(Boolean).join('\n\n')}>
          {(data) => <Answer value={(data as Partial<TextData>).text} />}
        </ProfessionalCard>
        <ProfessionalCard title={sectionLabel.tone} hint={sectionHint.tone} section={b.sections.tone} fallback={personality.keywords}>
          {(data) => <Answer value={(data as Partial<TextData>).text} />}
        </ProfessionalCard>
        <ProfessionalCard
          title={sectionLabel.visualIdentity}
          hint={sectionHint.visualIdentity}
          section={b.sections.visualIdentity}
          fallback={[likes.tags.length ? `Likes: ${likes.tags.map(tagLabel).join(', ')}` : '', dislikes.tags.length ? `Avoid: ${dislikes.tags.map(tagLabel).join(', ')}` : ''].filter(Boolean).join('\n')}
        >
          {(data) => <Answer value={(data as Partial<TextData>).text} />}
        </ProfessionalCard>
      </section>

      {editing && <EditSheet brand={b} section={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function SectionCard({
  title,
  done,
  updated,
  onEdit,
  children,
}: {
  title: string
  done: boolean
  updated: Brand['sections'][keyof Brand['sections']]
  onEdit?: () => void
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface">
      <header className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className={cn('grid size-7 shrink-0 place-items-center rounded-full', done ? 'bg-green-soft text-green-ink' : 'border border-border-strong text-text-4')} aria-label={done ? 'Done' : 'Not done yet'}>
          {done && <Check size={15} strokeWidth={2.4} />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {updated.updatedAt && (
            <p className="text-[11px] text-text-4">
              Updated {timeAgo(updated.updatedAt)}
              {updated.updatedBy ? ` by ${updated.updatedBy.name}` : ''}
            </p>
          )}
        </div>
        {onEdit && (
          <Button size="sm" onClick={onEdit}>
            <Pencil size={13} /> Edit
          </Button>
        )}
      </header>
      <div className="flex flex-col gap-3 px-5 py-4">{children}</div>
    </section>
  )
}

function ProfessionalCard({
  title,
  hint,
  section,
  fallback,
  children,
}: {
  title: string
  hint?: string
  section: Brand['sections'][keyof Brand['sections']]
  fallback: string
  children: (data: Record<string, unknown>) => ReactNode
}) {
  const written = Object.values(section.data ?? {}).some((v) => (typeof v === 'string' ? v.trim() : v))
  return (
    <section className="rounded-2xl border border-border bg-white px-5 py-4">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {hint && <p className="text-xs text-text-4">{hint}</p>}
      <div className="mt-3 flex flex-col gap-2">
        {written ? (
          children(section.data as Record<string, unknown>)
        ) : (
          <>
            <p className="text-xs text-text-3">Not written yet. For now, from your answers:</p>
            <Answer value={fallback || 'Nothing yet.'} />
          </>
        )}
      </div>
    </section>
  )
}

function Answer({ label, value }: { label?: string; value?: string }) {
  if (!value?.trim()) return label ? null : <p className="text-[14px] text-text-4">—</p>
  return (
    <div>
      {label && <p className="text-xs text-text-3">{label}</p>}
      <p className="text-[14px] whitespace-pre-line text-text">{value}</p>
    </div>
  )
}

/** Edit one of the client's own sections. A stale save offers Reload (someone else changed it, D41). */
function EditSheet({ brand, section, onClose }: { brand: Brand; section: ClientEditableSection; onClose: () => void }) {
  const intro = useSectionDraft<IntroData>(brand, 'intro', EMPTY_INTRO, cleanIntro)
  const personality = useSectionDraft<PersonalityData>(brand, 'personality', EMPTY_PERSONALITY)
  const likes = useSectionDraft<TasteData>(brand, 'likes', EMPTY_TASTE)
  const dislikes = useSectionDraft<TasteData>(brand, 'dislikes', EMPTY_TASTE)
  const draft = { intro, personality, likes, dislikes }[section]

  const save = async () => {
    try {
      await draft.save.mutateAsync()
      toast(`${stepLabel[section]} saved`)
      onClose()
    } catch {
      // Shown below the form, with Reload for a stale save.
    }
  }

  return (
    <Dialog
      title={`Edit ${stepLabel[section].toLowerCase()}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={draft.save.isPending} disabled={!draft.dirty} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {section === 'intro' && (
          <>
            <IntroQuestion id="edit-whatWeDo" label="What does your brand do?" hint="As you’d tell a new customer." value={intro.data.whatWeDo} onChange={(v) => intro.update({ whatWeDo: v })} />
            <IntroQuestion id="edit-standFor" label="What does it stand for?" hint="Your values and promise." value={intro.data.standFor} onChange={(v) => intro.update({ standFor: v })} />
            <IntroQuestion id="edit-audience" label="Who is it for?" hint="The people you most want to reach." value={intro.data.audience} onChange={(v) => intro.update({ audience: v })} />
            <div>
              <h3 className="mb-2 text-xs font-medium text-text-2">Offerings</h3>
              <OfferingsEditor value={intro.data.offerings} onChange={(offerings) => intro.update({ offerings })} />
            </div>
            <LinksEditor value={intro.data} onChange={(patch) => intro.update(patch)} />
          </>
        )}
        {section === 'personality' && <PersonalityEditor axes={brand.meta.personalityAxes} value={personality.data} onChange={(patch) => personality.update(patch)} />}
        {section === 'likes' && <TasteEditor tags={brand.meta.styleTags} value={likes.data} onChange={(patch) => likes.update(patch)} sentiment="like" />}
        {section === 'dislikes' && <TasteEditor tags={brand.meta.styleTags} value={dislikes.data} onChange={(patch) => dislikes.update(patch)} sentiment="dislike" />}
        {draft.save.isError && <FormError error={draft.save.error} onReload={() => void draft.reload().catch((err: unknown) => toast(errorMessage(err), 'error'))} />}
      </div>
    </Dialog>
  )
}

