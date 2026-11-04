# Matcha — Decision Log

Every place where [MATCHA_SYSTEM.md](MATCHA_SYSTEM.md) differs from, simplifies, or fills a gap in the two spec PDFs (`res/Matcha App.pdf` = F-numbers, `res/Matcha portal.pdf` = P-numbers).

Each entry has up to three lines:
- **Why** — the reason for the decision.
- **Old wasn't enough** — what was wrong or weak in the spec's version.
- **Made up** — what was missing from the spec and had to be invented.

To change a decision: edit its entry, add a new line `**Changed:** <date> — <why>`, and update MATCHA_SYSTEM.md.

---

## A. Statuses & state machines

### D01 — One canonical content state machine; all other status lists are derived views
- **Why:** One source of truth means the portal, the client app and the dashboards can never disagree about where a post is.
- **Old wasn't enough:** The spec has five overlapping status lists for the same object (F16, F17, P48, P83, P177), which would drift apart as separate data.
- **Made up:** The exact state names and transitions, including `ready_for_client` as a hold, the `publishing` lock, and cancel/restore.
- **Changed:** 2026-11-03 — after review, `publish_failed` was removed (a failure stays in `scheduled`, with the error on the job). Added `publishing` (D78) and `changes_requested → client_review` (agency re-sends the same version with a reply).

### D02 — Removed the duplicate "Changes in Progress" state; `changes_requested → in_production` when the agency uploads a new version
- **Why:** One state per meaning keeps the flow unambiguous. The client still sees "Changes Requested" until work visibly restarts.
- **Old wasn't enough:** P48 uses "Changes in Progress" twice (after internal review and after client review), so you can't tell which loop the content is in.
- **Made up:** The automatic trigger: uploading a new version moves `changes_requested` to `in_production`.

### D03 — Client status labels and filters: Review Required / In Progress / Changes Requested / Approved / Scheduled / Published / Cancelled
- **Why:** Clients get every status that needs them or informs them, with agency-internal steps folded into "In Progress".
- **Old wasn't enough:** The original four (Published/Review/In Progress/Cancelled) hide approvals and scheduling. The full backend list exposes internal review to clients (App Q12).
- **Made up:** The exact backend-to-client mapping table (MATCHA_SYSTEM §6.2).

### D04 — Approval status (Not sent / Sent / Viewed / Changes requested / Approved) is derived, not stored; "Viewed" counts only Admin/Approver opens
- **Why:** It is fully computable from the content state plus two version timestamps, so it can't go out of sync, and "Viewed" means a decision-maker has actually looked.
- **Old wasn't enough:** P83 implies a second, separate approval state machine running in parallel to the content state.
- **Made up:** `sent_to_client_at` and `first_viewed_at` timestamps on the version.

### D63 — "Review Required" is the single client label for anything awaiting their decision (plans and creatives); agency dashboards still separate "Awaiting review" (own queue) from "Awaiting approval" (client)
- **Why:** One phrase means one meaning for the client, while the agency keeps the P06/P18 split (mapping in MATCHA_SYSTEM §6.3).
- **Old wasn't enough:** The spec mixes "Review Required" and "Approval Required" for the same kind of ask (P08, F14).

### D64 — Content becomes visible to the client only after its plan is sent or it is first sent for review
- **Why:** The client never sees half-baked agency drafts, and the rule is a single simple condition.
- **Made up:** The spec never says when a piece of content first becomes visible to the client.

### D65 — A publish failure shows to the client as a neutral "Publishing delayed" badge on Scheduled content
- **Why:** Failure handling is the agency's job. The client only needs to know it's not live yet, in neutral language.
- **Old wasn't enough:** F80 shows a raw "Failed" status to clients, which clashes with the spec's own "neutral, no blame" principle (F51).

---

## B. Versions, approval & revisions

### D05 — Approval is bound to a specific version; only that version can be published; a new version voids approval and cancels the schedule
- **Why:** It guarantees that what the client approved is exactly what goes live.
- **Old wasn't enough:** The spec never says which version gets published, or what happens to an approval when a new version is uploaded afterwards.
- **Made up:** The `approved_version_id` field and the "approval void → re-review" behaviour.

### D06 — Caption and hashtags are part of the version, so the client approves them together with the creative
- **Why:** The caption is public brand copy, so the client must approve the exact text that is published.
- **Old wasn't enough:** The spec approves only the "creative", which leaves captions editable after approval with no client sign-off.

