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
| `hardware.html`   | Field Capture Chest Mount — $49 hands-free phone kit |
| `platform.html`   | Redirect → home (legacy four-platform page) |
| `sales.html`      | Redirect → home (legacy) |
| `operations.html` | Redirect → home (legacy) |
| `manager.html`    | Redirect → home (legacy) |
| `security.html`   | Security — architecture diagram and six structural claims   |
| `pricing.html`    | Pricing — Work Verification bundle ($599/mo) and usage |
| `docs.html`       | Resources hub — documentation index, guides, troubleshooting |
| `doc-*.html`      | Resource pages: getting started, recipes, troubleshooting, field capture, Integrity agent, billing |
| `about.html`      | About — the Work Verification company, story and principles |
| `careers.html`    | Careers — software engineering and sales roles, hiring process, application form |
| `contact.html`    | Contact — sales/support blocks and an intake form           |
| `signin.html`     | Sign in — email/password plus the device-bound PIN          |
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

## Homepage focus

The homepage sells Work Verification only (Field Capture + Evidence Platform).
The Estimator / recovered-invoice counter is not on the homepage — do not add
an Estimator CTA there while that later product is out of scope.

## Forms (frontend + backend)

Both site forms are wired end to end through one JS helper in `assets/site.js`:

- `careers.html` posts to **`POST /api/careers/apply`**
  (`backend/src/routes/careers.ts`) — emails the hiring inbox.
- `contact.html` posts to **`POST /api/contact/send`**
  (`backend/src/routes/contact.ts`) — emails the sales inbox
  (`CONTACT_TO_EMAIL`, falling back to the careers inbox).

Both validate with zod, drop honeypot submissions, rate-limit to 5/hour per IP,
and share Atmosphere mail (`backend/src/lib/systemMail.ts`) — Resend first,
SMTP only when the account can authenticate `jettx.ai`.

Configure delivery with environment variables on the backend:

| Variable             | Meaning                                              |
| -------------------- | ---------------------------------------------------- |
| `CAREERS_TO_EMAIL`   | Where applications land (default `jack@jettx.ai`)    |
| `CAREERS_FROM_EMAIL` | Reply-To / configured From (defaults to `jack@jettx.ai`) |
| `RESEND_API_KEY`     | Preferred. Sends as `hello@invites.jettx.ai`         |
| `SMTP_HOST`          | SMTP fallback hostname                               |
| `SMTP_PORT`          | Port (default `587`)                                 |
| `SMTP_SECURE`        | `true` for implicit TLS (port 465)                   |
| `SMTP_USER`          | SMTP username                                        |
| `SMTP_PASS`          | SMTP password / app password                         |

See `docs/email-deliverability.md` for the GoDaddy DMARC + Google DKIM records
required so `jettx.ai` mail is not junked. Without Resend or SMTP, development
accepts and logs applications; production returns 503.

The site assumes it is served on the same origin as the backend (`/api/...`).
Hosted elsewhere? Set `data-api="https://your-backend"` on the form in
`careers.html`.

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

`hardware.html` is a product page for the Field Capture Chest Mount ($49).
The Buy button defaults to `mailto:hello@atmosphereteam.com`. To send it to
Stripe later, paste a Payment Link (`https://buy.stripe.com/...`) into the
page's `CHECKOUT_URL`, `data-checkout-url`, or `window.ATMOSPHERE_HARDWARE_CHECKOUT_URL`.

Every public page carries Open Graph / Twitter meta, a canonical URL, and
`og:url` on `https://atmosphereteam.com/...`. The share card is
`https://atmosphereteam.com/assets/og.png`. `sitemap.xml` and `robots.txt`
use that same apex host (clean paths, no `.html`, no Railway hostnames).
Noindex redirect stubs (`platform.html`, `sales.html`, `operations.html`,
`manager.html`, `doc-computer-use.html`, `doc-estimators.html`) stay out of
the sitemap. Pricing embeds its FAQ as JSON-LD.

Nginx serves extensionless URLs (`/pricing` → `pricing.html`) and keeps
existing `*.html` links working. `www.atmosphereteam.com` 301s to the apex
**when that Host header reaches this service**. If www still resolves
elsewhere (Squarespace or a Cloudflare record that does not target Railway),
add a Cloudflare/DNS redirect: `www.atmosphereteam.com` →
`https://atmosphereteam.com` (or CNAME www onto the Railway website
hostname so the in-repo 301 can fire).

## Hosting

Production is the Railway service **Corporate Website** (alias `website`).
The canonical public host is `https://atmosphereteam.com`. Railway also
exposes a fallback hostname (`https://website-production-7e3f.up.railway.app`)
— do not put that host in sitemap, robots, or Open Graph.

`.github/workflows/deploy-website.yml` ships this directory there on every
push to `main` that touches `website/`. GitHub Pages is an optional second
host and is **not enabled** on the repo today. See `docs/production.md` →
"Get the corporate website working" to attach the custom domain.

The first Pages run enables Pages on the repo; if the token lacks permission
for that, flip it once by hand (Settings → Pages → Source: **GitHub Actions**)
and re-run.

The static site works fully on Pages except the two backend-wired forms
(careers, contact), which need the Express backend hosted somewhere with the
SMTP variables below. Once it is, set the `WEBSITE_API_ORIGIN` repository
variable (Settings → Secrets and variables → Actions → Variables) to the
backend's https origin — the workflow stamps it into both forms' `data-api`
on the next deploy. Until then, submitting shows a clear could-not-reach
message rather than silently failing.

### Connecting the site to the product

Sign in / Get started already bake
`data-app-origin="https://platform.atmosphereteam.com"`. `site.js` then:

- rewrites every **Sign in** CTA to `{origin}/login` and every **Get
  started / Create your organization** CTA to `{origin}/signup`
  (the app's create-account wizard). A signed-in visitor still lands on
  that form instead of their dashboard, so the link can create a new
  account from the marketing site;
- rewrites **Forgot password?** (`data-app-path="/forgot-password"`) to
  `{origin}/forgot-password`;
- turns the sign-in and sign-up pages' forms into a handoff — submitting
  forwards to the app with the typed email prefilled (never the password).

Downstream is already live in the app: a new account routes to onboarding,
which creates the organization or joins one by code, then lands on the
dashboard. Override the stamp with `APP_ORIGIN` at image build, or with the
`WEBSITE_APP_ORIGIN` repository variable on a Pages deploy.

## Known gaps before production

- The careers listings are the current engineering and sales openings; location
  is confirmed during hiring rather than named on the page.
- Privacy and terms are plain-language drafts and need review by counsel.
- The investor page is a designed surface — the data room behind it (auth +
  documents) doesn't exist yet; "Request access" routes to contact.
- The sign-in and sign-up pages hand off to
  `https://platform.atmosphereteam.com` (`/login` and `/signup`). The
  investor form always keeps its notice; there is no investor surface in
  the app yet.
