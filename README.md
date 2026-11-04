# Unfoldd

Collaboration platform between creative agencies and their clients (formerly "Matcha").
MERN stack: **MongoDB · Express · React · Node**, TypeScript throughout, Tailwind CSS on the frontend.

Product and system design live in [docs/](docs/) (`MATCHA_SYSTEM.md`, `DECISIONS.md`). How the backend works, file by file, with every endpoint: [docs/BACKEND.md](docs/BACKEND.md).

## Structure

```
unfoldd/
├── package.json          npm workspaces root — runs both apps together
├── docs/                 system design + decision log
├── frontend/             React 19 + Vite + Tailwind CSS v4 + React Router
│   └── src/
│       ├── app/          App root and router
│       ├── layouts/      page shells (sidebar / topbar)
│       ├── pages/        one file per route
│       ├── features/     feature folders (clients, content, tasks …): components + hooks + api calls
│       ├── components/ui shared primitives (Button, Dialog, Field, Menu …)
│       ├── components/list list building blocks: toolbar, filters, table, pagination
│       ├── hooks/        shared hooks
│       ├── lib/          api client and helpers
│       ├── styles/       index.css — Tailwind import + design tokens (@theme)
│       └── types/        shared TS types
└── backend/              Express 5 + Mongoose + Zod
    └── src/
        ├── server.ts     entry: connect MongoDB, start HTTP server
        ├── app.ts        Express app + middleware
        ├── routes.ts     mounts every module under /api
        ├── config/       env (validated with Zod), db connection
        ├── middleware/   auth (platform admin / agency user), rate limiting, errors
        ├── lib/          sessions, password hashing, pagination, activity logging
        ├── modules/      one folder per feature: <name>.model.ts, <name>.routes.ts, <name>.service.ts
        ├── scripts/      seed (super admin) and seed:demo
        ├── utils/        AppError etc.
        └── types/        shared TS types
```

## Getting started

Requires **Node 24+** and MongoDB (local service or Atlas).

```bash
npm install                                    # installs both workspaces
cp backend/.env.example backend/.env           # then edit MONGODB_URI if needed
npm run seed -w backend                        # creates the platform (super) admin from SEED_SUPERADMIN_*
npm run dev                                    # API on :8787, web on :5173
```

| URL | Who |
|---|---|
| http://localhost:5173/admin | Platform (super) admin: username + password from `backend/.env` |
| http://localhost:5173/login, `/signup` | Agency people (tenants) and client people |
| http://localhost:5173/app | Agency portal |
| http://localhost:5173/c | Client app (mobile-first) |

`npm run seed:demo -w backend` adds 64 demo agencies (emails `@demo.unfoldd.test`, password `demo-password`)
so lists and filters have data; `npm run seed:demo -w backend -- --clear` removes them again.
`npm run seed -w backend -- --reset-password` resets the super admin's password to the one in `.env`.

Vite proxies `/api` to the backend, so the frontend always calls same-origin `/api/...`
(session cookies work without CORS setup).

| Command (root) | What it does |
|---|---|
| `npm run dev` | backend (`node --watch`) + frontend (Vite) together |
| `npm run build` | type-check and build both into `dist/` |
| `npm run typecheck` | type-check both |
| `npm run lint` | oxlint both |
| `npm run test:e2e` | end-to-end tests (Playwright) on a throwaway in-memory database; ports 8790/5175 |
| `npm test` | backend tests, then the end-to-end tests |

Run one side only with `npm run dev -w backend` or `npm run dev -w frontend`.

## Conventions

- **API errors** are always `{ error: { code, message, details? } }` — `frontend/src/lib/api.ts` parses this into `ApiError`.
  Throw `AppError` in the backend; Express 5 forwards async errors to the error handler automatically.
- **Backend runs TypeScript directly** in dev (Node type stripping): import local files with the `.ts`
  extension and use only erasable syntax (no `enum`, no parameter properties). `npm run build` rewrites to `.js`.
- **Frontend imports** use the `@/` alias for `src/`.
- **Styling**: Tailwind utilities generated from the tokens in `styles/index.css`
  (`bg-brand`, `text-text-2`, `border-border`, `font-serif`, `bg-sidebar-bg` …). Add new colours there, not inline.
- **Lists** keep search, filters, sort and page in the URL (`useListState`) and send that query string to the API,
  which validates it with Zod and answers `{ items, page, pageSize, total, totalPages }` (`lib/pagination.ts`).
- **Activity log** is append-only: call `logActivity(req, …)` for anything a platform admin or agency does.

## Platform admin

- **Agencies** sign up as `pending` and can't log in until approved, unless *Settings → Auto-approve* is on.
  Status changes (approve / reject / suspend / reactivate) are atomic; suspending signs the agency out everywhere.
- **Open admin portal** starts a time-limited *support session* in the agency's portal as its owner (separate
  `uf_session` cookie; the admin's own `uf_admin` session is untouched). It shows a banner and every action is logged
  with the admin as impersonator.
- **Subscriptions** are placeholder records (plan, status, seats, renewal date, notes); nothing is billed or enforced yet.
