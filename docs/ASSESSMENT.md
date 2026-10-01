# Atmosphere — Engineering Assessment

**Date:** 2026-09-05
**Scope:** Read-only review of `CFIStatic/Atmosphere` at `main` (`8292cc93` and parents).
**Method:** Source, migrations, CI/deploy workflows, and existing docs. No product behavior was changed. This document is not a counsel review, penetration test, or load test.

`docs/AUDIT.md` is **not** a security audit. It documents the agent-run ledger (`agent_runs` / `agent_run_steps`). This file is the repo-wide product and engineering assessment.

---

## 1. Executive summary

Atmosphere is a **Work Verification** product for restoration and construction contractors. Office staff paste a scope, invite a crew, the crew films the day, and the office (plus adjusters / banks / counsel) reviews clips against that scope with a custody trail.

**Who it serves today**

| Audience | What they use |
| --- | --- |
| Global Admin (GC / contractor) | Pays (~$599/mo Work Verification). Creates the company, invites employees, billing. |
| Employees | Same workspace: start jobs, review clips, share evidence. No billing. |
| Invited workers / subs | Job-share link or Field Capture sign-in. Film + upload. No org seat. |
| Adjusters / examiners / counsel | Account-pinned Verifier shares (and tokenized guest progress / report pages). |
| Atmosphere staff | Internal site (`internal/`) — accounts, usage, legal hold, experiments. |

**Overall health: B−**

The **sold path** (intake → invite → Field Capture → Verifier → evidence share) is unusually well thought through for a young product: httpOnly sessions, org id never taken from the request body, RLS for office users, token-via-BFF for guests, production boot guards, a serious Railway runbook, legal-hold/vault design, and a large unit-test corpus.

The **repo as a whole** is weaker than that path. The UI was narrowed to Verification + Field. The Express process, database history, frontend client, and docs still contain a full unfinished platform (sales, PM, estimator, computer-use, CRM campaigns, finance, cyber, email marketing). That leftover surface is the single largest engineering and security problem.

| Dimension | Grade | One-line verdict |
| --- | --- | --- |
| Product clarity | A− | README and office routing agree on what is sold. |
| Architecture intent | B+ | BFF + Supabase + token guests is the right shape. |
| Implementation discipline | B | Strict TS, good comments, `any` erosion on core paths. |
| Tests | B− | Many unit tests; thin HTTP/integration coverage of the sold path. |
| Security hygiene | B− | Good patterns; service-role blast radius + leftover APIs. |
| Ops / deploy | B | Excellent runbook; Railway footguns, in-process workers, no error sink. |
| Codebase focus | D | UI trimmed; API and dead trees were not. |

**Verdict:** Safe to keep shipping the verification loop if production stays tightly operated. Not yet a hardened single-product system. Treat leftover APIs, service-role handlers, and in-process queues as the next engineering work — not more product surface.

---

## 2. What the product is

One path. The README is accurate and should be treated as the source of truth for scope:

1. Office pastes claim/scope → reviews drafted lines → approves once (`/intake`).
2. Brief is published (facts + in-scope / do-not lines).
3. Office invites Field Capture team and/or subcontractors. Atmosphere sends the mail.
4. Crew opens the link (or signs in), accepts the brief, films video + microphone.
5. Office Verifier watches clips; AI dictation is judged against scope; unknown ≠ pass.
6. Custody log; evidence shares open for a pinned Atmosphere account.

**Field Capture does not run the AI report on the phone.** Capture is record + upload. Judgment lives in the Verifier.

The product is **explicitly not** a sales suite, PM board, or operations OS. Those modules remain in the tree “for a later return” (`README.md`). That decision is documented. It has not been enforced at the API boundary.

---

## 3. Architecture overview

```
  Office SPA (frontend/)          Field Capture (static / iOS)
  Vite + React + Tailwind         fieldcapture/ + apps/field-ios/
  /intake · /jobs · /verifier     token or org login → film + upload
           │                                  │
           │  /api/*  httpOnly cookies        │  /api/job-share · /api/field*
           ▼                                  ▼
                 Express BFF (backend/)
                 Session · org RLS client
                 Token guests via service role
                 In-process RetryQueue + schedulers
                           │
                           ▼
                 Supabase Auth + Postgres + Storage
                 (job-proofs bucket, RLS, service role)
```

