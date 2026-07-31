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
| `pricing.html`    | Pricing — the six plans, credit packs, and the usage model  |
| `docs.html`       | Docs — quickstart cards and an index of `../docs/*.md`      |
| `about.html`      | About — story and principles                                |
| `careers.html`    | Careers — roles, hiring process, and a working application form |
| `contact.html`    | Contact — sales/support blocks and an intake form           |
| `signin.html`     | Sign in — email/password plus the device-bound PIN          |
| `signup.html`     | Create your organization — onboarding walkthrough and form  |
| `404.html`        | Not found — a run receipt that comes up empty               |

Shared assets live in `assets/site.css` (design tokens + components, light and
dark themes) and `assets/site.js` (receipt replay + the careers form).

## Pricing is repo data, not copywriting

`pricing.html` mirrors the real billing model in
`supabase/migrations/20260727124743_billing_pricing_metering.sql`. The six
plans (Free, Pro, Max 5x, Max 20x, Team, Enterprise), their monthly and annual
prices, included credit allowances, seat minimums, and throughput multipliers
come from the `billing_plans` seed; the pack table comes from `credit_packs`,
volume bonuses included. **Change the migration and this page must change with
it** — or the site is quoting prices the product will not honor.

The same model applies to all four products: each is bought separately at these
same tiers. Usage is metered per token through the backend gateway and drawn
from credits (1 credit = $1 USD), so the site must never claim customers bring
their own API key for billing. The key that *is* customer-supplied is the one
for computer use, which is a setup step, not a billing arrangement.

`GET /api/billing/catalog` serves plans, packs, and the public rate card
unauthenticated — the natural source if this page is ever made dynamic.

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

`build-preview.py` flattens the fourteen routed pages (the 404 stays standalone)
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
