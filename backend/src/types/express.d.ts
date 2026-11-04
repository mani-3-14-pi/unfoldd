import type { Types } from 'mongoose'
import type { ClientRole } from '../modules/clients/clientMember.model.ts'
import type { MemberRole } from '../modules/users/membership.model.ts'

declare global {
  namespace Express {
    interface Request {
      /** Set by `requirePlatformAdmin`. */
      admin?: { _id: Types.ObjectId; username: string; name: string; sessionId: Types.ObjectId }
      /** Set by `requireAgencyUser` / `requireUser` in the agency portal. `impersonator` is present in a platform admin's support session. */
      agencyAuth?: {
        user: { _id: Types.ObjectId; name: string; email: string }
        agency: { _id: Types.ObjectId; name: string; slug: string; status: string; timezone: string }
        role: MemberRole
        /** D25: Owner/Admin always; Managers and Members when given the flag. */
        canPublish: boolean
        sessionId: Types.ObjectId
        impersonator?: { id: Types.ObjectId; name: string }
        expiresAt: Date
      }
      /** Set by `requireClientUser` / `requireUser` in a client space. */
      clientAuth?: {
        user: { _id: Types.ObjectId; name: string; email: string }
        agency: { _id: Types.ObjectId; name: string; logo: Types.ObjectId | null }
        client: { _id: Types.ObjectId; name: string; brandName: string; status: string; timezone: string }
        role: ClientRole
        sessionId: Types.ObjectId
        expiresAt: Date
      }
    }
  }
}

export {}