### 3.1 Surfaces

| Surface | Stack | Host | Role |
| --- | --- | --- | --- |
| `frontend/` | React 18, Vite, Tailwind, React Router 6 | Railway `Atmosphere-web` → `platform.atmosphereteam.com` | Office console |
| `verifier/` | One ~6,374-line static HTML app | Bundled into office image; iframe in `OperationsShell` | Evidence portal |
| `fieldcapture/` | Static HTML/JS | Office `/fieldcapture/` **and** Railway `Field Capture` → `app.atmosphereteam.com` | Crew capture |
| `apps/field-ios/` | Swift, iOS 16+ | App Store path; talks to production BFF | Native capture + RoomPlan later |
| `backend/` | Express 4, Node 22, Zod | Railway `Atmosphere APIs` | BFF + verification + leftover platform |
| `website/` | Static HTML, nginx | Railway Corporate Website; `atmosphereteam.com` still Squarespace parking | Marketing |
| `internal/` | React/Vite | Railway `Internal Growth Metrics` | Staff analytics / legal |
| `agent/` | Node CLI + WebSocket | Operator machine | Computer-use (off in prod deploy) |

There is **no monorepo tool** (no Turborepo/pnpm workspace). Each package has its own `package-lock.json`. That is fine at this size; it does mean five independent Node graphs.

### 3.2 Backend composition

`backend/src/index.ts` boots production guards, `createApp()`, then starts:

- PM scheduler (opt-in)
- Proof analysis sweep (on)
- Mitigation capture agent (on by default)
- Backup scheduler (config)
- Cyber scheduler (on)
- Optional computer-use WebSocket hub

`backend/src/app.ts` mounts **57 route modules**. The sold-path mounts are a minority:

| Prefix | Purpose | Auth |
| --- | --- | --- |
| `/api/auth`, `/api/org` | Signup, session, onboarding | Public / session |
| `/api/operations/*` | Intake, shared jobs, scope docs | Session + org |
| `/api/job-share` | Subcontractor job record + proof upload | **Token only** |
| `/api/field`, `/api/field-app` | Claim / My jobs / native app | Field session or org |
| `/api/evidence-portal`, `/api/verifier-share` | Library + shares | Session; share token + login |
| `/api/progress-share` | Guest job progress | **Token only** |
| `/api/verification` | Async video pipeline | Session + org |
| `/api/billing`, `/api/webhooks/stripe` | Checkout + settlement | Session / HMAC |
| `/api/legal` | Holds, vault, monitor | Staff gate |

Still mounted and reachable if a client calls them:

`/api/sales`, `/api/pm`, `/api/crm`, `/api/crm-sync`, `/api/estimator`, `/api/mitigation`, `/api/xactimate`, `/api/symbility`, `/api/computer`, `/api/prospecting`, `/api/email-marketing`, `/api/finance`, `/api/purchasing`, `/api/cyber`, `/api/web-access`, `/api/integrations`, `/api/portal`, `/api/ai`, `/api/model`, …

The office UI does not navigate to those products. The process still serves them.

### 3.3 Data flow (sold path)

1. Office user signs in via BFF → Supabase Auth. Tokens land in httpOnly cookies (`atm_access_token`, `atm_refresh_token`) — `backend/src/lib/session.ts`.
2. `requireOrg` / `requireOrgContext` resolve org from `org_members` under the caller JWT. **Org id is never taken from the body.**
3. Intake propose/approve writes `crm_jobs`, `job_briefs`, `job_scope_items`, `job_parties` (each party gets `access_token`).
4. Invite email is sent by Atmosphere (`systemMail` + Resend/SMTP), not the customer mailbox.
5. Crew hits `/api/job-share/:token`. BFF looks up the party with the **service role**, scoped to that token (`sharedJobs.ts` `partyForToken`).
6. Upload: signed Storage PUT → `POST …/proof` files the day. Analysis is **enqueued**, not run in the request (`RetryQueue` in `backend/src/shared/retryQueue.ts`).
7. Office Verifier reads via `/api/evidence-portal/*` with the user JWT (RLS). External reviewers need a signed-in account **and** a share token (`evidencePortal.ts`).
8. Guest progress (`/progress/:token`) and HomeOwner Report (`/report/:token`) are token-only by design.

