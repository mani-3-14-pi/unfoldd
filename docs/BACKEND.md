# Unfoldd backend guide

How the backend works, where each piece lives, and every API endpoint. As of 2026-11-04.
Design reasons (D-numbers, §-rules) are in [MATCHA_SYSTEM.md](MATCHA_SYSTEM.md) and [DECISIONS.md](DECISIONS.md).

Contents: [1. The big picture](#1-the-big-picture) · [2. One request, start to finish](#2-one-request-start-to-finish) · [3. Folder map](#3-folder-map) · [4. Shared building blocks (lib/)](#4-shared-building-blocks-lib) · [5. Features (modules/)](#5-features-modules) · [6. Data models](#6-data-models) · [7. Background jobs](#7-background-jobs) · [8. Sign-in and 2FA](#8-sign-in-and-2fa) · [9. Key workflows](#9-key-workflows) · [10. Settings (.env)](#10-settings-env) · [11. Running and testing](#11-running-and-testing) · [12. API reference](#12-api-reference)

---

## 1. The big picture

- **Stack:** Node 24, Express 5, MongoDB with Mongoose, Zod for input checks, TypeScript run directly by Node (no build step in dev).
- **Three kinds of people:**
  - **Platform admins** (Unfoldd staff) use `/api/admin/*`.
  - **Agency people** (Owner, Admin, Manager, Member) use the agency portal routes.
  - **Client people** (Admin, Approver, Contributor, Viewer) use `/api/client/*`.
- **One login per person.** The same email can belong to several agencies and client spaces. The session remembers which one you're in, and `POST /api/auth/switch` changes it.
- **Tenancy:** every record carries `agency`, and client records also carry `client`. One shared function (`scopeFilter` in [lib/scope.ts](../backend/src/lib/scope.ts)) adds those filters to every query. Anything outside your scope is simply "not found" (404).
- **Two kinds of work:**
  - **Requests:** the API answers the browser.
  - **Background jobs:** emails, publishing, AI, reminders and analytics run in a queue stored in MongoDB.

```
Browser ──HTTP──► Express app (app.ts)
                    │  helmet, cors, json, cookies, logging
                    ▼
                 routes.ts ── picks the router by URL prefix, runs the auth guard
                    ▼
            modules/<feature>/<feature>.routes.ts ── checks input (Zod), loads data in scope
                    ▼
            <feature>.service.ts + lib/* ── state changes, rules, notifications, events
                    ▼
                 MongoDB  ◄── job worker (lib/jobs.ts) runs queued jobs in the background
```

## 2. One request, start to finish

Example: a client approves a post, `POST /api/client/content/:id/approve`.

1. **[server.ts](../backend/src/server.ts)** connects to MongoDB, starts the HTTP server and starts the job worker.
2. **[app.ts](../backend/src/app.ts)** runs the standard middleware (security headers, CORS, JSON body, cookies) and hands `/api/*` to `apiRouter`.
3. **[routes.ts](../backend/src/routes.ts)** matches `/client/content` and runs **`requireClientUser`** ([middleware/auth.ts](../backend/src/middleware/auth.ts)). It reads the `uf_session` cookie, loads the session, user, client and membership, and sets `req.clientAuth`. If anything is missing, it returns 401.
4. **[clientContent.routes.ts](../backend/src/modules/content/clientContent.routes.ts)** handles the route:
   - `idempotent()` makes a double tap with the same `Idempotency-Key` return the first answer.
   - `assertCanDecide` checks the client role.
   - Zod parses the body.
   - `loadVisible` loads the content inside the caller's scope.
5. **[content.service.ts](../backend/src/modules/content/content.service.ts) → `clientApprove`:**
   - checks this is the current version;
   - checks the state the person saw hasn't changed (otherwise a 409 like "Priya approved this at 4:42");
   - handles unsent drafts;
   - moves the state with **`transition`** ([lib/concurrency.ts](../backend/src/lib/concurrency.ts)), a single conditional update, so two people can't both win;
   - records a `ReviewDecision`, closes open feedback, writes the event log with **`logActivity`**, and notifies the agency with **`notify`**.
6. **Errors:** any thrown `AppError` becomes `{ error: { code, message, details } }` in [middleware/error.ts](../backend/src/middleware/error.ts). Zod errors become 400 with per-field messages.

## 3. Folder map

```
backend/
├── src/
│   ├── server.ts        start: DB, HTTP server, job worker
│   ├── app.ts           Express app and middleware
│   ├── routes.ts        every router mounted under /api, with its auth guard
│   ├── worker.ts        every recurring background job, in one place
│   ├── config/          env.ts (validated settings), db.ts (Mongo connection)
│   ├── middleware/      auth guards, errors, idempotency, rate limit
│   ├── lib/             shared building blocks (section 4)
│   ├── modules/         one folder per feature (section 5): *.model.ts, *.routes.ts, *.service.ts
│   ├── scripts/         seed (platform admin), seedDemo
│   ├── types/           express.d.ts: what req.agencyAuth / req.clientAuth / req.admin hold
│   └── utils/           AppError, notFound, forbidden, invalid
└── test/                end-to-end tests on an in-memory MongoDB
```

## 4. Shared building blocks (lib/)

| File | What it's for | Main functions |
|---|---|---|
| [scope.ts](../backend/src/lib/scope.ts) | **Tenant isolation** (§12.1). Builds the filter for whoever is signed in. | `scopeFilter(req, opts)`, `findScoped`, `loadClient(req, id, 'read'\|'write'\|'manage')`, `accessibleClientIds`, `clientCan(role, action)`, `isAgencyAdmin`, `isManagerPlus`, `currentUser`, `tenantOf` |
| [concurrency.ts](../backend/src/lib/concurrency.ts) | Safe state changes and edits (§12.2, §12.3) | `transition(model, filter, {from, to})` → 409 if the state moved; `updateWithRev(model, filter, rev, set, by)` → 409 "updated by X"; `revFields`, `softDeleteFields` |
| [activity.ts](../backend/src/lib/activity.ts) | The append-only event log (D54) | `logActivity(req, {action, message, agency, client, visibility, target, before, after})`, `diff()` |
| [notify.ts](../backend/src/lib/notify.ts) | Notifications: in-app, email now or in the digest, push queued (D68) | `notify({recipients, audience, category, title, link, urgent})`, `sendDigests()` |
| [mailer.ts](../backend/src/lib/mailer.ts) | Email through the outbox and the `email.send` job; Resend, or console in dev | `sendEmail({to, subject, text, kind})`, `appLink(path)` |
| [jobs.ts](../backend/src/lib/jobs.ts) | The MongoDB job queue | `registerJob(type, fn)`, `enqueue(type, payload, {runAt, uniqueKey})`, `every(type, ms)`, `cancelJob(key)`, `releaseKey`, `drainJobs()`, `startWorker()` |
| [storage.ts](../backend/src/lib/storage.ts) | Cloudflare R2 (S3 API): presigned uploads and downloads | `presignUpload`, `presignDownload`, `headObject`, `isActiveContent` (HTML/SVG are always downloaded) |
| [session.ts](../backend/src/lib/session.ts) | Cookie sessions (only a hash is stored) | `createSession`, `readSession`, `destroySession`, `revokeMemberSessions`, `revokeClientMemberSessions`, `revokeAgencySessions` |
| [mfa.ts](../backend/src/lib/mfa.ts) + [totp.ts](../backend/src/lib/totp.ts) | Mandatory 2FA for platform admins and agency owners | `startChallenge`, `beginSetup`, `completeChallenge`, `regenerateBackupCodes`, `userNeedsMfa`; `totpAt`, `verifyTotp` |
| [crypto.ts](../backend/src/lib/crypto.ts) | Encrypts secrets at rest (2FA seeds, platform tokens) | `encrypt`, `decrypt`, `randomToken`, `sha256` |
| [password.ts](../backend/src/lib/password.ts) | scrypt password hashes | `hashPassword`, `verifyPassword`, `DUMMY_HASH` |
| [ai.ts](../backend/src/lib/ai.ts) | AI revision checklist through Claude, swappable | `checklistProvider()`, `setChecklistProvider()`, `AiPermanentError` |
| [platforms/](../backend/src/lib/platforms/index.ts) | Publishing integrations: Meta (IG + FB), LinkedIn, YouTube, X | `PROVIDERS`, `OAUTH_PROVIDER`, `PLATFORM_CATALOG`, `PublishError`, `call()` |
| [time.ts](../backend/src/lib/time.ts) | UTC storage, client-timezone dates (§12.8) | `zonedToUtc`, `dateIn`, `todayIn`, `timezoneSchema`, `dateOnlySchema` |
| [pagination.ts](../backend/src/lib/pagination.ts) | Lists | `paginate`, `paginateAggregate`, `pageQuery`, `csvEnum`, `dateRange` |
| [permissions.ts](../backend/src/lib/permissions.ts) | The role × capability matrix, as data | `PERMISSION_MATRIX` |
| [ids.ts](../backend/src/lib/ids.ts) | Route ids | `objectId(id)` (a bad id is just a 404) |

**Middleware:**
- [auth.ts](../backend/src/middleware/auth.ts) holds the guards: `requirePlatformAdmin`, `requireAgencyUser`, `requireClientUser`, `requireUser` (either app) and `requireRole(...)`.
- [idempotency.ts](../backend/src/middleware/idempotency.ts) provides `idempotent()`.
- [rateLimit.ts](../backend/src/middleware/rateLimit.ts) provides `authLimiter`.
- [error.ts](../backend/src/middleware/error.ts) turns errors into JSON.

## 5. Features (modules/)

Each folder usually has a **model** (database shape), **routes** (HTTP endpoints) and sometimes a **service** (the rules, shared by routes and jobs).

| Folder | What it covers | Phase |
|---|---|---|
| `auth/` | Agency/client login, signup, `/me`, context switch, 2FA routes, platform admin login | 0, cross-cutting |
| `agencies/` | Agency model, profile, permissions, billing placeholder; platform admin agency management | 0, 7 |
| `team/` | Team members, roles, disable/remove, ownership transfer, agency invitations | 0 |
| `invitations/` | Invitation model, the public invite link (preview, accept, decline, request new) | 0 |
| `clients/` | Clients, agency access, client members, the client space (`/api/client`) and its settings | 0, 7 |
| `files/` | Uploads, downloads, library categories and collections | 0, 5 |
| `activity/` | The event log model; platform admin activity list | 0 |
| `notifications/` | Notification centre, preferences, the email outbox | 0 |
| `content/` | Content state machine, versions, decisions, publish jobs, agency and client routes, content jobs | 1 |
| `feedback/` | Threads and messages: feedback, drafts, pins, replies, inbox, conversations | 1, 5 |
| `checklist/` | AI revision checklist runs and items | 2 |
| `tasks/` | Tasks, board, dependencies, auto-unblock | 2 |
| `dashboard/` | Needs Attention, health, workload, metrics, calendar, client Home | 3 |
| `banners/` | Banner manager, automatic banners | 3 |
| `campaigns/` | Campaigns and briefs, derived progress | 4 |
| `plans/` | Monthly content plans and plan review | 4 |
| `requests/` | Needed From You | 4 |
| `templates/` | Content, campaign, task-list and request templates | 4 |
| `brand/` | Brand DNA sections, references, creative guidelines, onboarding | 5 |
| `meetings/` | Meetings, transcript, summary, share → tasks and requests, reminders | 5 |
| `publishing/` | Connected accounts, OAuth, the publish worker, connection health | 6 |
| `analytics/` | Metrics snapshots, collection job, reports | 6 |
| `users/` | User and Membership models, your own account (`/api/me`) | 0, 7 |
| `support/` | Support tickets, user and platform admin sides | 7 |
| `jobs/`, `idempotency/`, `sessions/`, `settings/`, `platform-admins/`, `health/`, `admin/` | Infrastructure models and small admin routes | — |

## 6. Data models

| Model | File | Holds |
|---|---|---|
| Agency | [agency.model.ts](../backend/src/modules/agencies/agency.model.ts) | Tenant: profile, status, subscription placeholder, client defaults |
| User / Membership | [users/](../backend/src/modules/users/user.model.ts) | One login; role in each agency (owner/admin/manager/member), canPublish, titles, departments, capacity |
| Client / AgencyAccess / ClientMember | [clients/](../backend/src/modules/clients/client.model.ts) | A brand, its contract and status; which team members work on it; the brand's own people and roles |
| Invitation | [invitation.model.ts](../backend/src/modules/invitations/invitation.model.ts) | Email-bound invite, token hash, 7-day expiry |
| Session / MfaChallenge | [sessions/](../backend/src/modules/sessions/session.model.ts) | Signed-in browsers; the 2FA step |
| File / FileCollection | [files/](../backend/src/modules/files/file.model.ts) | Every stored object, its purpose, visibility, "used in"; library collections |
| Activity | [activity.model.ts](../backend/src/modules/activity/activity.model.ts) | Append-only events with visibility and before/after |
| Notification / OutboxEmail | [notifications/](../backend/src/modules/notifications/notification.model.ts) | In-app notifications; every email sent |
| Content / Version / ReviewDecision / PublishJob | [content/](../backend/src/modules/content/content.model.ts) | The state machine, numbered versions, approval history, scheduled publishes |
| Thread / Message | [feedback/](../backend/src/modules/feedback/thread.model.ts) | Feedback items, plan comments, conversations, task comments |
| ChecklistItem / ChecklistRun | [checklist.model.ts](../backend/src/modules/checklist/checklist.model.ts) | AI suggestions and accepted items; AI job runs |
| Task | [task.model.ts](../backend/src/modules/tasks/task.model.ts) | Board items, blocked flag, dependencies |
| Banner | [banner.model.ts](../backend/src/modules/banners/banner.model.ts) | Home banners, manual and automatic |
| Campaign / ContentPlan / Request / Template | campaigns/, plans/, requests/, templates/ | Planning objects |
| BrandDna / BrandReference / CreativeGuidelines | [brand.model.ts](../backend/src/modules/brand/brand.model.ts) | Per-section Brand DNA with rev; likes, dislikes and references; internal guidelines |
| Meeting | [meeting.model.ts](../backend/src/modules/meetings/meeting.model.ts) | Schedule, participants, internal transcript, shared summary |
| PlatformConnection / OAuthState | [connection.model.ts](../backend/src/modules/publishing/connection.model.ts) | Connected social accounts (encrypted tokens); OAuth in progress |
| AnalyticsSnapshot / Report | [analytics.model.ts](../backend/src/modules/analytics/analytics.model.ts) | Metrics readings; frozen reports |
| SupportTicket | [support.model.ts](../backend/src/modules/support/support.model.ts) | Support conversations |
| Job / IdempotencyKey | jobs/, idempotency/ | Background queue; remembered responses |

**State machines:** the content one is in `CONTENT_TRANSITIONS` ([content.model.ts](../backend/src/modules/content/content.model.ts)). The others follow the same pattern: `CLIENT_TRANSITIONS`, `INVITATION_TRANSITIONS`, `PLAN_TRANSITIONS`, `REQUEST_TRANSITIONS`, `CAMPAIGN_TRANSITIONS` and `MEETING_TRANSITIONS`. Every move goes through `transition()`.

**Derived, never stored** (rule §12.12): client labels, approval status, revision count, timing and at-risk ([content.derive.ts](../backend/src/modules/content/content.derive.ts)); Needs Attention, health and workload ([insights.ts](../backend/src/modules/dashboard/insights.ts)); onboarding %; campaign progress; banner state; overdue requests.

## 7. Background jobs

Handlers are registered in [worker.ts](../backend/src/worker.ts) and in their own modules. The worker polls every 2 seconds and claims each job atomically with a 5-minute lease, so it's safe to run several servers. Failed jobs retry with backoff, and a job that runs out of attempts is marked `dead`.

| Job | When | What it does | Code |
|---|---|---|---|
| `email.send` | each email | Sends through Resend (or prints in dev); retries 429/5xx | [mailer.ts](../backend/src/lib/mailer.ts) |
| `notifications.digest` | every 15 min | Emails each person a summary of non-urgent notifications | [notify.ts](../backend/src/lib/notify.ts) |
| `content.tick` | every minute | Send-later, manual publish reminders, missed-slot alerts, AI checklist runs | [content.jobs.ts](../backend/src/modules/content/content.jobs.ts), [checklist.service.ts](../backend/src/modules/checklist/checklist.service.ts) |
| `meetings.remind` | every minute | "Starting soon" 15 minutes before a meeting | [meetings.routes.ts](../backend/src/modules/meetings/meetings.routes.ts) |
| `publish.run` | at the publish time | Lock → post the approved version → published, retry, failed or unknown | [publish.worker.ts](../backend/src/modules/publishing/publish.worker.ts) |
| `connections.health` | hourly | Checks accounts that publish in the next 24 h; "Reconnect" alerts | [publish.worker.ts](../backend/src/modules/publishing/publish.worker.ts) |
| `analytics.collect` | every 6 h | Fresh metrics for posts published through connected accounts | [analytics.service.ts](../backend/src/modules/analytics/analytics.service.ts) |

## 8. Sign-in and 2FA

- **Agency and client people:** `POST /api/auth/login` sets the `uf_session` cookie.
  - **Owners** get `{ mfa: 'verify' | 'setup', challenge }` instead of a session.
  - **First time:** `POST /api/auth/2fa/setup` returns the secret and an `otpauth://` link for the authenticator app.
  - **Then:** `POST /api/auth/2fa/verify` with the 6-digit code (or a backup code) creates the session, and returns 10 backup codes on first setup.
  - Codes can't be reused, and a challenge allows 5 wrong tries in 10 minutes.
  - The middleware refuses any owner session that didn't pass 2FA.
- **Platform admins:** the same flow at `/api/admin/auth/login`, `/2fa/setup` and `/2fa/verify`, with the `uf_admin` cookie. It's mandatory for every admin.
- **Lost phone:** a platform admin calls `POST /api/admin/agencies/:id/members/:userId/reset-2fa`.
- **Removing access is immediate:** removing or disabling a member, changing a password, or suspending an agency deletes the matching sessions.

## 9. Key workflows

**Invite → accept.**
1. `POST /api/agency/invitations` or `/api/clients/:id/invitations` creates an invitation and emails a link with a token.
2. `GET /api/invitations/:token` shows what the link is for.
3. `POST /api/invitations/:token/accept` accepts it. An existing account must give its password; otherwise a new account is created.

**Content review loop (Phase 1).**
1. `POST /api/files` (purpose `version`) gives a presigned upload URL; the browser uploads to R2, then calls `POST /api/files/:id/complete`.
2. `POST /api/content/:id/versions` creates the version. The server numbers it; the content goes back to in production.
3. `POST /api/content/:id/submit` sends it to internal review, or straight to ready-for-client if internal review is off.
4. `POST /api/content/:id/internal-review` with `approve_and_send`, or `POST /api/content/:id/send`.
5. The client comments: `POST /api/client/content/:id/threads` creates a private draft, and `POST /api/client/content/:id/review/submit` sends them.
6. The client decides: `POST /api/client/content/:id/approve` or `/request-changes`.
7. Publishing: `POST /api/content/:id/schedule` (a connected account or manual), or `/mark-published`.

**Revision loop (Phase 2).**
1. Request changes queues an AI run. The `content.tick` job runs it, and the agency sees suggestions at `GET /api/content/:id/checklist`.
2. The agency accepts, edits or removes them with `PATCH .../checklist/items/:itemId`.
3. Items become tasks with `POST .../checklist/items/:itemId/task`, or straight from feedback with `POST /api/content/:id/threads/:threadId/task`.
4. The board is `GET /api/tasks?view=board`; cards move with `POST /api/tasks/:id/move`.
5. V02 resolves feedback through `resolves` on version upload.

**Plans and requests (Phase 4).**
- **Plans:** `POST /api/plans`, then `/items/bulk`, then `/send` (with an automatic banner). The client answers with `POST /api/client/plans/:id/approve` or `/request-changes`.
- **Requests:** `POST /api/requests`. The client attaches files with `POST /api/client/requests/:id/files` and submits with `/submit`. The agency closes it with `POST /api/requests/:id/complete`, and tasks waiting on it unblock.

**Meetings (Phase 5).**
1. `POST /api/meetings`, then `PUT /:id/transcript` (internal) and `PUT /:id/summary`.
2. `POST /:id/share` turns each agency action item into a task and each client action item into a request, exactly once.

**Publishing (Phase 6).**
1. `POST /api/integrations/:app/authorize` returns the platform's sign-in URL.
2. The platform redirects to `GET /api/integrations/:app/callback`.
3. The portal shows the accounts found with `GET /api/integrations/pending/:state`, and connects the chosen ones with `POST /api/integrations/pending/:state`.
4. Schedule with `{ account }`. At the publish time `publish.run` posts it.
   - An "unknown outcome" is never retried automatically; a person checks the account, then marks it published or retries.

## 10. Settings (.env)

All settings are in [config/env.ts](../backend/src/config/env.ts), validated at start. Commented examples are in [backend/.env.example](../backend/.env.example).

- **Required:** `MONGODB_URI`, plus `SECRET_KEY` in production.
- **Each feature switches on when its keys are set:**
  - R2 (`R2_*`): file uploads.
  - Resend (`RESEND_API_KEY`): real email.
  - Claude (`ANTHROPIC_API_KEY`, `AI_MODEL`, default `claude-haiku-5-5`): the AI checklist.
  - Meta / LinkedIn / Google / X app keys: automatic publishing.
- **Without a feature's keys:** files return 503, email prints to the console, AI is skipped, and platforms stay manual-only.

## 11. Running and testing

```bash
npm run dev -w backend       # API on :8787 with the job worker
npm run seed -w backend      # first platform admin (sets up 2FA on first login)
npm test -w backend          # 45 end-to-end tests on an in-memory MongoDB (no real data, no API keys)
npm run typecheck -w backend
```

The tests are in [backend/test/](../backend/test/):
- `core-loop` covers Phases 0–1.
- `revision-engine` covers Phase 2.
- `planning` covers Phases 3–4.
- `platform` covers jobs, email, 2FA and Phases 5–7.

They use a fake AI and a fake Instagram, so nothing calls an outside service.

---

## 12. API reference

Every endpoint, grouped by the file that defines it, generated from the code.

**Who** is the guard: `public` (no login), `agency` (agency session), `client` (client-space session), `agency+client` (either), or `platform admin`. A role in brackets means only those roles can call it.

All paths start with `/api`. Request bodies are JSON. Errors look like `{ "error": { "code", "message", "details" } }`. Add an `Idempotency-Key` header to create actions to make retries safe.

#### [backend/src/modules/activity/activity.admin.routes.ts](../backend/src/modules/activity/activity.admin.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/admin/activity` | platform admin | Platform-wide activity log with filters |

#### [backend/src/modules/admin/overview.routes.ts](../backend/src/modules/admin/overview.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/admin/overview` | platform admin | Dashboard numbers for platform admins |

#### [backend/src/modules/agencies/agencies.admin.routes.ts](../backend/src/modules/agencies/agencies.admin.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/admin/agencies` | platform admin | List agencies with filters, status counts and owner info |
| GET | `/api/admin/agencies/:id` | platform admin | One agency with owner, member count and active sessions |
| GET | `/api/admin/agencies/:id/members` | platform admin | An agency's members |
| POST | `/api/admin/agencies/:id/:action` | platform admin | approve / reject / suspend / reactivate an agency |
| POST | `/api/admin/agencies/:id/impersonate` | platform admin | Open the agency's portal as its owner (support view) |
| PATCH | `/api/admin/agencies/:id/subscription` | platform admin | Set plan, status, seats, renewal date, notes |
| POST | `/api/admin/agencies/:id/members/:userId/reset-2fa` | platform admin | Lost authenticator: clears a person's 2FA so they set it up again at next login. Signs them out everywhere. |

#### [backend/src/modules/agencies/agency.routes.ts](../backend/src/modules/agencies/agency.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/agency` | agency | Your agency's profile and settings |
| PATCH | `/api/agency` | agency (owner, admin) | Update the agency profile and client defaults (with rev) |
| GET | `/api/agency/activity` | agency | The agency's activity feed: everything the person can see, newest first. |
| GET | `/api/agency/permissions` | agency | P172–P174: what each role can do. Roles are fixed, so this is read-only. |
| GET | `/api/agency/billing` | agency (owner) | Billing placeholder (P158–P160). Payments aren't built yet; this shows the plan the platform admin set and seat use, so the portal can render the page. |

#### [backend/src/modules/agencies/subscriptions.admin.routes.ts](../backend/src/modules/agencies/subscriptions.admin.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/admin/subscriptions` | platform admin | All agencies' subscriptions |

#### [backend/src/modules/analytics/analytics.routes.ts](../backend/src/modules/analytics/analytics.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/analytics` | agency | A client's analytics for a period: totals, per platform, top posts |
| GET | `/api/analytics/content/:id` | agency | Every metrics reading for one published post |
| GET | `/api/reports` | agency | Reports (drafts and shared) |
| POST | `/api/reports` | agency | Creates a draft with a fresh snapshot (D53: drafts first, never auto-shared). |
| GET | `/api/reports/:id` | agency | One report with its snapshot |
| PATCH | `/api/reports/:id` | agency | Edit a draft's title, notes, sections |
| POST | `/api/reports/:id/refresh` | agency | Re-takes the snapshot of a draft. |
| POST | `/api/reports/:id/share` | agency | Freezes the report and shows it to the client under Analytics → Reports (D53). |
| DELETE | `/api/reports/:id` | agency | Delete a draft (shared reports stay) |
| GET | `/api/client/analytics` | client | The client's analytics, if the agency switched them on |
| GET | `/api/client/analytics/reports` | client | Reports shared with the client |
| GET | `/api/client/analytics/reports/:id` | client | One shared report |

#### [backend/src/modules/auth/adminAuth.routes.ts](../backend/src/modules/auth/adminAuth.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| POST | `/api/admin/auth/login` | public | Password step; answers with a 2FA challenge |
| POST | `/api/admin/auth/2fa/setup` | public | First sign-in: the secret to add to an authenticator app. |
| POST | `/api/admin/auth/2fa/verify` | public | Code or backup code → platform session |
| POST | `/api/admin/auth/2fa/backup-codes` | platform admin | New backup codes (needs a fresh code) |
| POST | `/api/admin/auth/logout` | public | End the platform session |
| GET | `/api/admin/auth/me` | platform admin | The signed-in platform admin |
| POST | `/api/admin/auth/password` | platform admin | Change the admin password; signs out other browsers |

#### [backend/src/modules/auth/agencyAuth.routes.ts](../backend/src/modules/auth/agencyAuth.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/auth/signup-config` | public | Whether public agency signup is open |
| POST | `/api/auth/signup` | public | Create an agency + owner; owner then sets up 2FA |
| POST | `/api/auth/login` | public | Email + password; owners get a 2FA challenge, others a session |
| POST | `/api/auth/logout` | public | End the session (and a support view) |
| GET | `/api/auth/me` | agency+client | Who you are, where you are (agency or client space), and where else you can go |
| GET | `/api/auth/contexts` | agency+client | Every agency and client space this login can open: the agency switcher and the brand switcher (D43). |
| POST | `/api/auth/switch` | agency+client | Moves the session to another agency or client space. A new session replaces the old one. |

#### [backend/src/modules/auth/mfa.routes.ts](../backend/src/modules/auth/mfa.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| POST | `/api/auth/2fa/setup` | public (2FA challenge) | First sign-in: the secret to add to an authenticator app |
| POST | `/api/auth/2fa/verify` | public (2FA challenge) | The code (or a backup code) checks out: the session opens where the login was going. |
| POST | `/api/auth/2fa/backup-codes` | agency (owner) | New backup codes (needs a fresh code) |

#### [backend/src/modules/banners/banners.routes.ts](../backend/src/modules/banners/banners.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/banners` | agency | Banners with their derived state |
| POST | `/api/banners` | agency | Create (and optionally publish) a banner |
| PATCH | `/api/banners/:id` | agency | Edit a manual banner (with rev) |
| POST | `/api/banners/:id/publish` | agency | Publish a draft banner |
| POST | `/api/banners/:id/end` | agency | Ends a live or scheduled banner now. Works on automatic banners too. |
| DELETE | `/api/banners/:id` | agency | Delete a manual banner |
| PUT | `/api/banners/order` | agency | Sets the order banners show in, top first. |
| GET | `/api/client/banners/:id` | client | F13 banner detail: only banners live right now. |

#### [backend/src/modules/brand/brand.routes.ts](../backend/src/modules/brand/brand.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/clients/:id/brand` | agency | The client's Brand DNA, onboarding progress, sliders and tags |
| PUT | `/api/clients/:id/brand/sections/:section` | agency | Manager+ edit any section, including the professional layer (D41, D82). |
| GET | `/api/clients/:id/brand/history` | agency | P24: change history, from the event log. |
| POST | `/api/clients/:id/brand/request-update` | agency | P23 "Request client update" = a Request linked to that section (Flow 3, step 7). |
| POST | `/api/clients/:id/brand/asset-requests` | agency | Flow 3: specific asset asks for onboarding ("logo in SVG"). P16's "Assets — 2 remaining" counts these. |
| GET | `/api/clients/:id/guidelines` | agency | Creative guidelines (agency-only) |
| PUT | `/api/clients/:id/guidelines` | agency | Update creative guidelines (with rev) |
| GET | `/api/clients/:id/brand/references` | agency | Likes / dislikes / references |
| POST | `/api/clients/:id/brand/references` | agency | Add a reference (image or link) |
| DELETE | `/api/clients/:id/brand/references/:refId` | agency | Remove a reference |
| GET | `/api/client/brand` | client | The client's own Brand DNA |
| PUT | `/api/client/brand/sections/:section` | client | The client edits their own sections at any time (D41). The professional layer is the agency's. |
| GET | `/api/client/brand/onboarding` | client | Onboarding progress and asset requests |
| POST | `/api/client/brand/onboarding/:step/complete` | client | "Done" / "Nothing to add" on an onboarding section (D72). |
| GET | `/api/client/brand/references` | client | The client's references |
| POST | `/api/client/brand/references` | client | Add a reference |
| DELETE | `/api/client/brand/references/:refId` | client | Clients remove their own references; the agency can remove any. |

#### [backend/src/modules/campaigns/campaigns.routes.ts](../backend/src/modules/campaigns/campaigns.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/campaigns` | agency | Campaigns with derived progress |
| POST | `/api/campaigns` | agency | Create a campaign (optionally from a template) |
| GET | `/api/campaigns/:id` | agency | A campaign with its content and progress |
| PATCH | `/api/campaigns/:id` | agency | Edit a campaign (with rev) |
| POST | `/api/campaigns/:id/:action` | agency | activate / complete / archive / restore |
| GET | `/api/client/campaigns` | client | Campaigns the client can see (no internal brief) |
| GET | `/api/client/campaigns/:id` | client | One campaign, with content the client can already see |

#### [backend/src/modules/checklist/checklist.routes.ts](../backend/src/modules/checklist/checklist.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/content/:id/checklist` | agency | The version whose feedback the checklist is about: the latest one the client requested changes on, by default. |
| POST | `/api/content/:id/checklist/run` | agency | Run (or re-run) the AI over the version's open client feedback. Retry after a failure (D21). |
| POST | `/api/content/:id/checklist/items` | agency | A person adds an item themselves: accepted straight away. |
| PATCH | `/api/content/:id/checklist/items/:itemId` | agency | Accept / edit / remove (Flow 7, step 3). Every decision is logged, with the AI's wording when it was edited. |
| POST | `/api/content/:id/checklist/items/:itemId/task` | agency | Convert to task (P62/P75). One accepted item makes at most one task; a repeat returns the same task. |
| POST | `/api/content/:id/threads/:threadId/task` | agency | Turn a feedback item straight into a task. Idempotent: one task per feedback item. |

#### [backend/src/modules/clients/clientSpace.routes.ts](../backend/src/modules/clients/clientSpace.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/client` | client | The client space: brand, agency, your role and what you can do |
| GET | `/api/client/members` | client | The client's people |
| PATCH | `/api/client/members/:userId` | client | Client admin changes a colleague's role (keeps one admin) |
| DELETE | `/api/client/members/:userId` | client | Client admin removes a colleague |
| GET | `/api/client/invitations` | client | Client admin's pending invitations |
| POST | `/api/client/invitations` | client | D48: a client Admin invites their own colleagues; the agency is told and can revoke. |
| POST | `/api/client/invitations/:id/resend` | client | Resend (new link, old one revoked) |
| POST | `/api/client/invitations/:id/revoke` | client | Cancel an invitation |
| GET | `/api/client/activity` | client | The client's feed: only `client`-visibility events, never internal ones (D20). |
| GET | `/api/client/settings` | client | F73: the client space's settings, as the client sees them. The contract stays with the agency. |
| PATCH | `/api/client/settings` | client | Client admins keep their contact details current. |

#### [backend/src/modules/clients/clients.routes.ts](../backend/src/modules/clients/clients.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/clients` | agency | Client directory: search, filters, status counts, health |
| POST | `/api/clients` | agency (owner, admin, manager) | Create a client (Manager+); creator gets access |
| GET | `/api/clients/:id` | agency | One client with health |
| PATCH | `/api/clients/:id` | agency | Edit client fields and contract (with rev) |
| POST | `/api/clients/:id/:action` | agency | activate / pause / complete / archive / restore |
| DELETE | `/api/clients/:id` | agency (owner, admin) | Soft delete (D61). Owner/Admin only; the client's people lose access at once. |
| GET | `/api/clients/:id/access` | agency | Agency people assigned to the client |
| POST | `/api/clients/:id/access` | agency | Assign a team member to the client |
| DELETE | `/api/clients/:id/access/:userId` | agency | Remove a team member's access |
| GET | `/api/clients/:id/members` | agency | The client's own people |
| PATCH | `/api/clients/:id/members/:userId` | agency | Change a client person's role (keeps one admin) |
| DELETE | `/api/clients/:id/members/:userId` | agency | Remove a client person (ends their sessions) |
| GET | `/api/clients/:id/invitations` | agency | Pending client invitations |
| POST | `/api/clients/:id/invitations` | agency | Invite a client person (first one must be admin) |

#### [backend/src/modules/content/clientContent.routes.ts](../backend/src/modules/content/clientContent.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/client/content` | client | Content hub: client labels, filters, counts, cover image |
| GET | `/api/client/content/:id` | client | Content detail: visible version, history, decisions, delays, what you can do |
| GET | `/api/client/content/:id/versions/:versionId` | client | Version history (D10): sent versions only, read-only. Opening the current one counts as "viewed" for Admins/Approvers (D04). |
| GET | `/api/client/content/:id/threads` | client | Client-visible feedback, plus your drafts |
| GET | `/api/client/content/:id/drafts` | client | The caller's unsent drafts on this content. Drafts on a replaced version are `stale` (D83). |
| POST | `/api/client/content/:id/threads` | client | Adds a comment to the caller's pending review: a draft only they can see until they submit (D14). |
| PATCH | `/api/client/content/:id/threads/:threadId` | client | Edit your draft comment |
| DELETE | `/api/client/content/:id/threads/:threadId` | client | Discard your draft |
| POST | `/api/client/content/:id/threads/:threadId/copy-to-current` | client | Move a draft from a replaced version to the current one |
| POST | `/api/client/content/:id/threads/:threadId/messages` | client | Reply in a feedback thread |
| POST | `/api/client/content/:id/threads/:threadId/reopen` | client | Reopen works only while the content is in review; on approved content, request changes instead (§6.5). |
| GET | `/api/client/content/:id/checklist` | client | The revision checklist the agency accepted, per sent version (D21). Never suggestions, never raw AI output. Each item is done once its task is done or its feedback was resolved. |
| POST | `/api/client/content/:id/review/submit` | client | "Send feedback": submits the caller's drafts without a decision. Anyone who can comment may do it (D14). |
| POST | `/api/client/content/:id/approve` | client | Approve the current version (asks about drafts; 409 if someone decided first) |
| POST | `/api/client/content/:id/request-changes` | client | Request changes, or pull an approval before publishing |

#### [backend/src/modules/content/content.routes.ts](../backend/src/modules/content/content.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/content` | agency | Production hub: filters, state counts, approval status |
| GET | `/api/content/queues` | agency | Queues for the agency's dashboards (§6.3): awaiting internal review (mine, or all for Manager+), ready for client, awaiting the client, changes requested, and approved-but-not-scheduled. |
| POST | `/api/content` | agency | Create content (optionally planned, or from a template) |
| GET | `/api/content/:id` | agency | Content detail: versions, decisions, job, derived status, revisions, timing |
| PATCH | `/api/content/:id` | agency | Edit content (with rev); moving a seen date needs a reason |
| POST | `/api/content/:id/versions` | agency | Upload a new version (server-numbered); can resolve feedback |
| PATCH | `/api/content/:id/versions/:versionId` | agency | A version can be edited only until it's submitted. After that, a change is a new version (D06). |
| POST | `/api/content/:id/start-production` | agency | planned → in production |
| POST | `/api/content/:id/submit` | agency | Submit for internal review or straight to ready-for-client |
| POST | `/api/content/:id/internal-review` | agency | approve / approve_and_send / request_changes |
| POST | `/api/content/:id/send` | agency | Send now, send later (`sendAt`), or re-send the same version with a reply from changes_requested. |
| POST | `/api/content/:id/continue-editing` | agency | ready for client → back to production |
| POST | `/api/content/:id/schedule` | agency | Schedule (manual or a connected account) |
| POST | `/api/content/:id/unschedule` | agency | Back to approved; cancels the job |
| POST | `/api/content/:id/mark-published` | agency | Mark published by hand with the link |
| POST | `/api/content/:id/retry-publish` | agency | Retry a failed or unknown publish |
| POST | `/api/content/:id/cancel` | agency | Cancel the content (Manager+ or owner) |
| POST | `/api/content/:id/restore` | agency | Restore cancelled content |

#### [backend/src/modules/dashboard/dashboard.routes.ts](../backend/src/modules/dashboard/dashboard.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/dashboard` | agency | Metrics, Needs Attention, pending approvals, workload, activity, client health |
| GET | `/api/dashboard/needs-attention` | agency | The full Needs Attention list |
| GET | `/api/dashboard/workload` | agency | P136–P139 / D56: each person's load, and per department. |
| GET | `/api/calendar` | agency | The agency's operational calendar: content publish dates, task and request due dates, plan months, with filters. |
| GET | `/api/client/calendar` | client | The client's calendar (D31, D32): publish dates of content they can see, and due dates of open requests. Meetings join in Phase 5. Shown in the client's timezone. |
| GET | `/api/client/home` | client | Greeting → Banner → one merged Needs Attention list (sorted by due) → Next meeting → Upcoming content. |

#### [backend/src/modules/feedback/conversations.routes.ts](../backend/src/modules/feedback/conversations.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/clients/:id/conversations` | agency | General (client + internal) and contextual conversations |
| GET | `/api/clients/:id/conversations/:threadId/messages` | agency | Messages in a conversation (paged) |
| POST | `/api/clients/:id/conversations/:threadId/messages` | agency | Post in a conversation |
| GET | `/api/client/conversations` | client | The client's conversations (client-visible only) |
| GET | `/api/client/conversations/:threadId/messages` | client | Messages (paged) |
| POST | `/api/client/conversations/:threadId/messages` | client | Post a message ("Contact agency") |

#### [backend/src/modules/feedback/feedback.routes.ts](../backend/src/modules/feedback/feedback.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/content/:id/threads` | agency | All feedback threads with messages (internal + client) |
| POST | `/api/content/:id/threads` | agency | Agency comments are posted at once. Internal ones (P50) are never visible to the client (D20). |
| POST | `/api/content/:id/threads/:threadId/messages` | agency | Reply in a thread |
| PATCH | `/api/content/:id/threads/:threadId` | agency | Assign (P58), start, resolve with a response. |
| GET | `/api/feedback` | agency | Submitted feedback across every client the person can see, newest first. Defaults to open + in progress. |

#### [backend/src/modules/files/files.routes.ts](../backend/src/modules/files/files.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| POST | `/api/files` | agency+client | Register an upload; returns a presigned PUT URL to R2 |
| POST | `/api/files/:id/complete` | agency+client | The browser calls this after its PUT finished. The object is checked in R2 before the file counts as uploaded. Processing (thumbnails, video frames) will run as a background job; for now it completes straight away. |
| GET | `/api/files` | agency+client | The resource library: ready files only, newest first. |
| GET | `/api/files/:id` | agency+client | File metadata |
| GET | `/api/files/:id/download` | agency+client | Short-lived signed download URL |
| DELETE | `/api/files/:id` | agency+client | Soft delete (D61). The object stays in R2, and a file used by a version can't be deleted at all. |

#### [backend/src/modules/files/library.routes.ts](../backend/src/modules/files/library.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/clients/:id/library` | agency | Library category counts and collections |
| POST | `/api/clients/:id/collections` | agency | Create a collection |
| PATCH | `/api/clients/:id/collections/:collectionId` | agency | Rename / change a collection |
| DELETE | `/api/clients/:id/collections/:collectionId` | agency | Deleting a collection keeps its files; they just leave the collection. |
| PATCH | `/api/clients/:id/library/files/:fileId` | agency | File a library item (collection, category, visibility) |
| GET | `/api/client/library` | client | Client's categories and client-visible collections |
| PATCH | `/api/client/library/files/:fileId` | client | Clients file their own library uploads into categories and collections. |

#### [backend/src/modules/health/health.routes.ts](../backend/src/modules/health/health.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/health` | public | Liveness check |

#### [backend/src/modules/invitations/invitations.public.routes.ts](../backend/src/modules/invitations/invitations.public.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/invitations/:token` | public | What the invite link shows (agency, brand, role, status) |
| POST | `/api/invitations/:token/accept` | public | Accept: existing account needs its password; new account is created |
| POST | `/api/invitations/:token/decline` | public | Decline the invitation |
| POST | `/api/invitations/:token/request-new` | public | D74: an expired link asks the inviter to resend. Nothing is reissued automatically. |

#### [backend/src/modules/meetings/meetings.routes.ts](../backend/src/modules/meetings/meetings.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/meetings` | agency | Meetings (filters by client, status, dates) |
| POST | `/api/meetings` | agency | Schedule a meeting |
| GET | `/api/meetings/:id` | agency | One meeting with transcript and summary |
| PATCH | `/api/meetings/:id` | agency | Edit a scheduled meeting (with rev) |
| POST | `/api/meetings/:id/:action` | agency | complete / cancel |
| PUT | `/api/meetings/:id/transcript` | agency | The transcript is pasted or uploaded by the agency and stays internal (D23). |
| PUT | `/api/meetings/:id/summary` | agency | Drafts the summary. Once shared it's locked, so the client never sees it change underneath them. |
| POST | `/api/meetings/:id/share` | agency | Share the summary with the client (D23, D24): agency action items become tasks and client ones requests, each exactly once. The client is notified. |
| GET | `/api/client/meetings` | client | Upcoming or past meetings (no transcript) |
| GET | `/api/client/meetings/:id` | client | One meeting; summary only once shared |

#### [backend/src/modules/notifications/notifications.routes.ts](../backend/src/modules/notifications/notifications.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/notifications` | agency+client | Your notification centre for this app |
| GET | `/api/notifications/unread-count` | agency+client | Unread badge |
| POST | `/api/notifications/read-all` | agency+client | Mark all read |
| POST | `/api/notifications/:id/read` | agency+client | Mark one read |
| GET | `/api/notifications/preferences` | agency+client | Category × channel preferences |
| PUT | `/api/notifications/preferences` | agency+client | Change preferences (invites and security stay on) |

#### [backend/src/modules/plans/plans.routes.ts](../backend/src/modules/plans/plans.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/plans` | agency | Content plans with item counts |
| POST | `/api/plans` | agency | Start a plan for a client and month (Manager+) |
| GET | `/api/plans/:id` | agency | A plan with its items, flags and comments |
| POST | `/api/plans/:id/items` | agency | Add one planned item |
| POST | `/api/plans/:id/items/bulk` | agency | Add many items (e.g. 12 Instagram + 6 LinkedIn) |
| POST | `/api/plans/:id/send` | agency | Send for review (P41): items become visible to the client, with a banner and a notification (Flow 4, D52, D64). |
| POST | `/api/plans/:id/threads/:threadId/messages` | agency | Reply to a plan comment |
| PATCH | `/api/plans/:id/threads/:threadId` | agency | Set a plan comment's status |
| GET | `/api/client/plans` | client | Plans sent to the client |
| GET | `/api/client/plans/:id` | client | A plan with items, comments, what you can do |
| POST | `/api/client/plans/:id/threads` | client | A comment on the whole plan or on one item, saved as the caller's draft until they submit (D80, D14). |
| DELETE | `/api/client/plans/:id/threads/:threadId` | client | Discard a draft plan comment |
| POST | `/api/client/plans/:id/threads/:threadId/messages` | client | Reply to a plan comment |
| POST | `/api/client/plans/:id/review/submit` | client | Send your plan comments |
| POST | `/api/client/plans/:id/approve` | client | Approve the plan |
| POST | `/api/client/plans/:id/request-changes` | client | Request plan changes (needs a comment) |

#### [backend/src/modules/publishing/integrations.routes.ts](../backend/src/modules/publishing/integrations.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/integrations/platforms` | agency | What each platform can do here, and whether its app credentials are set. |
| POST | `/api/integrations/:app/authorize` | agency | Start connecting Meta / LinkedIn / YouTube / X for a client |
| GET | `/api/integrations/:app/callback` | public | The platform sends the browser here. Public: the one-time state is the proof of who started it. |
| GET | `/api/integrations/pending/:state` | agency | The accounts found, without their tokens, for the person to choose from. |
| POST | `/api/integrations/pending/:state` | agency | Connect the chosen accounts |
| GET | `/api/integrations/connections` | agency | A client's connected accounts |
| POST | `/api/integrations/connections/:id/check` | agency | Checks a connection right now (and refreshes its token if needed). |
| DELETE | `/api/integrations/connections/:id` | agency | Disconnect (tokens dropped, history kept) |

#### [backend/src/modules/requests/requests.routes.ts](../backend/src/modules/requests/requests.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/requests` | agency | Requests with derived overdue |
| POST | `/api/requests` | agency | Create a request (draft or open; optionally from a template) |
| GET | `/api/requests/:id` | agency | One request with its files |
| PATCH | `/api/requests/:id` | agency | Edit a draft or open request (with rev) |
| POST | `/api/requests/:id/:action` | agency | publish / complete / reopen (needs a note) / cancel |
| GET | `/api/client/requests` | client | Needed From You list |
| GET | `/api/client/requests/:id` | client | Opening it records `viewedAt` (a timestamp, not a state, D35). |
| POST | `/api/client/requests/:id/files` | client | Attaches a file the client uploaded (purpose `request`) to the request. It joins the resource library under the request's category, shared with the agency (D36). |
| DELETE | `/api/client/requests/:id/files/:fileId` | client | Only files not yet submitted can be removed; submitted ones may already be in use (§6.6). |
| POST | `/api/client/requests/:id/submit` | client | Submit with files and/or a reply |

#### [backend/src/modules/search/search.routes.ts](../backend/src/modules/search/search.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/search` | agency+client | Search (P148–P150): `q` (2+ chars), optional `types` and `limit`. Grouped results with links, scoped like the lists: Managers/Members only their clients, client people only what was shared with them. |

#### [backend/src/modules/settings/settings.admin.routes.ts](../backend/src/modules/settings/settings.admin.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/admin/settings` | platform admin | Platform settings |
| PUT | `/api/admin/settings` | platform admin | Change platform settings |

#### [backend/src/modules/support/support.routes.ts](../backend/src/modules/support/support.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| POST | `/api/support/tickets` | agency+client | Raise a support ticket ("Report issue") |
| GET | `/api/support/tickets` | agency+client | Your tickets |
| GET | `/api/support/tickets/:id` | agency+client | One of your tickets |
| POST | `/api/support/tickets/:id/messages` | agency+client | Reply on your ticket |
| GET | `/api/admin/support` | platform admin | Support queue |
| GET | `/api/admin/support/:id` | platform admin | One ticket |
| POST | `/api/admin/support/:id/reply` | platform admin | Answer a ticket (emails the person) |
| PATCH | `/api/admin/support/:id` | platform admin | Change a ticket's status |

#### [backend/src/modules/tasks/tasks.routes.ts](../backend/src/modules/tasks/tasks.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/tasks` | agency | Tasks as a list or a board (?view=board) |
| POST | `/api/tasks` | agency | Create a task |
| GET | `/api/tasks/:id` | agency | A task with what it waits on and what waits on it |
| PATCH | `/api/tasks/:id` | agency | Edit a task, or block it by hand with a reason (with rev) |
| POST | `/api/tasks/:id/move` | agency | Move on the board (409 if someone moved it first) |
| PUT | `/api/tasks/:id/dependencies` | agency | Set what it waits on (tasks or requests; no cycles) |
| DELETE | `/api/tasks/:id` | agency | Soft delete (D61). Manager+, the owner or the creator. |
| GET | `/api/tasks/:id/comments` | agency | Task comments |
| POST | `/api/tasks/:id/comments` | agency | Comment on a task |

#### [backend/src/modules/team/team.routes.ts](../backend/src/modules/team/team.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/agency/members` | agency | Team list with filters |
| PATCH | `/api/agency/members/:userId` | agency (owner, admin) | Role, can-publish, titles, departments, capacity |
| POST | `/api/agency/members/:userId/disable` | agency (owner, admin) | Disable (ends their sessions) |
| POST | `/api/agency/members/:userId/enable` | agency (owner, admin) | Re-enable |
| DELETE | `/api/agency/members/:userId` | agency (owner, admin) | Removes the person from the agency: membership and client access go, and their sessions end at once. |
| POST | `/api/agency/transfer-ownership` | agency (owner) | The owner hands ownership to an active admin, and becomes an admin themselves. |
| GET | `/api/agency/invitations` | agency (owner, admin) | Agency team invitations. Client invitations are listed per client, under /clients/:id/invitations. |
| POST | `/api/agency/invitations` | agency (owner, admin) | Invite a team member |
| POST | `/api/agency/invitations/:id/resend` | agency | Resend an agency or client invitation |
| POST | `/api/agency/invitations/:id/revoke` | agency | Cancel an invitation |

#### [backend/src/modules/templates/templates.routes.ts](../backend/src/modules/templates/templates.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/templates` | agency | Templates by type |
| GET | `/api/templates/:id` | agency | One template |
| POST | `/api/templates` | agency (owner, admin, manager) | Create a template (Manager+); refuses status/approval steps |
| PATCH | `/api/templates/:id` | agency (owner, admin, manager) | Edit a template (with rev) |
| DELETE | `/api/templates/:id` | agency (owner, admin, manager) | Delete a template |
| POST | `/api/templates/:id/apply` | agency | Generates a task-list or content template's production tasks for a piece of content. |

#### [backend/src/modules/users/account.routes.ts](../backend/src/modules/users/account.routes.ts)

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/me/profile` | agency+client | Your profile |
| PATCH | `/api/me/profile` | agency+client | Name and timezone. Email changes aren't self-service: they'd need re-authentication and verification. |
| POST | `/api/me/password` | agency+client | Changing the password signs out every other browser, and emails a security notice. |
| GET | `/api/me/sessions` | agency+client | Where this login is signed in (P156). |
| DELETE | `/api/me/sessions/:id` | agency+client | Sign out one of your other devices |
| POST | `/api/me/sessions/revoke-others` | agency+client | Sign out everywhere else |
