# Things to Build

As of 2026-11-04. Compares [MATCHA_SYSTEM.md](MATCHA_SYSTEM.md) and [DECISIONS.md](DECISIONS.md) against `backend/` (Express 5, MongoDB, Zod) and `frontend/` (React 19, React Router, React Query, Tailwind).

## Summary

The backend is built for every phase except billing (a placeholder, by decision) and permission-aware search. The platform admin and the whole Agency Portal (web) are built on top of it. The Client App doesn't exist yet: client people land on a holding page at `/c`.

## What's built

Every existing frontend page is connected to the real backend.

### Backend

| Area | Built |
| --- | --- |
| Platform admin auth | Login, logout, `/me`, rate limiting |
| Agencies (admin) | List, view one, approve / reject / suspend, view members, impersonate (support view) |
| Subscriptions | Plan, status, seats, renewal date, notes |
| Admin overview | Dashboard numbers |
| Activity log | Records actions and lists them for the admin |
| Platform settings | Signups on/off, auto-approve, support session length |
| Agency auth | Signup (waits for approval), login, logout, `/me`, change password |
| Models | Agency, User, Membership (owner/admin/member), Session, PlatformAdmin, Activity, Settings |
| Scripts | Seed and demo seed |

### Frontend

| Area | Built |
| --- | --- |
| Platform admin | Login, Overview, Agencies list, Agency detail (with members), Approvals, Subscriptions, Activity, Settings |
| Agency | Login, Signup, and `/app` (placeholder: sidebar, user card, logout, support-view banner) |
| Shared | UI kit (Button, Card, Dialog, Field, Menu, Pill, Popover, Switch, Toaster), list kit (DataTable, filters, search, pagination), API client, error handling |

## What's left to build

Phases follow the build order in [MATCHA_SYSTEM.md §13](MATCHA_SYSTEM.md). Columns: **Backend**, **Agency Portal** (frontend) and **Client App** (frontend). ✗ = to build, partly = some exists, — = not needed there.

### Phase 0 — Foundations

The backend for Phase 0 is built (✓ below). It still needs a dev database to test against, R2 credentials, and an email provider in place of the dev mailer.

| Feature | Backend | Agency Portal | Client App |
| --- | --- | --- | --- |
| Agency roles Owner/Admin/Manager/Member, `can_publish`, capacity | ✓ | ✓ | — |
| Agency profile and setup, agency switcher | ✓ | ✓ | — |
| Team members: invite, change role, remove (ends their sessions) | ✓ | ✓ | — |
| Invitations (accept, expire, re-invite) | ✓ | ✓ | ✓ shared `/invite/:token` screen |
| Clients: create, directory, search, filters, contract fields | ✓ | ✓ | — |
| Assigning agency people to clients | ✓ | ✓ | — |
| Client members and roles, client login, brand switcher | ✓ | ✓ | ✗ |
| Data access scoped to agency and client | ✓ | — | — |
| File uploads (presigned) and signed downloads | ✓ | ✓ | ✗ |
| Event log with visibility (grows from Activity) | ✓ | ✓ | ✗ |
| Notifications engine and notification centre | ✓ | ✓ | ✗ |
| App layout, navigation, route guards | — | ✓ | ✗ (whole app shell) |

### Phase 1 — Core loop

Backend built and covered by `npm test` (backend). Voice transcripts stay pending until a speech-to-text provider is chosen.

| Feature | Backend | Agency Portal | Client App |
| --- | --- | --- | --- |
| Content and its state machine | ✓ | ✓ | ✗ content hub, card, detail |
| Versions and files, uploading a new version | ✓ | ✓ | ✗ version selector, history, compare |
| Internal review and approval | ✓ | ✓ | — |
| Send to client | ✓ | ✓ | — |
| Creative viewer (image, carousel, video) | — | ✓ | ✗ |
| Feedback threads: comment, annotate, timestamp, voice | ✓ | ✓ except voice notes | ✗ |
| Pending feedback drafts, then submit | ✓ | — | ✗ |
| Approve / request changes | ✓ | ✓ | ✗ |
| Feedback inbox and resolve | ✓ | ✓ | ✗ resolved view |
| Manual publish | ✓ | ✓ | ✗ status view only |

### Phase 2 — Revision engine

Backend built and covered by `npm test`. The AI checklist uses Claude (`AI_MODEL`, default `claude-haiku-5-5`) and is off until `ANTHROPIC_API_KEY` is set. Task dependencies on requests arrive with Phase 4.