### 3.4 Auth and tenancy

| Mechanism | Where | Notes |
| --- | --- | --- |
| Email/password + httpOnly cookies | `routes/auth.ts`, `lib/session.ts` | XSS-resistant for the office SPA. |
| Bearer header | `middleware/requireAuth.ts` | Native iOS + Field iframe when cookies fail. |
| Device PIN | `atm_device` cookie + `DEVICE_PEPPER` | Cookie **not** cleared on logout (intentional). |
| Org membership | `requireOrg.ts` | **First** `org_members` row by `created_at`. No org switcher. |
| Job-share token | URL path `/shared/:token`, `/api/job-share/:token` | Capability URL. Service role lookup. |
| Field identity | OTP → `field_sessions` | Cross-GC; deny-all RLS; BFF only. |
| Evidence share | Token **plus** login | Correct for “pinned account”. |
| Internal staff | TOTP via Microsoft Authenticator | `DEVICE_PEPPER` encrypts secrets. Default allowlist includes `jack@jettx.ai`. |
| Stripe webhook | Raw body + `STRIPE_WEBHOOK_SECRET` | Settlement is webhook-only (`docs/stripe.md`). |

**RLS pattern is consistent and good for office users:** `private.is_org_member(org_id)` on job/proof/share tables; `anon` revoked. Token guests never hit PostgREST. Field-identity and legal tables are deny-all for `authenticated`; only the service role can touch them.

**The tradeoff:** every guest, webhook, scheduler, and staff-bootstrap path uses `createAdminClient()` (~55 files). RLS is not a backstop on those handlers. A scoping bug is a cross-tenant bug.

### 3.5 Deploy and infra

```
GitHub main
  → CI (.github/workflows/ci.yml): typecheck, tests, migration SQL suites,
    Docker image boots (including bad API_UPSTREAM=http://:)
  → deploy-production.yml (Keys env): sync secrets → Railway,
    ad-hoc Supabase repair scripts, railway up backend + office + internal
  → deploy-website.yml: marketing nginx
```

| Service | Config | Health |
| --- | --- | --- |
| Atmosphere APIs | `backend/railway.toml`, root `Dockerfile` | `GET /api/health` |
| Atmosphere-web | `frontend/railway.toml` | `GET /healthz` |
| Corporate Website | `website/railway.toml` | `GET /health` |
| Internal Growth Metrics | `internal/railway.json` | `GET /healthz` |
| Field Capture | `fieldcapture/railway.toml` | `GET /healthz` |

Root `railway.toml` is intentionally inert (unmatchable watch path) after a real outage: inheriting services built the **BFF image** onto the marketing site. That incident is documented at length in `docs/production.md`. The mitigations (inert root config, nginx `.envsh` fallbacks, CI boot with `API_UPSTREAM=http://:`) are the best ops writing in the repo.

**Data plane:** one production Supabase project (Auth + Postgres + Storage). Migrations exist in **two identical 122-file trees** (`backend/supabase/migrations/` and `supabase/migrations/`). CI enforces a byte-identical mirror. Apply one tree, once.

**Not in production (or not finished):** durable workers, real S3 driver, Sentry/OTel, counsel-reviewed legal copy, `atmosphereteam.com` DNS on Railway.

---

## 4. Code quality

### 4.1 Structure

The sold-path layout is readable: `routes/jobIntake.ts`, `sharedJobs.ts`, `proofOfWork.ts`, `fieldIdentity.ts`, `evidencePortal.ts`, `verification/`, `verifier/`, `media/`, `legal/`.