### D07 — Any client Admin/Approver can approve; any of them can pull an approval until publishing starts; if two act at once, the second must confirm ("Priya approved at 4:42 — still request changes?")
- **Why:** This is the simplest rule that works for both one-person and multi-person client teams, with no partial-approval states and no accidental overrides.
- **Old wasn't enough:** App Q01 / Portal Q05 were unresolved.
- **Made up:** The conflict-then-confirm behaviour.
- **Changed:** 2026-11-03 — dropped "first decision is final", because it contradicted D08 (pulling an approval is allowed anyway). From `changes_requested`, another approver may still approve.

### D71 — Dropped "auto-approve after N days" and the "all approvers must approve" mode (both exist in the current frontend settings)
- **Why:** Silence is not consent, and requiring several approvals adds partial states that slow every post.
- **Old wasn't enough:** Auto-approve can publish content the client never saw. "All" mode has no defined behaviour when one approver says yes and another says no.

### D08 — The client may pull an approval ("Request changes") until publishing starts (this cancels the schedule and alerts the agency urgently)
- **Why:** It is better to pull a post than publish something the client now objects to.
- **Made up:** The spec has no way back after approval.

### D09 — Revision = a version the client requested changes on (counted once per version); internal rounds don't count; going over the limit is flagged, not blocked
- **Why:** It is easy to explain on a contract ("2 rounds of changes"), easy to count, and never blocks work.
- **Old wasn't enough:** App Q02 was open. Counting each feedback item punishes detailed feedback, and counting every version punishes internal fixes.
- **Made up:** The per-client "revisions included" default with a per-content override, and the over-limit flag.

### D10 — Old versions are viewable read-only; comment and approve only on the current version; side-by-side comparison for both sides
- **Why:** Clients get history and context without being able to act on outdated work. Side-by-side needs no diff engine.
- **Old wasn't enough:** App Q03 and F44/P79 were undecided.

### D60 — The server assigns version numbers in a transaction; a version can't be sent while its files are still processing
- **Why:** This prevents duplicate "V04"s from parallel uploads, and stops a review request pointing at a half-processed video.
- **Made up:** P77 says the system "creates V04" but doesn't define how, or what happens during processing.

---

## C. Feedback, annotation & AI

### D11 — Feedback has one optional anchor `{version_file_id, time_ms, shapes}` covering carousel slides, video timestamps and annotations, for client *and* agency feedback alike
- **Why:** One feedback object handles every creative type, so there are no separate systems for carousel, video and image.
- **Old wasn't enough:** App Q04 asked whether client feedback can belong to one slide, and P56 asked the same for agency feedback. The answer to both is yes, because the slide is just one anchor field.
- **Changed:** 2026-11-03 — the anchor stores the file id within its own version instead of a slide index, so reordered or removed slides can't misplace old feedback.

### D12 — Annotations are stored as vector shapes in 0–1 normalised coordinates, plus a rendered snapshot image
- **Why:** Annotations stay correctly placed on any screen size and aspect ratio, and the snapshot still works in lists and notifications.
- **Old wasn't enough:** F28/F31 don't say how the drawing itself is stored. Saved as a flat image only, it can't be re-drawn crisply at other sizes.

### D13 — Video frame annotation = timestamp + shapes; the frame image is generated server-side
- **Why:** Browser canvas capture of videos often fails (cross-origin, codecs). Storing the time plus server-side extraction is reliable.
- **Made up:** The spec doesn't say how the "captured frame" (F31) is produced.

### D14 — Client feedback is drafted as a pending review and sent all at once via "Send feedback" (any commenter), "Request changes" or "Approve"; replies in existing threads post instantly
- **Why:** The agency gets one complete batch per round: no drip notifications, no work started on half-given feedback, and a clean input for AI.
- **Old wasn't enough:** The spec has both instant comments (F24) and a "Submit" step (F39) without saying how they relate.
- **Made up:** The pending/draft state, saved server-side so nothing is lost if the app closes.
- **Changed:** 2026-11-03 — added "Send feedback" (no decision). Before this, Contributors had no way to submit their drafts.

### D15 — Feedback status is open / in progress / resolved; "Reopened" is shown when a reopened item is open again
- **Why:** "Show me open items" is one simple condition, and the user still sees "Reopened".
- **Old wasn't enough:** A separate Reopened state (F36/P61) forces every open-item query and count to remember two states.

