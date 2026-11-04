import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, LoaderCircle, MailX } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { AuthAlert, AuthField } from '@/components/AuthField'
import { homeFor, isMfa, type MfaChallenge, type SignedIn } from '@/features/agency/api'
import { agencyHighlights } from '@/features/agency/highlights'
import { MfaStep } from '@/features/agency/MfaStep'
import { agencyRoleLabel, clientRoleLabel } from '@/features/agency/roles'
import { invitationsApi, type InvitationView } from '@/features/invitations/api'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import { AuthLayout } from '@/layouts/AuthLayout'
import { authSubmitClass } from '@/layouts/authStyles'
import { ApiError } from '@/lib/api'
import { errorMessage, fieldErrors } from '@/lib/errors'
import { formatDate, initials, timeAgo } from '@/lib/format'

const outlineClass = 'mt-3 flex h-13 w-full items-center justify-center rounded-[10px] border border-[#e3e3e6] text-base font-semibold text-[#111a16] hover:bg-[#f6f6f7] disabled:opacity-60'

/**
 * The invite link (F01, Flow 2). Shows who invited you to what; accepting signs in the invited email only (D49),
 * creating the account if it doesn't exist. An expired link can ask the inviter for a new one (D74).
 */
export function InvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const view = useQuery({ queryKey: ['invite', token], queryFn: () => invitationsApi.view(token), retry: false })
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null)

  const finish = (result: Pick<SignedIn, 'context'>) => {
    qc.clear()
    navigate(homeFor(result.context), { replace: true })
  }

  const layout = (children: ReactNode) => (
    <AuthLayout
      eyebrow="Invitation"
      title={
        <>
          Your work,
          <br />
          in one place.
        </>
      }
      description="Review, give feedback and approve, with everyone on the same page."
      highlights={agencyHighlights}
      footer="© Unfoldd"
    >
      {children}
    </AuthLayout>
  )

  if (view.isPending) {
    return layout(
      <div className="grid place-items-center py-20 text-text-3">
        <LoaderCircle className="animate-spin" />
      </div>,
    )
  }
  if (view.isError) {
    const notFound = view.error instanceof ApiError && view.error.status === 404
    return layout(
      <Message icon={<MailX size={28} />} title={notFound ? 'This link doesn’t work' : 'Couldn’t open the invitation'}>
        {notFound ? 'It may have been replaced by a newer invitation. Check your email for the latest one, or ask whoever invited you to send it again.' : errorMessage(view.error)}
      </Message>,
    )
  }

  const inv = view.data
  if (challenge) {
    return layout(<MfaStep challenge={challenge} onDone={finish} onRestart={() => navigate('/login', { replace: true })} />)
  }
  if (inv.status === 'pending') return layout(<PendingInvite token={token} inv={inv} onAccepted={(r) => (isMfa(r) ? setChallenge(r) : finish(r))} />)
  if (inv.status === 'expired') return layout(<ExpiredInvite token={token} inv={inv} />)

  const ended = {
    accepted: { title: 'You’ve already accepted', text: 'Log in with your email to continue.' },
    declined: { title: 'You declined this invitation', text: 'If that was a mistake, ask whoever invited you to send a new one.' },
    revoked: { title: 'This invitation was withdrawn', text: 'Ask whoever invited you to send a new one if you still need access.' },
  }[inv.status]
  return layout(
    <Message icon={<MailX size={28} />} title={ended.title}>
      {ended.text}
      <Link to="/login" className={`${authSubmitClass} mt-8`}>
        Go to log in
      </Link>
    </Message>,
  )
}

/** The agency or brand, who invited you, the role and the message. */
function InviteHeader({ inv }: { inv: InvitationView }) {
  const target = inv.kind === 'client' ? inv.client : inv.agency
  const name = inv.kind === 'client' ? (inv.client?.brandName ?? 'a client') : (inv.agency?.name ?? 'an agency')
  const role = inv.kind === 'client' ? (clientRoleLabel[inv.role as keyof typeof clientRoleLabel] ?? inv.role) : (agencyRoleLabel[inv.role as keyof typeof agencyRoleLabel] ?? inv.role)
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-green-soft text-lg font-bold text-green-ink">
          {target?.logoUrl ? <img src={target.logoUrl} alt="" className="size-full object-cover" /> : initials(name)}
        </span>
        {inv.kind === 'client' && inv.agency && <span className="text-sm text-[#6b6f76]">with {inv.agency.name}</span>}
      </div>
      <h1 className="mt-6 text-[32px] leading-tight font-bold tracking-tight text-[#0f2f24]">Join {name}</h1>
      <p className="mt-2 text-base text-[#6b6f76]">
        {inv.invitedBy ?? 'Someone'} invited <strong className="font-semibold text-[#111a16]">{inv.email}</strong> as {/^[aeiou]/i.test(role) ? 'an' : 'a'}{' '}
        {role.toLowerCase()}
        {inv.kind === 'client' ? ' in the client app.' : '.'}
      </p>
      {inv.message && <blockquote className="mt-4 rounded-xl border-l-4 border-[#2f6a52] bg-[#f6f6f7] px-4 py-3 text-[15px] whitespace-pre-line text-[#111a16]">{inv.message}</blockquote>}
      <p className="mt-4 flex items-center gap-1.5 text-sm text-[#6b6f76]">
        <CalendarClock size={15} /> Invited {formatDate(inv.invitedAt)} · {inv.status === 'expired' ? `expired ${timeAgo(inv.expiresAt)}` : `expires ${timeAgo(inv.expiresAt)}`}
      </p>
    </>
  )
}