The problem is volume and leftovers.

| File | Lines | Issue |
| --- | --- | --- |
| `frontend/src/lib/api.ts` | 7,733 | God client: still exports Sales/PM/campaign methods. |
| `verifier/index.html` | 6,374 | Entire evidence UI in one file. Zero automated tests. |
| `frontend/src/demo/mock.ts` | 4,501 | Full later-product mock (gated by `VITE_DEMO`). |
| `frontend/src/features/` + `shell/` + `assistant/` | ~4,254 | Unrouted later-product UI. |
| `frontend/src/data/fixtures.ts` | 2,310 | CRM/PM/finance seed data. |
| `backend/src/routes/proofOfWork.ts` | 2,354 | Core path; heavy `any`. |
| `backend/src/routes/evidencePortal.ts` | 1,540 | Same. |
| `backend/src/routes/sharedJobs.ts` | 1,379 | Token guest surface. |

`frontend/src/lib/platforms.ts` is clean: only `operations` and `field`. `App.tsx` routes match the README, plus `/technician`, `/report/:token`, `/progress/:token` (undocumented in the README table).

### 4.2 TypeScript discipline

Backend `tsconfig.json`: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`. Good.

Tests are **excluded** from compilation (`exclude: src/**/*.test.ts`). CI still runs them via `tsx`.

`any` in `backend/src`: **~1,210** occurrences. Files with `eslint-disable @typescript-eslint/no-explicit-any`: **~105**, including the highest-value proof/verification/share routes.

Frontend has a real Vitest suite and `tsc -b` on build. The office console is in better shape than the backend core files on this axis.

Field Capture and Verifier are **plain JS / inline HTML**. No types, no bundler, no CI unit tests for Verifier.

### 4.3 Testing

| Package | Automated tests | CI? |
| --- | --- | --- |
| `backend/` | **136** `*.test.ts` (node:test + some Vitest) | Yes — typecheck, test, build |
| `frontend/` | **88** Vitest files | Yes — test + build (`tsc -b`) |
| `internal/` | **11** Vitest files | Yes |
| `agent/` | 0 | Typecheck only |
| `fieldcapture/` | 1 Node script + 1 HTML harness | Image smoke only |
| `verifier/` | 0 | Indirect text asserts from frontend tests |
| `apps/field-ios/` | 0 XCTest | No |
| `website/` | 0 | Image smoke only |

**What is good:** verification pipeline units, proof analysis, Stripe webhook logic, org onboarding/invites, CORS origins, production guards, job-file helpers, migration SQL suites on throwaway Postgres (including “try to delete history”), Docker boots that catch the `http://:` nginx crash.

**What is missing:**

- No systematic HTTP/integration suite (`createApp()` + supertest) for login, intake approve, job-share upload, evidence share.
- ~46 of 57 route files have no HTTP tests.
- No E2E in CI (Playwright is a frontend **dev** dependency; `test:e2e:approve` is a script, not a workflow job).
- `npm run lint` exists (`verify` script) and is **not run in CI**. `docs/production.md` admits lint is “still noisy.”
- No `npm audit` / SCA job.
- Computer-use WebSocket hub: untested.
- Verifier portal: untested as a program.

### 4.4 Error handling

Central `HttpError` + `errorHandler` (`backend/src/lib/errors.ts`, `middleware/errorHandler.ts`): Zod → 400, typed codes, **no stack/detail in production**. Rate limits are **per-router**, not global — auth 20/15min in prod; public forms 5/hr; share routes 60–120/min. Many authenticated routes have no limiter.

Helmet is default `helmet()` only — no custom CSP on the API. Office nginx CSP is `frame-ancestors` only (needed so Field Capture can iframe Platform).

### 4.5 Security hygiene

**Done well**