### D16 — When the client approves a version, still-open feedback on that content is closed as "Closed on approval"; an approver with unsent drafts is asked first (Request changes instead / discard / post as plain messages)
- **Why:** Approval means the client is satisfied, so leftover items shouldn't hang in Needs Attention forever. The prompt makes sure a last-minute wish isn't silently closed.
- **Made up:** The spec doesn't define what happens to unresolved feedback after approval. Linked open tasks get a "cancel task?" flag.

### D17 — Feedback items and conversations share one Thread + Message engine (a feedback item is a thread with an anchor and a status)
- **Why:** Replies, mentions, attachments, voice notes and notifications are built once and behave the same everywhere.
- **Old wasn't enough:** The spec describes feedback threads (F25/P60) and communication (F66/P110–P113) as two separate systems with the same parts.

### D21 — AI interpretation is agency-only, asynchronous and never blocking; clients see only the checklist the agency accepted (the one exception is the plain voice transcript, D22); each accepted item makes at most one task
- **Why:** AI mistakes never reach the client, AI downtime never stops work, and retries never create duplicate tasks.
- **Old wasn't enough:** App Q07 / Portal Q09 / F90 / P171 were open, and the spec never covers AI failure or duplicate task creation.
- **Made up:** The suggestion → accept flow with an audit trail and idempotency.

### D22 — Voice transcripts are shown to everyone who can hear the note, labelled "Auto-transcript", and not editable
- **Why:** It helps accessibility and speed-reading, while the audio stays the source of truth.
- **Old wasn't enough:** F34/P71 left transcript visibility and editing undecided.

---

## D. Communication & visibility

### D18 — Communication = threads on a context (content, campaign, meeting, request, task) + one "General" thread per client
- **Why:** Most talk stays attached to its work. The single General thread stops clients drifting back to WhatsApp for "other" topics.
- **Old wasn't enough:** App Q05 / F66 were unresolved. Contextual-only leaves no place for general questions.

### D19 — Clients can talk directly with any agency person in a shared thread; the account manager is auto-subscribed to all client threads
- **Why:** There is no bottleneck, and the account manager still sees everything.
- **Old wasn't enough:** App Q06 / Portal Q08 were open. Forcing everything through the account manager slows every answer.

### D20 — Internal vs client visibility is enforced in the server's data layer; internal and client composers are separate tabs, never one toggle
- **Why:** A leak of internal notes to a client is the worst trust failure, so it must be impossible, not just unlikely.
- **Old wasn't enough:** P50/P112/P114 say "never exposed" but describe only UI separation.

### D67 — Client "Contact agency" opens the General thread; "Report issue" goes to Matcha support
- **Why:** Each help action has an obvious owner.
- **Made up:** F74 lists both actions without saying where they go.

---

## E. Publishing, schedule & calendar

### D25 — Only the agency publishes: Owner/Admin plus anyone given the single `can_publish` flag; clients only approve; approval moves content to "Ready to Schedule" and never publishes automatically
- **Why:** There is one accountable publisher. The Social Media Manager can publish without also getting Manager powers, and there is still no permission matrix.
- **Old wasn't enough:** App Q09 / Portal Q11–Q12 / F81 were open, and tying publishing to the Manager role forces SMMs into a role that's too broad.
- **Changed:** 2026-11-03 — replaced "Manager+ by default" with the `can_publish` flag.

### D26 — Added a "manual" publishing account: scheduling works the same, the job reminds the publisher at the time, and "Mark as published" (with URL) is allowed from approved or scheduled
- **Why:** The whole workflow — including an honest "Scheduled for Sep 8" for the client — works from day one, before any social API integration is approved.
- **Made up:** The spec assumes automatic publishing even though integrations are "not yet defined" (P157).

### D27 — The publish job claims a `publishing` lock first, posts only the approved version, never re-posts once an external id exists, and connections are checked 24 h ahead
- **Why:** Prevents double posts, publishing unapproved changes, and silent failures from expired tokens.
- **Made up:** P119 covers only failure display, not how failures are prevented.

### D28 — One `publish_date` field (target date) for the whole life of a content item; scheduling writes it and the job reads it; "Scheduled" only means approved and queued
- **Why:** One date field with one meaning, so the calendar, the queue and the shift log can never disagree.
- **Old wasn't enough:** F51 shows "Scheduled · Sep 8" on content that is still pending review, which contradicts "Scheduled" as an approved state.

