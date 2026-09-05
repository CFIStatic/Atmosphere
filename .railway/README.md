# Railway graph (do not apply)

`graph.example.ts` is a typed inventory of Atmosphere services. It is **not**
wired to `railway up` or GitHub Actions.

Do not run a Railway TypeScript project-graph apply from this folder. A wrong
graph would recreate services or rewrite variables. The supported IaC remains
the per-service `railway.toml` files documented in `docs/railway-iac.md`.

Revisit after **2026-12-01**.