- Passwords in Supabase Auth; no plaintext in the app.
- httpOnly session cookies; `Secure` in production.
- CORS allowlist with 403 (not silent drop). Hardcoded live hosts in `previewOrigins.ts` so a stale `FRONTEND_ORIGIN` cannot take down login — a pragmatic production fix.
- Stripe signs raw bytes; catalog GET is the only public billing read.
- Production boot refuses missing service role, `MEDIA_BACKEND=memory`, personal Gmail/Yahoo inboxes for public forms, and `PAYMENT_PROVIDER=dev`.
- Audit ledger redacts key-named secrets (`docs/AUDIT.md`) — by key name, not by value.
- Legal hold: soft-delete, vault copy, customer cannot hard-delete proofs.
- No `eval` / `new Function` in backend TS.
- `.env.example` documents secrets; no live `sk_live` / service-role keys found in source.

**Gaps**

- Service role required in production and used widely. Correctness is handler-scoped, not policy-scoped.
- Capability secrets in URLs: job-share, Field Capture `?token=`, progress share, unsubscribe `?t=`, verifier `?share=`. Logs, Referer, and analytics can leak them.
- `VerifierFrame` and theme sync use `postMessage(..., '*')` (`frontend/src/components/VerifierFrame.tsx`). Session payload includes email, name, role, avatar.
- Field embed stores access/refresh tokens in JS (`fieldEmbed.ts`) to survive iframe cookie blocking.
- `DEVICE_PEPPER` has a well-named **dev** default (`atmosphere-dev-pepper-do-not-use-in-production`). Production requires the env var. Preview hosts that forget `NODE_ENV=production` inherit the default.
- Dev config defaults to a shared Supabase project URL/anon key (`config.ts`). Fine for local; dangerous if a public host boots without env.
- `ALLOW_MOCK_DRIVERS=true` is **synced onto Railway by production deploy** (`.github/workflows/deploy-production.yml`). Guards then only warn.
- Default operational identity `jack@jettx.ai` is hardcoded for contact, careers, analytics allowlist, and Reply-To.
- Cyber monitor is **on by default** and runs before routers. A false positive blocks auth/billing.
- No Content-Security-Policy on Field Capture / Verifier / marketing nginx beyond generic headers.
- Privacy and terms on the marketing site are **plain-language drafts pending counsel** (`website/privacy.html`, `website/terms.html`).

### 4.6 Dependency health

| Concern | Detail |
| --- | --- |
| Dependabot | Monthly, grouped patch/minor, **all semver-major ignored**, max 2 PRs. Majors rot. |
| `playwright` | **Production** dependency of the backend (sales crawl, Xactimate, web access). Ships in the BFF image; Chromium is not installed in the Dockerfile. Dead weight and supply-chain surface. |
| TensorFlow + coco-ssd | Frontend **production** deps, used by `/technician` object detection — not in the main rail. |
| Express 4 | Current; not Express 5. Fine, but majors are ignored. |
| No SCA in CI | Dependabot is the only automated dependency signal. |
| `internal/` and `website/` | Not in Dependabot. |
| Agent | Typecheck only; `sharp` + `ws`. |

---

## 5. Strengths

1. **Product focus in the UI is real.** `platforms.ts` and `App.tsx` do not ship Sales/PM screens. Marketing legacy pages redirect home.
2. **Tenancy design is deliberate.** Org from membership, not body. Token guests isolated from PostgREST. Field identity is cross-org by design with deny-all RLS.
3. **Production scars are written down.** `docs/production.md` is one of the best files in the repo: Railway Config File inheritance, `API_UPSTREAM=http://:`, dual deploy, Wait-for-CI. CI now boots images on the exact failure that took down login.
4. **Fail-loud boot** (`productionGuards.ts`) for the secrets the verification path actually needs.
5. **Billing model is correct.** Checkout opens a session; **webhooks mint money**. Documented in `docs/stripe.md`.
6. **Legal-hold / vault / user-activity monitor** exist and are staff-gated. Unusual for this stage.
7. **Migration inventory + SQL behavior tests** on a disposable Postgres, including append-only / isolation promises.
8. **Comments explain why.** Rate-limit placement, parser limits, cookie non-clear on PIN, RetryQueue non-persistence — the code talks to the next reader.
9. **Invite mail is platform-sent** with a documented deliverability path (`docs/email-deliverability.md`). Copy-link fallback if SMTP/Resend is missing.