### D29 — Clients see "Review pending since…", "Approval needed by <date>" and "Schedule shifted · N days"; the agency sees At risk (not approved and less than 3 days before "needed by") and Overdue for approval ("needed by" passed)
- **Why:** Neutral but actionable for the client, and an early warning for the agency.
- **Old wasn't enough:** App Q13 was open, and "at risk" had no definition.
- **Made up:** "Needed by" = publish time − approval lead time (24 h), and a 3-day risk window. Both are settings.
- **Changed:** 2026-11-03 — the first rule only fired once content was already late, so the separate risk window was added.

### D30 — Unapproved content is never auto-published; a missed slot (date passed and not scheduled/publishing/published/cancelled — this includes approved-but-never-scheduled) alerts the agency to pick a new date, and the shift is logged with a reason
- **Why:** Brand safety beats punctuality, and no post can silently miss its day.
- **Made up:** The spec doesn't say what happens when the date arrives without approval.

### D31 — One calendar engine with layers: the client sees publish dates, meetings and request due dates; the agency sees all operations with filters
- **Why:** Same data, different lenses, so nothing is duplicated.
- **Old wasn't enough:** App Q11 / Portal Q14 were open. The current code stores calendar items in a separate table, unlinked from content.

### D32 — Week view is agency-only; the client gets month + expanded day
- **Why:** Clients have low volume on a mobile screen. Week view matters for the agency's operational scheduling.
- **Old wasn't enough:** F49 was marked "decision needed".

### D59 — Store UTC; publish times and date-only fields use the client's timezone; the viewer's own time is shown when different
- **Why:** Posts go live on the audience's clock, and agency and client may be in different zones.
- **Made up:** The spec never mentions timezones.

---

## F. Planning, requests & tasks

### D33 — Content plan items ARE content rows in `planned` state (no separate plan-item object)
- **Why:** There is no copy to keep in sync. The plan, content hub and calendar are views of the same rows.
- **Old wasn't enough:** F46/P37/P44 imply plan items are converted into content, which duplicates data and status lists.

### D34 — Plan approval is an alignment checkpoint, not a gate; changes after approval are flagged "updated since approval" and the client is notified
- **Why:** Agencies often start early, and each creative is approved individually anyway.
- **Made up:** Plan-level Approve / Request changes and its states. P41 says only "Send for review".

