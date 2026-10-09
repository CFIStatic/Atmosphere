# Computer: Chat's browser agent (Phase 1)

Computer lets a company member say, in a job's Chat, "fill out the claim form
on portal.example.com" and have an agent do it in a real cloud browser. It
works on any website. There are no per-site playbooks. It fills things in and
stops before anything final happens. A person approves each submit, send, pay,
delete, sign, accept-terms or upload click.

## Setup (operator)

1. Create a Browserbase account at https://www.browserbase.com and a project.
   The Developer plan is enough to start.
2. On the backend service that runs the workers (the process where
   `runSoldPathWorkers` starts), set:
   - `BROWSERBASE_API_KEY` (secret)
   - `BROWSERBASE_PROJECT_ID`
3. Apply the two migrations:
   - `20261004150000_token_usage_feature_computer.sql`
   - `20261004150100_computer_tasks.sql`
4. `ANTHROPIC_API_KEY` is already used by Chat. Computer uses the same key.

Until both Browserbase values are set, the worker does not start (logs
`computer_not_set_up`). Chat answers with a "Computer isn't set up" card and
opens nothing.

Optional settings (defaults in brackets):

| Variable | Meaning |
| --- | --- |
| `COMPUTER_AGENT_MODEL` [`claude-sonnet-5`] | Model that drives the browser. Separate from every Chat model setting. |
| `COMPUTER_BROWSER_USD_PER_HOUR` [`0.12`] | Browser-time cost rate used for metering. Set it to your Browserbase plan's rate. |
| `COMPUTER_MAX_STEPS` [`60`] | Agent actions per task before it stops. |
| `COMPUTER_TASK_BUDGET_USD` [`2`] | Provider cost cap per task (tokens + browser time). |
| `COMPUTER_IDLE_TIMEOUT_MS` [`600000`] | How long a task waits for approval or for "Needs you" before it ends. |
| `COMPUTER_SESSION_TIMEOUT_SEC` [`1800`] | Browserbase session lifetime. |
| `COMPUTER_LIVE_VIEW_TTL_SEC` [`300`] | Lifetime of each live-view link. |

The app's nginx CSP allows `frame-src https://www.browserbase.com` so the
live view can load.

## How a task runs

1. The member asks in Chat. The org-only tool `start_computer_task` queues a
   row in `computer_tasks` and the answer shows a task card. Guests, homeowners
   and other non-org viewers never get the tool.
2. The worker claims the task. It reuses the org's one Browserbase context
   (cookies and logins persist) and opens a session.
3. The agent loop (`backend/src/computer/agent.ts`) sends screenshots to the
   computer-use model and runs its actions through a Playwright driver over
   CDP. The card polls `/api/chat-computer/tasks/:id` every 1.5 s for status.
4. When the site wants a sign-in, a verification code, or shows a captcha, the
   task pauses as **Needs you**. The task card opens the live view for Take
   control, the member finishes the step, and presses Resume. The one
   exception is a site with a **saved password** on Logins (below): there the
   server types the saved username and password itself. Computer never types
   verification codes, never solves captchas (`solveCaptchas: false`), and
   does not rapid-retry while paused.
5. Before a consequential click, the agent must call `request_approval`. The
   approval card shows a screenshot, each filled field with its value and
   where it came from, and Approve / Take control / Cancel.

## Safety model

- **The approval gate is in code, not just the prompt.** `gate.ts` classifies
  every click, Enter key and typed value before it runs, from the element
  under the pointer (label, role, type, form). Submit, send, pay, delete,
  sign, accept-terms and upload actions are blocked without a live approval.
  An approval is single-use. It covers one button label on one origin, expires,
  and is stored only as a sha256 hash. Navigation buttons such as Next,
  Continue, Sign in and Save draft are allowed.
- **Data in.** The agent gets an allowlisted projection of this job (title,
  number, claim and policy numbers, loss and work type, address, plus safe
  brief facts). It also gets what the member wrote in Chat. Lockbox and gate
  codes, PINs, SSNs and similar are excluded. Every approval field's "source"
  is worked out in code. A value that matches neither the job nor the message
  is flagged "check this".
- **Page content is untrusted.** The system prompt says so. `open_url` is
  limited to the sites named in the request. Any action outside the task is
  refused.
- **Live view links** are minted per viewer and expire in minutes. They are
  never stored or logged (the audit records only that someone watched or
  took control). The frontend frames only `https://www.browserbase.com`.
- **Audit.** `computer_audit_events` is append-only (a trigger blocks
  UPDATE, DELETE and TRUNCATE). Typed values are never written to it.
- All four tables are service-role only, with RLS on. Every route checks the
  caller's org, and another org's id returns 404.

## Metering

Feature `computer` (label "Computer") in usage and billing:

- Agent tokens go through `recordMeasuredTokenUsage` with source
  `computer_agent`.
- Browser time goes through `recordFlatProviderCost` with source
  `computer_session` and model id `browserbase-browser-time`. It is billed per
  started minute at `COMPUTER_BROWSER_USD_PER_HOUR`.
