# Atmosphere corporate website

The marketing site for Atmosphere — a static, dependency-free suite of pages that
extends the product's design language (paper surfaces, warm ink, one terracotta
accent, monospace as the "audit record" voice).

## Pages

| File            | Page                                                        |
| --------------- | ----------------------------------------------------------- |
| `index.html`    | Home — thesis, replayable run receipt, platform overview    |
| `platform.html` | Platform — every agent, with a READS/WRITES/CHECKS spec     |
| `security.html` | Security — architecture diagram and six structural claims   |
| `pricing.html`  | Pricing — plans, BYO-API-key note, FAQ                      |
| `docs.html`     | Docs — quickstart cards and an index of `../docs/*.md`      |
| `about.html`    | About — story, principles, careers (`#careers`)             |
| `contact.html`  | Contact — sales/support blocks and an intake form           |
| `404.html`      | Not found — a run receipt that comes up empty               |

Shared assets live in `assets/site.css` (design tokens + components, light and
dark themes) and `assets/site.js` (the receipt replay behavior).

## Develop

Serve the directory with any static server:

```sh
python3 -m http.server -d website 8080
```

## Single-file preview

`build-preview.py` flattens all seven pages into one self-contained HTML file
with a hash router, for sharing a working walkthrough of the whole suite:

```sh
python3 website/build-preview.py preview.html
```

## Known gaps before production

- The contact form posts nowhere yet — wire `action` to a backend route.
- Pricing figures and the careers listings are design placeholders.
- App links (`/signin`, `/signup`, `/technician`) assume the site is served on
  the same origin as the frontend app.
