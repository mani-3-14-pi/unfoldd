import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, ClipboardCheck, FolderOpen, LoaderCircle, MessagesSquare, PartyPopper, Sparkles } from 'lucide-react'
import { Link, Navigate, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { buttonClass } from '@/components/ui/buttonClass'
import { EmptyState } from '@/components/ui/Card'
import { useClientSession } from '@/features/agency/session'
import { ONBOARDING_STEPS, type Brand, type IntroData, type Onboarding, type OnboardingStep, type PersonalityData, type TasteData } from '@/features/brand/api'
import { stepLabel } from '@/features/brand/labels'
import { clientBrandApi, clientBrandKey, clientOnboardingKey, type AssetRequest } from '@/features/client-app/brand/api'
import { AssetsPanel, IntroQuestion, LinksEditor, OfferingsEditor, PersonalityEditor, ReferenceList, TasteEditor } from '@/features/client-app/brand/editors'
import { cleanIntro, EMPTY_INTRO, EMPTY_PERSONALITY, EMPTY_TASTE, introReady } from '@/features/client-app/brand/empty'
import { useSectionDraft } from '@/features/client-app/brand/useSectionDraft'
import { useClientSpace } from '@/features/client-app/space'
import { isStale } from '@/lib/api'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'

/** Every screen of the first-time wizard, in order (D72/D73). Welcome and "What you can do" aren't steps. */
const SCREENS = [
  'welcome',
  'capabilities',
  'intro.whatWeDo',
  'intro.standFor',
  'intro.audience',
  'intro.offerings',
  'intro.links',
  'personality',
  'likes',
  'dislikes',
  'references',
  'assets',
  'done',
] as const
type Screen = (typeof SCREENS)[number]

const stepOf = (screen: Screen) => screen.split('.')[0] as OnboardingStep | 'welcome' | 'capabilities' | 'done'
const firstScreenOf = (step: OnboardingStep) => SCREENS.findIndex((s) => stepOf(s) === step)

/**
 * The first-time onboarding (F02–F08): a linear wizard through the six Brand DNA sections. Each screen saves as
 * you go; a section counts as done when the client taps Done (or "Nothing to add"), so nobody gets stuck at 83%.
 * Afterwards the Brand DNA page is the hub for editing (D73).
 */
export function ClientOnboardingPage() {
  const space = useClientSpace()
  const brand = useQuery({ queryKey: clientBrandKey, queryFn: clientBrandApi.get })
  const onboarding = useQuery({ queryKey: clientOnboardingKey, queryFn: clientBrandApi.onboarding })

  if (brand.isPending || onboarding.isPending || space.isPending) {
    return (
      <div className="grid place-items-center py-24 text-text-3">
        <LoaderCircle className="animate-spin" />
      </div>
    )
  }
  if (brand.isError || onboarding.isError || space.isError) {
    return <EmptyState title="Couldn’t open your brand setup">{errorMessage(brand.error ?? onboarding.error ?? space.error)}</EmptyState>
  }
  // Viewers can look at the Brand DNA but not fill it in.
  if (!space.data.can.editBrand) return <Navigate to="/c/brand" replace />

  return <Wizard brand={brand.data.brand} onboarding={onboarding.data.onboarding} assetRequests={onboarding.data.assetRequests} />
}

function Wizard({ brand, onboarding, assetRequests }: { brand: Brand; onboarding: Onboarding; assetRequests: AssetRequest[] }) {
  const s = useClientSession()
  const space = useClientSpace()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const doneSteps = new Set(onboarding.steps.filter((x) => x.completedAt).map((x) => x.key))

  // Pick up where they left off: the first section not yet done, or the welcome if nothing is.
  const [index, setIndex] = useState(() => {
    if (doneSteps.size === 0) return 0
    const next = ONBOARDING_STEPS.find((k) => !doneSteps.has(k))
    return next ? firstScreenOf(next) : SCREENS.indexOf('done')
  })
  const screen = SCREENS[index]!
  const step = stepOf(screen)

  const intro = useSectionDraft<IntroData>(brand, 'intro', EMPTY_INTRO, cleanIntro)
  const personality = useSectionDraft<PersonalityData>(brand, 'personality', EMPTY_PERSONALITY)
  const likes = useSectionDraft<TasteData>(brand, 'likes', EMPTY_TASTE)
  const dislikes = useSectionDraft<TasteData>(brand, 'dislikes', EMPTY_TASTE)
  const drafts = { intro, personality, likes, dislikes } as const
  const draft = step in drafts ? drafts[step as keyof typeof drafts] : null

  const complete = useMutation({
    mutationFn: (key: OnboardingStep) => clientBrandApi.complete(key),
    onSuccess: ({ onboarding: next }) => {
      qc.setQueryData<{ onboarding: Onboarding; assetRequests: AssetRequest[] }>(clientOnboardingKey, (old) => (old ? { ...old, onboarding: next } : old))
      void qc.invalidateQueries({ queryKey: clientBrandKey })
    },
  })

  const go = (to: number) => {
    setIndex(to)
    window.scrollTo({ top: 0 })
  }

  /** Next: save this screen's section if it changed; on a section's last screen, mark the section done. */
  const next = async (finishStep = false) => {
    try {
      await draft?.saveIfDirty()
      if (finishStep && step !== 'welcome' && step !== 'capabilities' && step !== 'done') await complete.mutateAsync(step)
      go(index + 1)
    } catch (err) {
      if (isStale(err)) {
        toast(`${errorMessage(err)}`, 'error')
        await draft?.reload()
      } else toast(errorMessage(err), 'error')
    }
  }

  const sectionIndex = ONBOARDING_STEPS.indexOf(step as OnboardingStep)
  const introScreens = SCREENS.filter((x) => x.startsWith('intro.'))
  const busy = complete.isPending || !!draft?.save.isPending
  const brandName = s.client.brandName

  const footer = (primary: ReactNode, secondary?: ReactNode) => (
    <div className="sticky bottom-20 z-10 mt-8 flex items-center gap-3 rounded-2xl border border-border-strong bg-white/95 p-3 shadow-lg backdrop-blur">
      {index > 0 && screen !== 'done' ? (
        <button type="button" onClick={() => go(index - 1)} aria-label="Back" className="grid size-11 shrink-0 place-items-center rounded-xl text-text-2 hover:bg-black/5">
          <ArrowLeft size={20} />
        </button>
      ) : (
        <span />
      )}
      <div className="ml-auto flex items-center gap-2">
        {secondary}
        {primary}
      </div>
    </div>
  )
  const primaryClass = 'h-11 px-5 text-sm'

  let body: ReactNode
  switch (screen) {
    case 'welcome':
      body = (
        <Intro icon={<Sparkles size={26} />} title="Your brand. Our creative home." text={`${s.agency.name} uses Unfoldd to make your content with you. A few minutes here helps them get your brand right from the first post.`}>
          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-border-strong bg-white p-4">
            <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-input text-sm font-semibold">
              {space.data?.client.logoUrl ? <img src={space.data.client.logoUrl} alt="" className="size-full object-cover" /> : brandName.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <span className="block font-semibold">{brandName}</span>
              <span className="block text-[13px] text-text-3">with {s.agency.name}</span>
            </span>
          </div>
          {footer(
            <Button variant="primary" className={primaryClass} onClick={() => go(index + 1)}>
              Let’s start
            </Button>,
          )}
        </Intro>
      )
      break
    case 'capabilities':
      body = (
        <Intro icon={<ClipboardCheck size={26} />} title="What you can do here">
          <ul className="mt-5 flex flex-col gap-3">
            {[
              [ClipboardCheck, 'See the plan and review content', 'Comment right on the creative, then approve or ask for changes.'],
              [FolderOpen, 'Share what’s needed', 'Upload logos, photos and anything your agency asks for.'],
              [MessagesSquare, 'Talk to your team', 'Message the people making your content, in one place.'],
            ].map(([Icon, title, text]) => {
              const I = Icon as typeof ClipboardCheck
              return (
                <li key={title as string} className="flex gap-3 rounded-2xl border border-border-strong bg-white p-4">
                  <I size={20} className="mt-0.5 shrink-0 text-brand" />
                  <span>
                    <span className="block text-[15px] font-semibold">{title as string}</span>
                    <span className="block text-[13px] text-text-3">{text as string}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          {footer(
            <Button variant="primary" className={primaryClass} onClick={() => go(index + 1)}>
              Set up my brand
            </Button>,
          )}
        </Intro>
      )
      break
    case 'intro.whatWeDo':
    case 'intro.standFor':
    case 'intro.audience': {
      const field = screen.split('.')[1] as 'whatWeDo' | 'standFor' | 'audience'
      const copy = {
        whatWeDo: ['What does your brand do?', 'In your own words, as you’d tell a new customer.'],
        standFor: ['What does it stand for?', 'Your values, your promise, why you exist.'],
        audience: ['Who is it for?', 'The people you most want to reach.'],
      }[field]
      body = (
        <Step n={sectionIndex + 1} title={stepLabel.intro} sub={`${introScreens.indexOf(screen) + 1} of ${introScreens.length}`}>
          <IntroQuestion id={`intro-${field}`} label={copy[0]} hint={copy[1]} value={intro.data[field]} onChange={(v) => intro.update({ [field]: v } as Partial<IntroData>)} />
          {footer(
            <Button variant="primary" className={primaryClass} loading={busy} disabled={!intro.data[field].trim()} onClick={() => void next()}>
              Next
            </Button>,
          )}
        </Step>
      )
      break
    }
    case 'intro.offerings':
      body = (
        <Step n={sectionIndex + 1} title={stepLabel.intro} sub={`${introScreens.indexOf(screen) + 1} of ${introScreens.length}`}>
          <h2 className="mb-1 text-lg font-semibold">What do you offer?</h2>
          <p className="mb-4 text-[13px] text-text-3">Products or services, as many as you like. Optional.</p>
          <OfferingsEditor value={intro.data.offerings} onChange={(offerings) => intro.update({ offerings })} />
          {footer(
            <Button variant="primary" className={primaryClass} loading={busy} onClick={() => void next()}>
              Next
            </Button>,
          )}
        </Step>
      )
      break
    case 'intro.links':
      body = (
        <Step n={sectionIndex + 1} title={stepLabel.intro} sub={`${introScreens.indexOf(screen) + 1} of ${introScreens.length}`}>
          <h2 className="mb-1 text-lg font-semibold">Where can we find you?</h2>
          <p className="mb-4 text-[13px] text-text-3">Your website and social accounts. Optional.</p>
          <LinksEditor value={intro.data} onChange={(patch) => intro.update(patch)} />
          {!introReady(intro.data) && <p className="mt-4 text-[13px] text-amber-ink">Answer the first three questions to finish this section.</p>}
          {footer(
            <Button variant="primary" className={primaryClass} loading={busy} disabled={!introReady(intro.data)} onClick={() => void next(true)}>
              <Check size={16} /> Done
            </Button>,
          )}
        </Step>
      )
      break
    case 'personality':
      body = (
        <Step n={sectionIndex + 1} title={stepLabel.personality} sub="Where does your brand sit between each pair?">
          <PersonalityEditor axes={brand.meta.personalityAxes} value={personality.data} onChange={(patch) => personality.update(patch)} />
          {footer(
            <Button variant="primary" className={primaryClass} loading={busy} onClick={() => void next(true)}>
              <Check size={16} /> Done
            </Button>,
          )}
        </Step>
      )
      break
    case 'likes':
    case 'dislikes': {
      const d = screen === 'likes' ? likes : dislikes
      const sentiment = screen === 'likes' ? 'like' : 'dislike'
      body = (
        <Step n={sectionIndex + 1} title={stepLabel[screen]} sub={screen === 'likes' ? 'Work and styles you love. Show us, then tell us why.' : 'What should we never do? Examples help most.'}>
          <div className="flex flex-col gap-8">
            <ReferenceList sentiment={sentiment} canEdit />
            <TasteEditor tags={brand.meta.styleTags} value={d.data} onChange={(patch) => d.update(patch)} sentiment={sentiment} />
          </div>
          {footer(
            <Button variant="primary" className={primaryClass} loading={busy} onClick={() => void next(true)}>
              <Check size={16} /> Done
            </Button>,
          )}
        </Step>
      )
      break
    }
    case 'references':
      body = (
        <Step n={sectionIndex + 1} title={stepLabel.references} sub="Anything else that helps: mood boards, competitors you admire, past campaigns.">
          <ReferenceList sentiment="neutral" canEdit />
          {footer(
            <Button variant="primary" className={primaryClass} loading={busy} onClick={() => void next(true)}>
              <Check size={16} /> Done
            </Button>,
            <Button className={primaryClass} disabled={busy} onClick={() => void next(true)}>
              Nothing to add
            </Button>,
          )}
        </Step>
      )
      break
    case 'assets':
      body = (
        <Step n={sectionIndex + 1} title={stepLabel.assets} sub="Your logo, fonts, guidelines and photos. They go into your shared library.">
          <AssetsPanel canUpload={!!space.data?.can.upload} requests={assetRequests} />
          {footer(
            <Button variant="primary" className={primaryClass} loading={busy} onClick={() => void next(true)}>
              <Check size={16} /> Done
            </Button>,
            <Button className={primaryClass} disabled={busy} onClick={() => void next(true)}>
              Later
            </Button>,
          )}
        </Step>
      )
      break
    case 'done':
      body = (
        <Intro icon={<PartyPopper size={26} />} title="All set" text={`Thank you. ${s.agency.name} has what they need to start. You can change any of it later in Brand DNA.`}>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/c" className={cn(buttonClass('primary'), 'h-11 px-5 text-sm')}>
              Go to home
            </Link>
            <Link to="/c/brand" className={cn(buttonClass('secondary'), 'h-11 px-5 text-sm')}>
              See your Brand DNA
            </Link>
          </div>
        </Intro>
      )
      break
  }

  return (
    <div className="mx-auto max-w-xl">
      {screen !== 'welcome' && screen !== 'capabilities' && screen !== 'done' && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between text-xs text-text-3">
            <span>Brand setup</span>
            <button type="button" onClick={() => navigate('/c/brand')} className="font-medium text-brand hover:underline">
              Save and exit
            </button>
          </div>
          <ol className="grid grid-cols-6 gap-1.5" aria-label="Progress">
            {ONBOARDING_STEPS.map((k, i) => (
              <li key={k} aria-label={`${stepLabel[k]}${doneSteps.has(k) ? ', done' : ''}`} className={cn('h-1.5 rounded-full', doneSteps.has(k) ? 'bg-brand' : i === sectionIndex ? 'bg-brand/40' : 'bg-border-strong')} />
            ))}
          </ol>
        </div>
      )}
      {body}
    </div>
  )
}

function Intro({ icon, title, text, children }: { icon: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <section className="pt-4">
      <span className="grid size-14 place-items-center rounded-2xl bg-green-soft text-green-ink">{icon}</span>
      <h1 className="mt-5 font-serif text-[34px] leading-tight text-brand">{title}</h1>
      {text && <p className="mt-2 text-[15px] text-text-2">{text}</p>}
      {children}
    </section>
  )
}

function Step({ n, title, sub, children }: { n: number; title: string; sub: string; children: ReactNode }) {
  return (
    <section>
      <p className="text-xs font-semibold tracking-wide text-text-3 uppercase">
        {n} of {ONBOARDING_STEPS.length} · {title}
      </p>
      <p className="mt-1 mb-6 text-[15px] text-text-2">{sub}</p>
      {children}
    </section>
  )
}