---

## 6. Weaknesses, risks, and gaps

Ranked by how badly they can hurt customers or the company, not by how embarrassing they look.

### P0 — leftover platform still live

The console was narrowed. The BFF was not. Anyone who can authenticate (or who finds an unauthenticated token route in a leftover module) still has a large API. Estimator, computer-use, CRM sync, prospecting, and email-marketing increase the blast radius of a stolen session or a service-role bug.

`20260828220000_drop_old_product_tables.sql` drops leftover **tables**. It does not unmount leftover **routes**.

### P0 — service-role concentration

Guest access, signed uploads, webhooks, staff TOTP, analytics grant, proof sweep, and several schedulers all bypass RLS. This is a valid BFF pattern. It is also a single class of bug (forgot `.eq('org_id' | 'job_id' | 'access_token')`) away from cross-tenant reads/writes.

### P1 — in-process workers

`RetryQueue` is explicitly not durable. Restart loses queued analysis; DB rows stay `queued` until a sweep or a human re-kick. Production docs already list this as uncovered. Multiple API replicas will overlap PM/backup/capture sweeps (comments acknowledge this). The verification product **depends** on this queue.

### P1 — tokens in URLs

Job-share and Field Capture tokens are the credential. They will appear in proxy logs, browser history, Referer on third-party assets, and support screenshots. There is no one-time exchange into a cookie for the common `?token=` path.

### P1 — onboarding schema is a no-op in git

`20260725171936_commandx_onboarding_schema.sql` contains **no DDL**. It exists so history matches production project `ccxatzfsvzetciiwsjlj`. A fresh Supabase from repo migrations can be missing `orgs` / `profiles` / `org_members`. That is a landmine for preview environments and disaster recovery.

### P1 — Railway config-as-code cutoff (2026-12-01)

Documented in `docs/production.md`. New services already cannot opt in. Existing services keep reading `railway.toml` until the hard cutoff. After that, dashboard drift or a missed IaC migration repeats the “wrong image on the website” outage.

### P2 — HTTP test gap on the sold path

Unit tests will not catch a middleware-order regression, a CORS miss, or a token route that stops scoping. The repo has already been burned by nginx/upstream mistakes; those are now tested. Auth + intake + share + proof are not, at the HTTP layer.

### P2 — TypeScript `any` on proof / evidence / share

Compile-time tenancy checks are weakest where a mistake is most expensive.

### P2 — no error sink

`docs/production.md`: “Product telemetry (`/api/telemetry`) is not a substitute for error tracking — wire Sentry/OTel when you have a sink.” That sink does not exist. Production failures are stdout JSON only.

### P2 — ops identity and mock drivers in prod sync

`ALLOW_MOCK_DRIVERS=true` on every Keys sync. Contact/careers/analytics default to a personal mailbox. Fine for a two-person company; it will not survive a real security questionnaire.

### P2 — legal copy is draft; custom domain is not live

`atmosphereteam.com` is still Squarespace “Coming Soon.” Privacy/terms say they are pending counsel. The product handles job-site video of houses. That combination is a go-to-market and compliance risk, not just a docs nits.

### P3 — doc drift

These docs describe products the README says are not sold: `docs/sales-agent.md`, `financial-agent.md`, `project-manager-agent.md`, `pm-orchestration.md`, `pm-network-comms.md`, `email-marketing.md`, `reinforcement-learning.md`, `cyber-defense.md`, plus large CRM docs. They read as current. New contributors will build the wrong thing.

### P3 — frontend dead weight

Unrouted `features/`, 7.7k-line `api.ts`, TensorFlow for `/technician`, 4.5k-line demo mock. Bundle and review cost.

### P3 — process / git hygiene

Hundreds of `cursor/*` and `claude/*` branches. `main` is a high-frequency merge train. CI concurrency cancels in-progress runs (good). There is no CODEOWNERS, no PR template, and lint is not a merge gate. Velocity is a feature; regression risk is the cost.

### P3 — single-org middleware

