import { api } from '@/lib/api'
import type { MfaChallenge, SignedIn } from '@/features/agency/api'

export const INVITATION_STATUSES = ['pending', 'accepted', 'declined', 'expired', 'revoked'] as const
export type InvitationStatus = (typeof INVITATION_STATUSES)[number]

/** An agency or client invitation as the portal lists it (backend `presentInvitation`). */
export interface Invitation {
  id: string
  kind: 'agency' | 'client'
  client: string | null
  email: string
  role: string
  message: string
  invitedBy?: { id: string; name: string; side: 'agency' | 'client' }
  status: InvitationStatus
  invitedAt: string
  expiresAt: string
  reinviteRequestedAt: string | null
  respondedAt: string | null
}

/** What the public invite link shows (F01). */
export interface InvitationView {
  status: InvitationStatus
  kind: 'agency' | 'client'
  email: string
  role: string
  message: string
  invitedBy: string | null
  invitedAt: string
  expiresAt: string
  reinviteRequested: boolean
  agency: { name: string; logoUrl: string | null } | null
  client: { name: string; brandName: string; logoUrl: string | null } | null
  accountExists: boolean
  signedInAs: string | null
}

export const invitationStatusLabel: Record<InvitationStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
  revoked: 'Revoked',
}
export const invitationStatusTone = { pending: 'blue', accepted: 'green', declined: 'gray', expired: 'amber', revoked: 'gray' } as const

/** Resend and revoke work for both agency and client invitations; the server checks who may. */
export const invitationsApi = {
  resend: (id: string, idempotencyKey: string) =>
    api<{ invitation: Invitation }>(`/agency/invitations/${id}/resend`, { method: 'POST', idempotencyKey }),
  revoke: (id: string) => api<{ invitation: Invitation }>(`/agency/invitations/${id}/revoke`, { method: 'POST' }),

  // The public invite link (no session needed).
  view: (token: string) => api<InvitationView>(`/invitations/${encodeURIComponent(token)}`),
  accept: (token: string, body: { password: string; name?: string }, idempotencyKey: string) =>
    api<(SignedIn & { clientId: string | null }) | (MfaChallenge & { ok: true; context: 'agency' | 'client' })>(
      `/invitations/${encodeURIComponent(token)}/accept`,
      { body, idempotencyKey },
    ),
  decline: (token: string) => api<void>(`/invitations/${encodeURIComponent(token)}/decline`, { method: 'POST' }),
  requestNew: (token: string) => api<void>(`/invitations/${encodeURIComponent(token)}/request-new`, { method: 'POST' }),
}
