# Atmosphere corporate website

The marketing site for Atmosphere — a static, dependency-free suite of pages that
extends the product's design language (paper surfaces, warm ink, one terracotta
accent, monospace as the "audit record" voice). Positioned restoration-first, but
written to appeal to contractors of every trade.

## Pages

| File              | Page                                                        |
| ----------------- | ----------------------------------------------------------- |
| `index.html`      | Home — Work Verification Platform thesis, replayable clip record |
| `verification.html` | Work Verification Platform — the product: film, check, read, hold, share |
| `how-it-works.html` | How it works — the full Work Verification pipeline, end to end |
| `field.html`      | Field Platform — capture on site, with a capture-log hero   |
| `platform.html`   | LATER PRODUCT (unlisted) — platform hub for the four-platform suite |
| `sales.html`      | LATER PRODUCT (unlisted) — Sales Platform                   |
| `operations.html` | LATER PRODUCT (unlisted) — Operations Platform              |
| `manager.html`    | LATER PRODUCT (unlisted) — Manager Platform                 |
| `security.html`   | Security — architecture diagram and six structural claims   |
| `pricing.html`    | Pricing — the 30-day test, seat plans, and the flat rate    |
| `docs.html`       | Resources hub — documentation index, guides, troubleshooting |
| `doc-*.html`      | Eight resource pages: getting started, recipes, troubleshooting, estimators, web access, computer use, field, billing |
| `about.html`      | About — the Work Verification company, story and principles |
| `careers.html`    | Careers — roles, hiring process, and a working application form |
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

`pricing.html` sells one model across all four products:

- **A 30-day test plan**, not a free tier. Full platform, one seat, usage billed
  at the ordinary rate.
- **Seat plans** — Pro ($20/$17 annual), Max 5x ($100), Max 20x ($200), Team
  ($30/seat, 5 seat minimum, $25 annual), Enterprise (contact). The seat price
  buys access and the throughput multiplier, nothing else.
- **Usage is prepaid credits at one flat rate**, on every plan. Customers buy
  credits (the `credit_packs` seed, bonuses included) before agents spend them,
  and work pauses at a zero balance. There is **no bundled allowance and no
  postpaid usage** — the page must never imply either. Reload behavior is a
  per-organization setting (`PATCH /api/billing/settings`: `autoReloadEnabled`
  + threshold + amount, surfaced in the app's Billing page); auto-reload off
  *is* manual reload.

  This ordering is the margin guarantee: every token is sold at 2× list and
  paid for before it is spent, so usage can never be served at a loss or go
  uncollected.

**The rate is flat and internally derived.** The flagship entry in
`backend/src/ai/catalog.ts` lists $15/$75 per million tokens; doubled, that is
the $30/$150 the page quotes, charged for *every* token regardless of which
model ran the task. Raise the flagship in the catalog and this number moves
with it. **The derivation is internal only**: customer-facing copy quotes the
two numbers and never names the underlying model, the provider, or the 2×
multiple — keep it that way when editing.

That flat rate constrains the copy: the site must never claim routing makes a
customer's bill cheaper, because it cannot. What it may claim — and what is
true — is that a fixed rate leaves us no incentive to route work to a weaker
model, and that better routing lands as better output rather than a smaller
invoice.

Two things to keep straight. The `billing_plans` seed in
`supabase/migrations/20260727124743_billing_pricing_metering.sql` still carries
a `free` plan and `included_credits_nanos` values from an earlier model — the
site deliberately does **not** follow it on those two points, and the migration
is the thing that needs updating. And the API key a customer supplies is for
computer use, which is a setup step, never a billing arrangement.

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

The static site works fully on Pages except the two backend-wired forms
(careers, contact), which need the Express backend hosted somewhere with the
SMTP variables below. Once it is, set the `WEBSITE_API_ORIGIN` repository
variable (Settings → Secrets and variables → Actions → Variables) to the
backend's https origin — the workflow stamps it into both forms' `data-api`
on the next deploy. Until then, submitting shows a clear could-not-reach
message rather than silently failing.

### Connecting the site to the product

The marketing → account creation → product chain is wired but dormant until
the app is hosted. Set the `WEBSITE_APP_ORIGIN` repository variable to the
app's https origin (e.g. `https://app.example.com`) and the next deploy
stamps it onto every page as `<html data-app-origin>`; `site.js` then:

- rewrites every **Sign in** CTA to `{origin}/login` and every **Get
  started / Create your organization** CTA to `{origin}/login?mode=signup`
  (the app's login page opens the create-account form for that deep link);
- turns the sign-in and sign-up pages' forms into a handoff — submitting
  forwards to the app with the typed email prefilled (never the password).

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
- The sign-in and sign-up pages are designed surfaces until
  `WEBSITE_APP_ORIGIN` is set (see "Connecting the site to the product") —
  then they hand off to the real app automatically. The investor form always
  keeps its notice; there is no investor surface in the app yet.