A user in two orgs silently operates as the earliest membership (`requireOrg.ts`). Fine today. Broken the moment the UI grows an org switcher without a matching backend change.

### Known gaps the repo already admits

From `docs/production.md` “What this runbook deliberately does not cover yet”:

- Merge the two migration trees.
- Durable workers for proof/verification queues.
- Real S3 multipart driver.
- Counsel-reviewed privacy/terms.

Agree with all four. Add: unmount leftover APIs; restore onboarding DDL; error tracking.

---

## 7. Prioritized recommendations

Impact vs effort for a small team. Do these in order unless a customer incident jumps the queue.

| # | Action | Impact | Effort | Why |
| --- | --- | --- | --- | --- |
| 1 | **Gate leftover APIs in production.** Unmount or 404 `/api/sales`, `/api/pm`, `/api/estimator`, `/api/computer`, `/api/prospecting`, `/api/email-marketing`, `/api/finance`, `/api/purchasing`, `/api/web-access` unless an explicit `ENABLE_*` flag is set. Keep CRM **read** if job files still sync titles/addresses. | High | Medium | Largest attack-surface cut without changing the sold UI. Code can stay in the tree. |
| 2 | **HTTP integration tests for the sold path.** One `createApp()` suite: signup/login cookies, org create, intake propose/approve, job-share GET + upload-url authz, evidence-portal library, share create + guest 401 without login, Stripe webhook signature reject. | High | Medium | Prevents the next silent tenancy or cookie regression. You already have the unit pieces. |
| 3 | **Stop shipping mock drivers to production.** Remove `ALLOW_MOCK_DRIVERS: 'true'` from `deploy-production.yml`. Fail boot if a sold-path driver is mock **and** that surface is enabled. | Medium | Low | One-line ops win; stops “it worked in prod with a log driver.” |
| 4 | **Restore onboarding DDL (or a documented dump) into git.** Replace the no-op `20260725171936_commandx_onboarding_schema.sql` with the live statements, or add a `schema/baseline.sql` used by preview. | High | Low–Medium | Fresh/preview/DR environments are incomplete today. |
| 5 | **Token exchange for Field Capture / job-share.** `?token=` → one-time POST → httpOnly field/job cookie; subsequent APIs use the cookie. Keep path tokens only as invite secrets. | High | Medium | Stops the most likely credential leak (Referer, history, screenshots). |
| 6 | **Scoped admin helper.** Ban ad-hoc `createAdminClient().from(...)` in new code. Require `adminForJob({ orgId, jobId })` / `adminForPartyToken(token)` helpers that apply the filters. Backfill `sharedJobs.ts`, `fieldIdentity.ts`, `progressShare.ts`, `proofOfWork.ts`. | High | Medium | Makes the service-role tradeoff reviewable. |
| 7 | **Durable verification/proof worker.** Move `RetryQueue` drain off the web process (second Railway service, `FOR UPDATE SKIP LOCKED` poller). Keep the sweep as a safety net. | High | High | Restarts and multi-instance will otherwise drop or double work. Already listed as uncovered. |
| 8 | **Railway IaC / dashboard mirror before 2026-12-01.** Copy start command, health path, Dockerfile, watch paths into dashboard or `.railway/railway.ts`. Keep the inert root file. | High | Medium | Avoids repeating the Corporate Website / BFF image outage. |
| 9 | **Sentry (or equivalent) on BFF + office.** Honor `x-request-id`. Alert on 5xx and unhandled rejections. | Medium | Low | Telemetry heartbeats are not this. |
| 10 | **Counsel pass on privacy/terms + video retention.** Then publish `atmosphereteam.com` onto Railway. | High (legal) | Low (eng) | Job-site video of dwellings with draft legal copy is the compliance gap. |

**Do soon, after the list above**