| Feature | Backend | Agency Portal | Client App |
| --- | --- | --- | --- |
| Tasks, board, dependencies, blocked flag | ✓ | ✓ | — |
| Turning feedback into tasks | ✓ | ✓ | — |
| AI revision checklist (background job) | ✓ | ✓ | ✗ accepted checklist only |
| Revision progress and limits | ✓ | ✓ | ✗ |

### Phase 3 — Command centres

Backend built and covered by `npm test`. Everything is computed live (D51). "Next meeting" on the client Home stays empty until meetings arrive in Phase 5.

| Feature | Backend | Agency Portal | Client App |
| --- | --- | --- | --- |
| Dashboard, Needs Attention, pending approvals, team workload | ✓ | ✓ | ✗ Home, Needs Attention, All caught up |
| Banners (manual and automatic) | ✓ | ✓ | ✗ banner and detail |
| Recent activity feed | ✓ | ✓ | — |

### Phase 4 — Planning and requests

Backend built and covered by `npm test`. Templates cover content, campaign, task-list and request; report and meeting templates come with Phases 5–6. Meetings join the calendar in Phase 5.

| Feature | Backend | Agency Portal | Client App |
| --- | --- | --- | --- |
| Campaigns and briefs | ✓ | ✓ | ✗ (in client space) |
| Monthly content plans: send and approve | ✓ | ✓ | ✗ plan and item detail |
| Requests (Needed From You) | ✓ | ✓ | ✗ list, detail, upload |
| Calendar | ✓ | ✓ | ✗ month and day |
| Delay and at-risk indicators | ✓ | ✓ | ✗ |
| Templates | ✓ | ✓ | — |

### Phase 5 — Brand and meetings

Backend built and covered by `npm test`.

| Feature | Backend | Agency Portal | Client App |
| --- | --- | --- | --- |
| Client onboarding (intro, personality, likes, dislikes, references, assets) | ✓ | ✓ | ✗ onboarding flow |
| Brand DNA, its history, creative guidelines | ✓ | ✓ | ✗ |
| Resource library and collections | ✓ | ✓ | ✗ |
| Meetings: summary, decisions, action items | ✓ | ✓ | ✗ |
| Communication (general, contextual, internal threads) | ✓ | ✓ | ✗ |

### Phase 6 — Publishing and insight

Backend built. Instagram, Facebook, LinkedIn, YouTube and X integrations are written against the platforms' APIs but untested live until the developer apps exist (keys in `.env`); the scheduler, worker, retries and "unknown outcome" handling are tested with a fake platform. Other platforms that could be added are listed in `PLATFORM_CATALOG` (lib/platforms/index.ts).

| Feature | Backend | Agency Portal | Client App |
| --- | --- | --- | --- |
| Platform connections, scheduler, publish worker | ✓ | ✓ | ✗ status |
| Analytics | ✓ | ✓ | ✗ |
| Reports (frozen snapshot, shared with client) | ✓ | ✓ | ✗ |

### Phase 7 — Admin

Backend built except billing (a placeholder endpoint only, by decision) and permission-aware search (not started).

| Feature | Backend | Agency Portal | Client App |
| --- | --- | --- | --- |
| Agency billing | placeholder only (by decision) | ✗ | — |
| Settings, integrations, permissions | ✓ | ✓ | ✗ profile, members, preferences |
| Search (respects permissions) | ✗ | ✗ | ✗ |
| Support and help | ✓ | ✓ | ✗ |

## Cross-cutting work and notes

- **Done (backend):** MongoDB job queue (`lib/jobs.ts`), Resend email through the queue, mandatory 2FA for platform admins and agency owners, idempotency keys, optimistic locking (`rev`), soft delete, and 45 end-to-end tests (`npm test -w backend`). See [BACKEND.md](BACKEND.md) for the full guide and API reference.
- **Still open (backend):** billing, permission-aware search, speech-to-text for voice notes, media processing (thumbnails, video frames), LinkedIn/X video uploads, push notifications (rows are queued, nothing sends them).
- **Frontend:** the Agency Portal is built (React, lazy-loaded routes). Still open there: voice notes on feedback, and search (needs the backend first). 2FA is switched off for now (`MFA_REQUIRED`, default false); turn it on before going live. Uploads, previews and logos need R2 credentials.
- **Open decision:** whether the Client App is a separate app or routes inside `frontend/`. The docs describe it as mobile-first.