- Both get the standard 10x markup.
- A task is refused while AI is paused for the org (`assertAiFeatureAllowed`
  and `isAiPaused`). The step cap and per-task budget stop it mid-run.

## Why not Stagehand

Stagehand's `act`/`extract` would add a second model path and heavy
dependencies. Its actions would also bypass the gate, which must see every
click and keystroke. Claude computer use plus a thin Playwright driver
already works on any site, and keeps one place where actions are checked.

## Session durability and Check login

- **Browserbase Context** (one per org, `persist: true`) keeps cookies and
  logins across tasks. After a real sign-in on Logins (or Needs you for MFA),
  later tasks reuse that profile unless the site logged the org out.
- **Check login** on a saved site (`POST /api/chat-computer/logins/:id/verify`)
  opens the site on that profile, classifies signed-in vs login / MFA /
  captcha from the live page, reports a plain message, and releases the
  browser. It never invents credentials or types passwords.

## Saved passwords (Logins)

A Global Admin can save a username and password for a site on Logins, so
Computer signs back in on its own when the site has logged the org out.

- **Off unless configured.** Needs `COMPUTER_CREDENTIAL_KEY` (at least 32
  characters, e.g. `openssl rand -base64 48`). Without it the page says saving
  passwords isn't turned on, and everything else keeps working.
- **Storage.** AES-256-GCM (`credentialCrypto.ts`), one random IV per value,
  bound to its org, site and field so a value copied onto another row does
  not open. Each row records the key's fingerprint. Table
  `computer_login_credentials` is service-role only.
- **Who.** Only a Global Admin can save, replace or delete a password, or see
  the saved username. Nobody can read the password back.
- **Typing it.** The agent calls `sign_in_saved` for a site the task names.
  The server opens the credential and types it through the browser driver
  (`autoSignIn.ts`). The plaintext never goes into a model message, a
  screenshot for the model (password fields render masked), a log line or
  the audit log. The audit row records only the site and the outcome.
- **Where it is typed.** Only on the saved site's own pages, its catalog
  sign-in hosts, or a common identity provider it hands off to
  (`microsoftonline.com`, `live.com`, `accounts.google.com`, `okta.com`,
  `auth0.com`, `b2clogin.com`, any subdomain). Anywhere else, Computer opens
  the saved sign-in page first.
- **When it fails.** A wrong password marks the login **Needs attention** and
  the task pauses for the person. A code, a number to approve or a captcha
  after the password goes to **Needs you**, as above.

### Rotating the key

1. Generate a new key. Set `COMPUTER_CREDENTIAL_KEY_PREVIOUS` to the current
   value and `COMPUTER_CREDENTIAL_KEY` to the new one. Deploy.
2. Saved passwords still work. Each is re-sealed with the new key the next
   time Computer signs in with it.
3. To finish at once: `cd backend && npm run rotate:computer-credentials`
   (dry run), then again with `-- --apply`. It prints counts only, plus the
   ids of any rows sealed with a key that is not configured (an admin must
   save those again).
4. Remove `COMPUTER_CREDENTIAL_KEY_PREVIOUS`.
- **connectUrl recovery.** Browserbase session ids are stored on
  `computer_sessions`. `connect()` re-fetches `connectUrl` from
  `GET /v1/sessions/{id}` when the in-memory cache is gone (process restart).
  That only works while the provider session is still RUNNING. Sessions are
  created with `keepAlive: false`, so a deploy that drops CDP usually ends
  the browser; the sweep then marks the task **"Interrupted"**.
- **Not yet durable:** the agent loop (model messages, step cursor) lives in
  the worker process. Full resume across deploys would need keep-alive plus
  persisted agent state. This release only hardens reconnect + warm-up + HITL.

## Phase 1 limits

- A task that is running when the process restarts is marked failed
  ("Interrupted") by the sweep. It is not resumed (see above).
- Status updates come from polling, not a push stream.
- If the request names no site, `open_url` may go to any http(s) URL. The
  gate still applies.
- One active task per org at a time.

## Code map

- `backend/src/computer/`: `types`, `config`, `gate`, `projection`,
  `prompt`, `agent`, `model`, `metering`, `store`, `worker`, `service`,
  `logins`, `credentialCrypto`, `autoSignIn`, `rotateCredentials`,
  `providers/{browserbase,mock,playwrightDriver}`
- `backend/src/routes/computer.ts`: mounted at `/api/chat-computer`
  (`/api/computer` was the removed desktop-agent product and stays unmounted)
- `frontend/src/components/computer/`: task card, live view, approval card,
  Needs-you card
- Tests:
  - `backend/test/computer*.test.ts` (saved passwords and key rotation:
    `computerCredentials.test.ts`)
  - `frontend/src/components/computer/ComputerTaskCard.test.tsx`
  - `supabase/tests/08_computer_tasks.sh`

## Materials list and Home Depot order

See [hd-materials-order.md](./hd-materials-order.md). Screenshots: `docs/screens/hd-order/`.
