# Atmosphere corporate website

The marketing site for Atmosphere — a static, dependency-free suite of pages that
extends the product's design language (paper surfaces, warm ink, one terracotta
accent, monospace as the "audit record" voice). Positioned restoration-first, but
written to appeal to contractors of every trade.

## Pages

| File              | Page                                                        |
| ----------------- | ----------------------------------------------------------- |
| `index.html`      | Home — thesis, replayable run receipt, platform overview    |
| `platform.html`   | Platform hub — the four platforms + the shared foundation   |
| `sales.html`      | Sales Platform — pipeline, the agent, the handoff           |
| `operations.html` | Operations Platform — project management, estimating, assistance |
| `field.html`      | Field Platform — capture on site, with a capture-log hero   |
| `manager.html`    | Manager Platform — job costing, accounting, business insights |
| `security.html`   | Security — architecture diagram and six structural claims   |
| `pricing.html`    | Pricing — the 30-day test, seat plans, and the flat rate    |
| `docs.html`       | Resources hub — documentation index, guides, troubleshooting |
| `doc-*.html`      | Eight resource pages: getting started, recipes, troubleshooting, estimators, web access, computer use, field, billing |
| `about.html`      | About — story and principles                                |
| `careers.html`    | Careers — roles, hiring process, and a working application form |
| `contact.html`    | Contact — sales/support blocks and an intake form           |
| `signin.html`     | Sign in — email/password plus the device-bound PIN          |
| `signup.html`     | Create your organization — onboarding walkthrough and form  |
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
- **Usage billed separately at one flat rate**, on every plan. There are **no
  included credits and no bundled allowance** — the page must never imply either.

**The rate is flat and set by the frontier model.** Claude Opus 5 lists at
$15/$75 per million tokens in `backend/src/ai/catalog.ts`; doubled, that is the
$30/$150 the page quotes — and it is charged for *every* token regardless of
which model actually ran the task. Raise the flagship in the catalog and this
number moves with it.

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

## Careers applications (frontend + backend)

The form on `careers.html` posts JSON to **`POST /api/careers/apply`**, served
by `backend/src/routes/careers.ts`. The backend validates the application
(`careersApplicationSchema`), drops honeypot submissions, rate-limits to 5/hour
per IP, and emails the application to the hiring inbox via SMTP
(`backend/src/lib/careersMail.ts`).

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

## Known gaps before production

- Pricing now mirrors the billing migration; the careers listings and benefits
  are still placeholders, and the on-site roles need a real location named.
- The contact form posts nowhere yet — the careers form is the wired example to
  copy when giving it a backend route.
- The sign-in and sign-up pages are designed surfaces; hook them to the real
  app routes (or replace them with the frontend app) at deploy time.
