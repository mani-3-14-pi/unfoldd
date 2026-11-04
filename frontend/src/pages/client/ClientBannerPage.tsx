import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { EmptyState } from '@/components/ui/Card'
import { useClientSession } from '@/features/agency/session'
import { ClientPageHeader } from '@/features/client-app/ClientPageHeader'
import { clientHomeApi } from '@/features/client-app/home/api'
import { errorMessage } from '@/lib/errors'
import { formatInZone } from '@/lib/zonedTime'

/** F13 banner detail. Only live banners open; an ended one says so instead of erroring (D51). */
export function ClientBannerPage() {
  const { id = '' } = useParams()
  const s = useClientSession()
  const query = useQuery({ queryKey: ['client', 'banners', id], queryFn: () => clientHomeApi.banner(id), retry: false })
  const back = { to: '/c', label: 'Home' }

  if (query.isPending) return <ClientPageHeader title=" " back={back} />
  if (query.isError) {
    return (
      <>
        <ClientPageHeader title="Announcement" back={back} />
        <EmptyState title="This announcement has ended">{errorMessage(query.error, 'It’s no longer shown.')}</EmptyState>
      </>
    )
  }
  const b = query.data.banner
  // Only links inside the client app are allowed as banner CTAs.
  const cta = b.cta?.link?.startsWith('/c') ? b.cta : null

  return (
    <article className="flex flex-col gap-5">
      <ClientPageHeader title={b.headline} back={back} description={b.endAt ? `Until ${formatInZone(b.endAt, s.client.timezone, { withViewer: false })}` : undefined} />
      {b.imageUrl && <img src={b.imageUrl} alt="" className="w-full rounded-2xl object-cover" />}
      {b.text && <p className="text-[15px] leading-relaxed whitespace-pre-line text-text-2">{b.text}</p>}
      {cta && (
        <Link to={cta.link} className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl bg-brand px-5 text-[14px] font-semibold text-white hover:bg-brand-hover">
          {cta.label || 'Open'} <ChevronRight size={16} />
        </Link>
      )}
    </article>
  )
}