- Lock `postMessage` to the office origin; stop `'*'` for session payloads.
- Run `npm run lint` in CI once the noisiest rules are ratcheted (or lint only `backend/src/{routes,middleware,lib}` first).
- Add Dependabot for `internal/` and `website/`; schedule a quarterly **major** review instead of ignoring all majors forever.
- Move `playwright` to backend `devDependencies` (or a separate worker package). Drop TensorFlow from the office bundle until `/technician` is a product again.
- Quarantine `frontend/src/features/`, `shell/`, and unused `api.ts` methods behind a folder named `legacy/` or a second package so reviewers stop reading them as current.
- Stamp leftover docs with a one-line banner: “Not in the shipped product. See README.”
- Add a Verifier contract test (even HTML/string + a jsdom smoke of share-mode). Same for Field Capture upload happy path.
- Add CODEOWNERS on `backend/src/lib/supabase.ts`, `productionGuards.ts`, `app.ts`, migrations, and deploy workflows.

**Do not do now**

- A big rewrite to Next.js, a monorepo tool, or microservices.
- Deleting leftover modules from git (keep them, **unmount** them).
- Building Sales/PM/estimator until the sold path has HTTP tests, a durable worker, and a smaller API.

---

## 8. Architecture map (files)

```
Atmosphere/
├── README.md                          Product contract
├── docs/production.md                 Ops runbook (read this before deploying)
├── docs/stripe.md                     Billing
├── docs/ASSESSMENT.md                 This review
├── railway.toml                       Inert fallback — do not add a Dockerfile path
├── docker-compose.yml                 Local prod-shaped stack (:8080 app, :4000 API)
├── frontend/                          Office SPA
│   ├── src/App.tsx                    Actual routes
│   ├── src/lib/platforms.ts           Verification + Field only
│   ├── src/lib/api.ts                 Oversized client (includes dead products)
│   └── src/layouts/OperationsShell.tsx
├── verifier/index.html                Evidence UI (iframe)
├── fieldcapture/                      Crew web capture
├── apps/field-ios/                    Native capture
├── backend/
│   ├── src/app.ts                     Middleware + 57 routers
│   ├── src/index.ts                   Boot + schedulers
│   ├── src/lib/session.ts             httpOnly cookies
│   ├── src/lib/supabase.ts            anon / user JWT / service role
│   ├── src/lib/productionGuards.ts    Fail-loud prod
│   ├── src/middleware/requireAuth.ts
│   ├── src/middleware/requireOrg.ts   First membership wins
│   ├── src/routes/jobIntake.ts
│   ├── src/routes/sharedJobs.ts       Token guest
│   ├── src/routes/proofOfWork.ts
│   ├── src/routes/evidencePortal.ts
│   ├── src/shared/retryQueue.ts       In-memory worker
│   ├── src/verification/              Async pipeline
│   └── supabase/migrations/           122 files (mirror of /supabase/migrations)
├── website/                           Marketing
├── internal/                          Staff site
└── .github/workflows/ci.yml           Merge gate
```

---

## 9. Test / quality snapshot

| Check | Status as of this review |
| --- | --- |
| Backend `strict` TS | On |
| Backend tests in CI | On (136 files) |
| Frontend tests in CI | On (88 files) |
| Lint in CI | **Off** |
| Migration mirror CI | On |
| Migration behavior SQL | On (throwaway Postgres) |
| Docker image smoke | On (backend, office, website, internal, fieldcapture) |
| E2E / Playwright in CI | **Off** |
| npm audit / SCA | **Off** |
| Error tracking | **Off** |
| Durable job queue | **Off** (in-process) |
| Leftover APIs unmounted | **Off** |

Tests were inventoried from the tree, not re-run as part of this assessment.

---

## 10. Bottom line

Atmosphere already looks like a company that has been to production and gotten hurt: the Railway runbook, CORS hardcoded hosts, inert root config, and Docker `http://:` boots are evidence of that. The Work Verification story is coherent, and the auth/tenancy *design* is better than most startups at this stage.

The next risk is not “we lack features.” It is **shipping a narrow product on a wide, privileged process** with an in-memory queue and capability URLs. Close that gap before adding surface area back.

If only three things happen after this review: **unmount leftover APIs, add sold-path HTTP tests, restore onboarding schema to git.**
