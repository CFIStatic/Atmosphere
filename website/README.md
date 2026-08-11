# Atmosphere corporate website

The marketing site for Atmosphere — a static, dependency-free suite of pages that
extends the product's design language (paper surfaces, warm ink, one terracotta
accent, monospace as the "audit record" voice). Positioned written for service contractors of every trade.

## Pages

| File              | Page                                                        |
| ----------------- | ----------------------------------------------------------- |
| `index.html`      | Home — Work Verification for service contractors, two-product overview |
| `verification.html` | Evidence Platform — record, verify, store, and share |
| `how-it-works.html` | How it works — the full Work Verification pipeline, end to end |
| `field.html`      | Field Capture — film and check work on site |
| `platform.html`   | Redirect → home (legacy four-platform page) |
| `sales.html`      | Redirect → home (legacy) |
| `operations.html` | Redirect → home (legacy) |
| `manager.html`    | Redirect → home (legacy) |
| `security.html`   | Security — architecture diagram and six structural claims   |
| `pricing.html`    | Pricing — Work Verification bundle ($599/mo) and the flat rate |
| `docs.html`       | Resources hub — documentation index, guides, troubleshooting |
| `doc-*.html`      | Resource pages: getting started, recipes, troubleshooting, field capture, verifier, billing |
| `about.html`      | About — the Work Verification company, story and principles |
| `careers.html`    | Careers — roles, hiring process, and a working application form |
| `contact.html`    | Contact — sales/support blocks and an intake form           |
| `signin.html`     | Sign in — a real login against the backend (`/api/auth/login`) |
| `signup.html`     | Create your organization — onboarding walkthrough and form  |
| `investors.html`  | Investors — invite-only data-room sign-in (under Company)   |
| `privacy.html`    | Privacy policy — plain-language draft pending counsel       |
| `terms.html`      | Terms of service — plain-language draft pending counsel     |
| `404.html`        | Not found — a run receipt that comes up empty               |

Shared assets live in `assets/site.css` (design tokens + components, light and
dark themes) and `assets/site.js` (receipt replay + the careers form).

## Pricing

`pricing.html` sells one bundled subscription plus usage in **understandable units**:

- **Work Verification** — configurable monthly platform fee (seed plan: $599/month).
  Includes Field Capture and the Evidence Platform. Both parts are required.
- **Job usage** — unique jobs processed per billing period; plans include an allowance
  with per-job overage pricing (all configurable in `metering_plan_versions`).
- **Exceptional compute** — Atmosphere Compute Units for heavy workloads (video analysis,
  large documents). Internal AI/token costs are tracked in `private.ai_usage_events`
  but never shown on customer invoices.

Legacy prepaid credits (`credit_packs`, `record_usage`) remain during migration.
New workflows should record via `record_ai_usage_event` and bill through job + compute.

## Resources

The nav's Resources tab gathers `docs.html` (the hub), the eight `doc-*.html`
pages, and Security. Doc pages share a sidebar generated in one place — when
adding a doc, add it to every sidebar (they are static copies), to the hub's
list, and to `build-preview.py`'s PAGES. The preview's link-rewrite pattern is
derived from PAGES, so registering the route there is the only wiring needed.
Doc content is customer-facing prose grounded in `../README.md` and
`../docs/*.md` — the internal engineering plans themselves are deliberately not
published.

## The recovery counter

The home page's `#unbilled` section publishes one number: **money recovered
for customers** — work that was performed, never billed, and put back on an
invoice because the Estimator read the job back against its own record.

It is a factual public claim, so it is wired to exactly four attributes on
`<div class="recovery">` in `index.html` and nothing else:

| Attribute         | Meaning                                              |
| ----------------- | ---------------------------------------------------- |
| `data-recovered`  | Total recovered, whole dollars                       |
| `data-jobs`       | Jobs read back (the denominator for the average)     |
| `data-largest`    | Largest single find                                  |
| `data-asof`       | Human date the totals were taken, e.g. `August 2026` |

Fill them from the audit ledger's recovery findings — the same figures a
customer can replay run by run — and never round them up. The average is
derived, not entered, so it can't drift from the other two.

**While `data-recovered` is `0` the section renders "Not published yet"
instead of a total**, so an unfilled counter can never read as a claim of
zero. That is the state it ships in today: set the real numbers before
launch, and re-check the as-of date whenever they move.

## Forms (frontend + backend)

Both site forms are wired end to end through one JS helper in `assets/site.js`:

- `careers.html` posts to **`POST /api/careers/apply`**
  (`backend/src/routes/careers.ts`) — emails the hiring inbox.
- `contact.html` posts to **`POST /api/contact/send`**
  (`backend/src/routes/contact.ts`) — emails the sales inbox
  (`CONTACT_TO_EMAIL`, falling back to the careers inbox).

Both validate with zod, drop honeypot submissions, rate-limit to 5/hour per IP,
and share one SMTP transport (`backend/src/lib/careersMail.ts`).

Configure delivery with environment variables on the backend:

| Variable             | Meaning                                              |
| -------------------- | ---------------------------------------------------- |
| `CAREERS_TO_EMAIL`   | Where applications land (default `jackcyganiak@yahoo.com`) |
| `CAREERS_FROM_EMAIL` | Envelope sender (defaults to `SMTP_USER`)            |
| `SMTP_HOST`          | SMTP server hostname                                 |
| `SMTP_PORT`          | Port (default `587`)                                 |
| `SMTP_SECURE`        | `true` for implicit TLS (port 465)                   |
| `SMTP_USER`          | SMTP username                                        |
| `SMTP_PASS`          | SMTP password / app password                         |

Without SMTP configured, development accepts and logs applications so the flow
is testable; production returns 503 so a misconfigured deploy fails loudly.

The site assumes it is served on the same origin as the backend (`/api/...`).
Hosted elsewhere? Set `data-api="https://your-backend"` on the forms in
`careers.html`, `contact.html`, and `signin.html`.

## Sign in

`signin.html` is a working login surface, not a stub. Submitting posts the
credentials to **`POST /api/auth/login`** (`backend/src/routes/auth.ts`) with
`credentials: 'include'` — the session comes back as httpOnly cookies, so no
token ever touches page JavaScript. On success the page forwards to
`{app}/login?email=...`: the app sees the fresh session and passes straight
through to the dashboard; if the browser declined a cross-site cookie (site
and backend on different origins — Safari does this), the app's login page
opens with the email prefilled instead, so the user is one password away,
never dead-ended. The API origin comes from the form's `data-api` (stamped
from `WEBSITE_API_ORIGIN` at deploy), falling back to same-origin, or
`http://localhost:4000` in local dev.

For a cross-origin deploy the backend must also allow the site's origin:
add it to the backend's comma-separated `FRONTEND_ORIGIN` (CORS runs with
credentials), and use `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true` if the
app and backend are on different origins.

## Develop

Serve the directory with any static server:

```sh
python3 -m http.server -d website 8080
```

## Single-file preview

`build-preview.py` flattens the routed pages (the 404 stays standalone)
into one self-contained HTML file with a hash router, for sharing a working
walkthrough of the whole suite:

```sh
python3 website/build-preview.py preview.html
```

## SEO & sharing

Every page carries Open Graph / Twitter meta; `assets/og.png` is the share
card. `sitemap.xml` and `robots.txt` use the placeholder
`https://REPLACE-WITH-YOUR-DOMAIN` — the deploy workflow substitutes the real
origin (and absolutizes the `og:image` URL) at publish time, so the repo never
hard-codes a host. Pricing embeds its FAQ as JSON-LD.

## Hosting

`.github/workflows/deploy-website.yml` publishes this directory to GitHub
Pages on every push to `main` that touches `website/`. The first run enables
Pages on the repo; if the token lacks permission for that, flip it once by
hand (Settings → Pages → Source: **GitHub Actions**) and re-run.

The static site works fully on Pages except the three backend-wired forms
(careers, contact, sign-in), which need the Express backend hosted somewhere
(the mail forms also need the SMTP variables below). Once it is, set the
`WEBSITE_API_ORIGIN` repository variable (Settings → Secrets and variables →
Actions → Variables) to the backend's https origin — the workflow stamps it
into the forms' `data-api` on the next deploy. Until then, submitting shows
a clear could-not-reach message rather than silently failing.

### Connecting the site to the product

The marketing → account creation → product chain is wired but dormant until
the app is hosted. Set the `WEBSITE_APP_ORIGIN` repository variable to the
app's https origin (e.g. `https://app.example.com`) and the next deploy
stamps it onto every page as `<html data-app-origin>`; `site.js` then:

- rewrites every **Get started / Create your organization** CTA to
  `{origin}/signup`, and makes the sign-up page skip its marketing stub and
  open the app's create-account flow directly;
- gives the sign-in page (which performs the real login itself — see
  "Sign in" above) somewhere to land: after a successful login it forwards
  to `{origin}/login?email=...`, which passes an authenticated session
  straight through to the dashboard.

Downstream is already live in the app: a new account routes to onboarding,
which creates the organization or joins one by code, then lands on the
dashboard. Unset, the site keeps its designed early-access surfaces.

## Known gaps before production

- The careers listings and benefits are placeholders, and the on-site roles
  still need a real city named.
- Privacy and terms are plain-language drafts and need review by counsel.
- The investor page is a designed surface — the data room behind it (auth +
  documents) doesn't exist yet; "Request access" routes to contact.
- The placeholder domain is stamped automatically by the Pages workflow; on
  any other host, substitute `https://REPLACE-WITH-YOUR-DOMAIN` in
  `sitemap.xml`/`robots.txt` and absolutize `og:image` yourself.
- Sign-in authenticates for real once the backend is reachable
  (`WEBSITE_API_ORIGIN`, or same-origin hosting), but only lands in the
  dashboard once `WEBSITE_APP_ORIGIN` is set (see "Connecting the site to
  the product"). The sign-up page stays a designed surface until
  `WEBSITE_APP_ORIGIN` is set, then hands off to the real app. The investor
  form always keeps its notice; there is no investor surface in the app yet.