function PendingInvite({ token, inv, onAccepted }: { token: string; inv: InvitationView; onAccepted: (r: SignedIn | (MfaChallenge & { context: 'agency' | 'client' })) => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const idem = useIdempotencyKey()

  const accept = useMutation({
    mutationFn: () => invitationsApi.accept(token, { password, ...(inv.accountExists ? {} : { name: name.trim() }) }, idem.key),
    onSuccess: onAccepted,
  })
  const decline = useMutation({
    mutationFn: () => invitationsApi.decline(token),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['invite', token] }),
  })
  const errors = fieldErrors(accept.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    accept.mutate()
  }
  const otherAccount = inv.signedInAs && inv.signedInAs !== inv.email

  return (
    <div>
      <InviteHeader inv={inv} />
      <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-4">
        {otherAccount && (
          <AuthAlert tone="info">
            You’re signed in as {inv.signedInAs}. Accepting signs you in as {inv.email} instead.
          </AuthAlert>
        )}
        {accept.isError && Object.keys(errors).length === 0 && <AuthAlert>{errorMessage(accept.error)}</AuthAlert>}
        {inv.accountExists ? (
          <AuthField
            id="invite-password"
            label="Your password"
            password
            autoComplete="current-password"
            placeholder="Enter your Unfoldd password"
            hint={`${inv.email} already has an Unfoldd account.`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            autoFocus
          />
        ) : (
          <>
            <AuthField id="invite-name" label="Full name" autoComplete="name" placeholder="Enter your full name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoFocus />
            <AuthField
              id="invite-password"
              label="Create a password"
              password
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
            />
          </>
        )}
        <button type="submit" className={authSubmitClass} disabled={accept.isPending || decline.isPending}>
          {accept.isPending ? <LoaderCircle className="animate-spin" size={20} /> : inv.accountExists ? 'Accept and log in' : 'Accept and create account'}
        </button>
      </form>
      <button type="button" className={outlineClass} disabled={accept.isPending || decline.isPending} onClick={() => decline.mutate()}>
        {decline.isPending ? <LoaderCircle className="animate-spin" size={20} /> : 'Decline'}
      </button>
      {decline.isError && <p className="mt-2 text-sm text-negative">{errorMessage(decline.error)}</p>}
    </div>
  )
}

function ExpiredInvite({ token, inv }: { token: string; inv: InvitationView }) {
  const request = useMutation({ mutationFn: () => invitationsApi.requestNew(token) })
  const asked = request.isSuccess || inv.reinviteRequested
  return (
    <div>
      <InviteHeader inv={inv} />
      <div className="mt-6">
        <AuthAlert tone="info">
          This invitation has expired. {asked ? 'We’ve asked ' + (inv.invitedBy ?? 'them') + ' to send you a new one: it will arrive by email.' : 'Ask for a new one and we’ll let ' + (inv.invitedBy ?? 'them') + ' know.'}
        </AuthAlert>
      </div>
      {!asked && (
        <button type="button" className={`${authSubmitClass} mt-6`} disabled={request.isPending} onClick={() => request.mutate()}>
          {request.isPending ? <LoaderCircle className="animate-spin" size={20} /> : 'Request new invitation'}
        </button>
      )}
      {request.isError && <p className="mt-2 text-sm text-negative">{errorMessage(request.error)}</p>}
    </div>
  )
}

function Message({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start">
      <span className="grid size-14 place-items-center rounded-2xl bg-amber-soft text-amber-ink">{icon}</span>
      <h1 className="mt-6 text-[32px] leading-tight font-bold tracking-tight text-[#0f2f24]">{title}</h1>
      <div className="mt-2 w-full text-base text-[#6b6f76]">{children}</div>
    </div>
  )
}