### D35 — Requests have 4 states: open / submitted / completed / cancelled (plus draft); "viewed" is a timestamp
- **Why:** Every state is something the system can actually know, and the client sees three plain labels.
- **Old wasn't enough:** P93 has 8 states. "Viewed" is an event that can happen in parallel to other states, so it fits a timestamp better. "In Progress" can't be detected (a client thinking isn't an event), and "Accepted" vs "Completed" overlap. P90 then lists a different set.

### D36 — Files uploaded to a request land automatically in the client's resource library, linked to the request
- **Why:** Assets are findable later, and P31 "used in" tracking works.
- **Made up:** The spec doesn't say where request uploads are stored.

### D37 — Task statuses are To Do / In Progress / In Review / Done (+ Cancelled); "Blocked" is a flag with a reason, not a board column
- **Why:** A blocked task keeps its place and returns there when unblocked.
- **Old wasn't enough:** P88 makes Blocked a column, which loses where the task was. The current code also mixes in "Scheduled" and "On Hold".

### D38 — Tasks can depend on requests or tasks; they auto-block while the dependency is open and auto-unblock (with a notification) when it reaches any end state (completed or cancelled)
- **Why:** P89 "blocked by product photography" works without anyone remembering to update it.
- **Made up:** The automatic block/unblock behaviour.

### D23 — Meeting transcript is agency-only; the client sees Summary, Decisions, Action items and Needed-from-client only after the agency clicks "Share"
- **Why:** Transcripts can hold internal or off-hand talk, and the shared summary is a checked, clean record.
- **Old wasn't enough:** App Q08 / Portal Q10 were open, and the spec doesn't say whether an AI summary reaches the client without an agency check.
- **Made up:** The draft → shared step on the meeting summary.

### D24 — Meeting action items become real Tasks (agency owner) or Requests (client owner) when the summary is shared
- **Why:** Action items get due dates, reminders and tracking for free, with no separate action-item system.
- **Old wasn't enough:** F62/P109 describe action items as their own object that would duplicate tasks.

### D55 — Templates only prefill fields and generate *production* task lists (brief, copy, design …, never review/approve/schedule/publish steps); statuses and the content state machine are fixed and not customisable
- **Why:** Custom workflows or statuses would break the client mapping, the dashboards and the approval guarantees.
- **Old wasn't enough:** P142 "workflow template" and P155 "default statuses" would turn the core lifecycle into per-agency configuration.

---

## G. Brand, files & onboarding

### D39 — One File object for brand assets, resources, request uploads and creatives, with category, collection and "used in" links
- **Why:** One upload pipeline, one permission check, one library.
- **Old wasn't enough:** F08, F64, P27, P30 and request uploads describe the same thing four ways.

### D40 — Likes, dislikes and references are one Brand Reference object with a `sentiment` field
- **Why:** Dislikes have "the same structure as likes" (F06), and References (F07: image, link, comment, category, added by) carry the same data, so one form, one list and one filter cover all three.

### D41 — The client and the agency can both edit Brand DNA anytime; every change is logged with before/after; concurrent edits get a "reload" conflict
- **Why:** The brand belongs to the client, the agency stays informed, and nobody silently overwrites anyone.
- **Old wasn't enough:** App Q14 was open, and P24 history had no data source.

### D42 — Brand personality axes are stored as data (axis key → 0–100 value from a continuous slider), not as fixed fields; the preview labels each axis by the pole it leans toward
- **Why:** The axes "have not been finalised" (F04), so they can change later without a database migration.
- **Old wasn't enough:** The F04 preview mockup (App PDF p.4, image) shows fixed labels and drops "Accessible" and "Playful", so it can't reflect what the client actually chose.
- **Made up:** The 0–100 scale and the "leans-toward" preview rule.

### D72 — Onboarding has exactly six equal-weight sections (Brand Introduction, Personality, Likes, Dislikes, References, Assets); each completes when the client taps "Done" (or "Nothing to add"); Welcome and "What you can do" are intro screens, not steps
- **Why:** One fixed list drives the client's "n of 6" progress and the agency's percentage, so they always match, and a client with nothing to add is never stuck at 83%.
- **Old wasn't enough:** The App PDF mockups (pp.1–4, images) show three different step counts ("1 of 6", 7 dots, "1 of 4"). Portal P16's "5 of 6 = 83%" settles it at six.
- **Made up:** Explicit "Done" per section. Brand Introduction needs its first three answers before Done. P16's "Assets — 2 remaining" = the agency's open asset requests.

### D73 — Onboarding is a linear wizard the first time and a section hub (with ✓) afterwards
- **Why:** New clients get guidance, and returning clients can jump straight to the section they want to edit.
- **Old wasn't enough:** The App PDF mockups show a hub list (p.2) and a 1–5 wizard (p.3) for the same questions, without choosing one.

### D74 — An expired invitation offers "Request New Invitation", which notifies the inviter to resend; nothing is auto-reissued
- **Why:** The client isn't stuck, and an old leaked link can never create fresh access by itself.
- **Old wasn't enough:** The F01 mockup (App PDF p.1, image) shows the button, but neither PDF says what it does on the agency side.
- **Made up:** The notify-the-inviter → one-tap-resend behaviour, falling back to the account manager and Admins if the inviter has left.

### D75 — Feedback items get pin numbers per content and per visibility, increasing across versions (client ① ② ③; internal I-1, I-2), shown on the creative and in the Feedback Overview
- **Why:** "Fix #2" is unambiguous across versions, and a numbering gap never reveals a hidden internal item.
- **Old wasn't enough:** The numbered markers appear in the F28/F35 examples, but the spec never defines them as part of the feedback data.
- **Changed:** 2026-11-03 — numbering per version would have produced two different "#2"s once old feedback stayed open into V04.

### D76 — One rule for new versions: uploading from any state after submit (ready, internal review, client review, changes requested, approved, scheduled) moves content to `in_production`, voids approval and cancels any job
- **Why:** A single rule replaces three per-state edges, and the agency is never stuck waiting for the client to act on an outdated version.
- **Old wasn't enough:** Uploading during client review was undefined, leaving the client approving an old version or the agency blocked.
- **Made up:** The "V03 was withdrawn — a new version is coming" message to the client.

### D77 — Cancel cancels the publish job and closes items linked only to the content; restore goes to `planned` if there are no versions, else `in_production`, and clears approval
- **Why:** Restored content always lands somewhere sensible, with no stale approval.
- **Made up:** The spec has no cancel/restore rules.

### D78 — Added an in-flight `publishing` state; the job claims it atomically before calling the platform, and pulling approval or uploading a version is refused while publishing
- **Why:** A post can never go live while the system shows "Changes Requested".
- **Made up:** The spec's publishing flow (Approved → Scheduled → Published → Failed) ignores the seconds or minutes a platform call takes.

### D79 — Publish failures stay in `scheduled`, with the error on the job; an "unknown outcome" (timeout after sending) is never auto-retried and needs a human check
- **Why:** A separate failed state had no way out for change-of-mind, and blind retries can double-post because social APIs don't support idempotency keys.
- **Old wasn't enough:** The first draft's `publish_failed` state trapped content, and its "idempotency key" claim doesn't hold for Meta or LinkedIn.

### D80 — Content-plan feedback uses the same threads (context `content_plan`) and pending → submit flow; "Request changes" on a plan requires at least one comment
- **Why:** The agency always learns *what* to change, using the same engine as creatives.
- **Made up:** The spec has plan review (P41/F46) but no plan comment model.

### D81 — Defined lifecycles for Campaign, PublishJob, Report, Banner and version-file uploads
- **Why:** Every status shown anywhere comes from a defined machine (MATCHA_SYSTEM §6.11).
- **Made up:** The spec shows these statuses (P32, P119, P128, F12, F87) without their transitions.

### D82 — The client gives free-text answers in onboarding; the agency turns them into structured Audience (primary, secondary, age, location, behaviour, interests), Positioning, Tone and Visual identity in the portal
- **Why:** Clients answer in their own words, and the agency's professional framing fills the Brand DNA sections that no onboarding screen asks for.
- **Old wasn't enough:** F09/P21/P22 show these sections, but no client screen collects them, so they would stay empty.

### D83 — When a new version replaces the one being reviewed, each person's unsent drafts on the old version are shown to them with "Discard" or "Copy to V04"
- **Why:** Feedback someone was still writing never silently disappears.
- **Made up:** The spec doesn't cover drafts across versions.

### D61 — Soft delete / archive for clients, content, files and threads; files used by a version can't be hard-deleted
- **Why:** Approval history, feedback and audit must never point at missing data.
- **Made up:** The spec has no deletion rules.

---

## H. People, roles & tenancy

### D43 — Agency (tenant) → Clients (exactly one brand each) → members; one login can hold memberships in many agencies and clients, with switchers
- **Why:** This one simple model covers multi-brand companies, clients working with two agencies, and freelancers in two agencies.
- **Old wasn't enough:** App Q15 / Portal Q01–Q02 / P04 were open.

### D44 — Agency permission roles are Owner / Admin / Manager / Member; job titles and departments are separate tags
- **Why:** Permissions stay small and predictable, while titles stay free for display and workload grouping.
- **Old wasn't enough:** P133 mixes 9 job titles with permissions, which would mean a giant permission matrix per title.
- **Changed (2026-11-04):** The proposed read-only Viewer role was dropped. Read-only people can be Members with no client access, or client Viewers on the client side.

### D45 — Team members are agency-wide accounts with per-client access; a person can be in several departments
- **Why:** Effective permission = role ∩ client access. Easy to reason about and already how the server works.
- **Old wasn't enough:** Portal Q03 was open.

### D46 — Internal approval: Manager+ or the content's assigned reviewer; internal review can be switched on/off per client
- **Why:** Big agencies keep quality control, and two-person agencies aren't forced through a pointless step.
- **Old wasn't enough:** Portal Q04 was open.

### D47 — Client roles are Admin / Approver / Contributor / Viewer; a client always keeps at least one Admin; the only per-client switch is "Show analytics to client"
- **Why:** Each role differs by one clear capability, and there is always someone able to approve.
- **Old wasn't enough:** P172 has Owner and Admin with no stated difference. P173's per-area permission grid (content, feedback, approvals, analytics …) is a matrix nobody would maintain, and the four roles already cover it.

### D48 — A client Admin can invite their own colleagues (the agency is notified and can revoke)
- **Why:** This removes agency busywork, and client seats are free (D57), so there's no abuse incentive.
- **Made up:** P15 only lets the agency invite.

### D49 — Invitations are bound to the invited email, expire after 7 days, and resending revokes the old link
- **Why:** A forwarded link can't grant access to the wrong person, and only the latest link works.
- **Made up:** Expiry length, email binding and resend behaviour.

---

## I. Home, notifications & activity

### D50 — Client Home = Greeting → Banner → one merged Needs Attention list → Next meeting → Upcoming content
- **Why:** One list sorted by due date answers "what needs me now?" without repeating items.
- **Old wasn't enough:** F11 lists Needs Attention, Approvals and Needed From You as separate blocks, but they contain the same items (F14 already includes reviews and requests).

### D51 — All counts and attention lists are computed live from source data; deep links always open the current state
- **Why:** Counts never drift, and an old notification shows "Approved by Priya at 4:42" instead of an error.
- **Made up:** Stale-link behaviour isn't covered in F69/P146.

### D52 — Added a Banner manager to the portal, plus automatic banners from events (e.g. plan sent)
- **Why:** The client's Dynamic Banner (F12) needs a creator.
- **Made up:** The portal inventory has no feature for creating banners at all.

### D53 — Reports are frozen snapshots; scheduled reports create a draft for review (never auto-share); shared reports appear in the Client App under Analytics → Reports
- **Why:** A shared report doesn't silently change later, nothing unreviewed reaches the client, and the client has somewhere to find it.
- **Made up:** P129 "share with client" has no client-side destination in the App spec.

### D54 — One append-only event log powers activity feeds, Brand DNA history, approval history, audit and notifications
- **Why:** Every history is one table with one write path, so histories can't disagree.
- **Old wasn't enough:** P10, P20, P24, P84 and P151–P153 describe five separate histories.

### D68 — Notifications are per category × channel; invites and security alerts are mandatory; urgent items (review required, new request, meeting soon, publish failed, approval pulled) are sent instantly, the rest go in an email digest
- **Why:** Important things are never missed, and inboxes aren't flooded.
- **Made up:** The urgent vs digest split and the mandatory categories.

### D69 — Client health: Blocked = work blocked by an overdue client request; Needs attention = overdue tasks, an approval past "needed by", a publish failure, or onboarding stuck >14 days; otherwise On track
- **Why:** The health badge is computed by clear rules instead of someone's opinion.
- **Made up:** P19 lists the states but no rules.

---

## J. Business & platform

### D56 — Workload capacity = maximum active tasks per person (default 10): Available < 80% ≤ At capacity ≤ 100% < Overloaded
- **Why:** It is computable today from task data, with no time tracking needed.
- **Made up:** P137 shows the labels but defines nothing.

### D57 — Pricing (proposal): per-agency plan with limits on agency seats, active clients and storage; client users are always free; AI usage under fair use
- **Why:** Agencies are never discouraged from inviting clients, and it matches the server's existing seat and client limits.
- **Old wasn't enough:** Portal Q15 was open.
- **Made up:** The whole model is a proposal and needs business confirmation.

### D58 — Analytics minimum metric set (proposal): impressions/views, reach, engagements (likes + comments + shares + saves), engagement rate (engagements ÷ reach), followers, link clicks where available; "n/a" when a platform doesn't provide one
- **Why:** These are available across Instagram, LinkedIn and YouTube and computed one consistent way.
- **Old wasn't enough:** App Q10 / Portal Q13 said metrics are undefined.
- **Made up:** The list itself, which needs confirmation.

### D66 — Integrations v1 (proposal): Instagram + Facebook + LinkedIn (publish + insights); YouTube via manual publishing (D26) at first; meeting links pasted manually; Google Calendar/Meet, YouTube API, Drive, Slack and Figma later
- **Why:** Instagram and LinkedIn appear in nearly every spec example. YouTube still works on day one through manual publishing, and the first release stays achievable.
- **Old wasn't enough:** P157 says "needs to be confirmed".
- **Made up:** The v1 platform list.

### D62 — Glossary: "Agency" = tenant, "Client" = one brand, "Client space" = the client's area in the app (instead of "workspace" for all three)
- **Why:** Developers, designers and the client all use the same word for the same thing.
- **Old wasn't enough:** "Workspace" means three different things in P01, P17 and F63.

### D70 — Concurrency rules: atomic conditional state updates (409 on conflict), `rev` numbers on editable docs, idempotency keys on create actions and jobs
- **Why:** Double taps, two approvers at once and retried jobs can never corrupt data or create duplicates.
- **Made up:** The spec doesn't cover concurrency at all. The current server reads rows before awaiting the request body, which allows stale status checks.
