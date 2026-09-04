# Cyber Defense Agent

Branch: `cursor/cyber-defense-agent-6f3d`

Atmosphere's backend defender. It watches every request on the BFF, scores hostile
traffic, **blocks** bad actors immediately, **deceives** scanners with honeypot
surfaces so they never touch real data, and **auto-patches** runtime hardening
(rotated decoy credentials, expired bans, config audits, elevated posture under
attack).

This agent is **defensive only**. It does not generate exploits or attack other
systems.

---

## Pipeline

```
request
  → security headers (helmet + agent)
  → body/cookie parse
  → Cyber monitor
       ├─ IP already banned? → 403, stop
       │    (never on /api/auth/* or private / loopback hops)
       ├─ Decoy / probe path? → fake success (tarpit), often ban, stop
       ├─ High threat score on a real path? → ban + 403, stop
       └─ else → real Atmosphere routers
```

## What it monitors

| Signal | Examples |
| --- | --- |
| Honeypot / recon | `/.env`, `/.git`, `/wp-admin`, `/phpmyadmin`, `/api/admin`, `/api/v1/secrets` |
| Traversal | `../`, `/etc/passwd`, encoded equivalents |
| Injection | SQLi / script patterns in query or body (bodies are redacted before match) |
| Scanners | sqlmap, nikto, nuclei, gobuster, … user-agents |
| Legacy probes | `.php` / `.asp` hits on a Node API |

## Deception

Decoy responses look useful (fake `.env`, fake AWS keys, fake admin JSON, fake
SQL dumps) but every credential is an **ephemeral token** rotated by auto-patch.
Nothing real is ever served. A short tarpit delay slows automated scanners.

## Auto-patch

On a timer (default every 15 minutes) and on demand via `POST /api/cyber/patch`:

1. Rotate decoy credentials so scraped dumps go stale
2. Expire finished IP bans
3. Audit known weak-config combinations
4. Elevate posture when under sustained attack
5. Confirm security response headers are armed

## API (auth required)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/cyber/status` | Posture snapshot |
| GET | `/api/cyber/events` | Recent threat events |
| GET | `/api/cyber/blocks` | Active IP bans |
| GET | `/api/cyber/patches` | Recent hardening results |
| POST | `/api/cyber/unblock` | `{ "ip": "…" }` false-positive escape |
| POST | `/api/cyber/patch` | Run one hardening cycle now |

## Config

```bash
CYBER_DEFENSE_ENABLED=true
CYBER_MONITORING=true
CYBER_DECEPTION=true
CYBER_AUTO_BLOCK=true
CYBER_AUTO_PATCH=true
CYBER_PATCH_INTERVAL_MINUTES=15
```

Set any lever to `false` to disable that piece. The agent keeps state **in
process memory** so it still works if Postgres is down. Optional archive tables
live in `supabase/migrations/20260728153000_cyber_defense_agent.sql`.

## Code

```
backend/src/cyber/
  agent.ts        decide observe / deceive / block
  monitor.ts      Express middleware
  detector.ts     signature scoring
  signatures.ts   defensive patterns + decoy path list
  deception.ts    honeypot response builders
  blocker.ts      IP ban TTL helpers
  autoPatch.ts    runtime hardening
  scheduler.ts    background patch cycle
  store.ts        in-memory events / blocks / patches
  types.ts
```

Audit catalog key: `cyber_defense`.
