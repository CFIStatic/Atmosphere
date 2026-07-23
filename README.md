# Commandx

Email + password authentication for **Commandx** — a React login/signup UI backed by an
Express BFF (Backend-for-Frontend) that mediates **Supabase Auth**.

```
┌────────────────────┐      /api/*        ┌────────────────────┐     Supabase JS      ┌──────────────────┐
│  Frontend (React)  │ ─────────────────▶ │  Backend (Express) │ ───────────────────▶ │  Supabase Auth   │
│  Vite + Tailwind   │  httpOnly cookies  │  BFF / auth proxy  │   anon key + JWT     │  auth.users      │
└────────────────────┘ ◀───────────────── └────────────────────┘ ◀─────────────────── └──────────────────┘
```

## Why this shape?

- **Passwords are never stored by us.** Supabase Auth stores only a bcrypt hash in the
  secure `auth.users` table. The app never sees or persists a plaintext password.
- **Tokens never touch browser JavaScript.** The backend exchanges credentials for a
  Supabase session and puts the access/refresh tokens in **httpOnly** cookies, which
  mitigates token theft via XSS. The frontend holds no tokens.
- **The Supabase service-role key stays server-side** (and is optional here). The browser
  only ever deals with the backend.

## Project layout

```
Commandx/
├── backend/          Express + TypeScript BFF
│   ├── src/
│   │   ├── config.ts             Validated config (Supabase URL, keys, cookies, CORS)
│   │   ├── app.ts                Express app assembly (helmet, cors, cookies, routes)
│   │   ├── index.ts              Server bootstrap + graceful shutdown
│   │   ├── lib/
│   │   │   ├── supabase.ts       Stateless Supabase client factories
│   │   │   ├── session.ts        httpOnly session-cookie set/clear
│   │   │   ├── validation.ts     zod credential schema
│   │   │   └── errors.ts         Typed HTTP errors
│   │   ├── middleware/
│   │   │   ├── requireAuth.ts    Verify access token; transparent refresh
│   │   │   └── errorHandler.ts   404 + central JSON error handler
│   │   └── routes/
│   │       ├── auth.ts           signup / login / logout / refresh / me
│   │       └── health.ts         liveness probe
│   └── .env.example
└── frontend/         React + Vite + TypeScript + Tailwind
    ├── src/
    │   ├── pages/LoginPage.tsx       Branded login + signup screen
    │   ├── pages/DashboardPage.tsx   Protected landing page
    │   ├── context/AuthContext.tsx   Session state + login/signup/logout
    │   ├── components/               Logo, icons, ProtectedRoute
    │   └── lib/api.ts                Typed fetch client (credentials: include)
    └── .env.example
```

## Prerequisites

- Node.js **18+** (built and tested on Node 22)
- A Supabase project. This repo ships with the public **Commandx** project URL + anon key
  as defaults, so it runs out of the box. Override via env vars for your own project.

## Running locally

Open two terminals.

**1. Backend** (port 4000):

```bash
cd backend
npm install
cp .env.example .env    # optional — safe defaults are baked in
npm run dev
```

**2. Frontend** (port 5173):

```bash
cd frontend
npm install
npm run dev
```

Then open **http://localhost:5173**. The Vite dev server proxies `/api/*` to the backend,
so the browser talks to a single origin and the session cookies work seamlessly.

## API

| Method | Path                | Auth   | Body                  | Description                               |
| ------ | ------------------- | ------ | --------------------- | ----------------------------------------- |
| GET    | `/api/health`       | —      | —                     | Liveness probe                            |
| POST   | `/api/auth/signup`  | —      | `{ email, password }` | Create account; sets cookies if confirmed |
| POST   | `/api/auth/login`   | —      | `{ email, password }` | Authenticate; sets session cookies        |
| POST   | `/api/auth/logout`  | —      | —                     | Revoke session + clear cookies            |
| POST   | `/api/auth/refresh` | cookie | —                     | Exchange refresh token for a new session  |
| GET    | `/api/auth/me`      | cookie | —                     | Current user (auto-refreshes if expired)  |

All auth endpoints validate input with zod. `signup` and `login` are rate-limited
(20 attempts / 15 min / IP). Login failures return a generic message so the API does not
reveal whether an email is registered.

### Email confirmation

If the Supabase project requires email confirmation, `signup` returns
`{ needsEmailConfirmation: true }` and no session — the UI asks the user to confirm via
email, then sign in. If the project auto-confirms, `signup` logs the user straight in.

## Configuration

See `backend/.env.example` and `frontend/.env.example`. Key points:

- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — public, safe to expose. Baked-in defaults target
  the Commandx project.
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only secret**, optional (not needed for login).
  Never commit it or expose it to the browser.
- `FRONTEND_ORIGIN` — comma-separated allowed CORS origins.
- `COOKIE_SAMESITE` — set to `none` (with HTTPS on both sides) if the frontend and backend
  are on different sites in production.

## Production notes

- Serve both over **HTTPS**; cookies are automatically marked `Secure` when
  `NODE_ENV=production`.
- Prefer serving the frontend and backend under the **same origin** (reverse-proxy the API
  at `/api`) so cookies stay `SameSite=Lax`. If you must split origins, set
  `COOKIE_SAMESITE=none` and configure `FRONTEND_ORIGIN`.
- Build: `npm run build` in each package (`backend` → `dist/`, `frontend` → `dist/`).

## Security note about the shared Supabase project

The existing Commandx Supabase project has **Row Level Security (RLS) disabled on many
`public` tables**. That is a pre-existing database configuration concern independent of this
login app (which relies on Supabase Auth, not those tables). Review and enable RLS with
appropriate policies before exposing that data through any client using the anon key.
