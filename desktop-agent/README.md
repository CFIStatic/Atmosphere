# Atmosphere desktop agent

A tiny local service that lets Atmosphere Computer work in a **Windows desktop
app** (today: Xactimate desktop) the same way it works on a website: it takes
screenshots, clicks and types, reads what is under a point, and types a saved
sign-in, all behind Atmosphere's existing approve-before-submit gate.

It is the desktop twin of the cloud browser Computer already drives. The
backend's `WindowsDesktopProvider` talks to this agent; everything else
(approvals, live view, audit, metering, the per-org one-task rule) is unchanged.

> **Xactimate is off until Verisk approves it.** Running an AI or automation
> tool against Xactimate needs written authorization from Verisk under the
> Xactware EULA. This agent ships so the capability is ready, but the backend
> keeps Xactimate **off by default** (`COMPUTER_DESKTOP_APPS` is empty). Only
> switch it on for an app once you have that authorization in writing.

## Where it runs

One Windows computer per customer org, with the app installed once and kept, so
the app and its sign-in survive between tasks. Two shapes:

- **The customer's own office PC.** The sign-in location is then naturally the
  customer's — which is what Atmosphere wants: Computer represents where the
  user actually is, not a data center. This is the cheapest and the most
  honest about location.
- **A cloud Windows VM you run (e.g. EC2).** Start it on demand and stop it when
  idle (the backend does this for `ec2` hosts). To keep the sign-in location at
  the customer's office, route the VM's outbound traffic through a small
  connector on their network (WireGuard or the like). The agent does not do
  this routing; it is an OS/network setup, documented in `docs/computer-desktop.md`.

## Security model (matches the cloud browser)

- **Pinned TLS.** The agent serves HTTPS with a self-signed certificate. The
  backend trusts only that one certificate for this host, so a machine that
  later takes the IP cannot impersonate the agent. No public certificate or
  domain is needed.
- **Signed, non-replayable requests.** Every call carries an HMAC-SHA256 of the
  method, path, timestamp and body, with a shared secret. The agent rejects a
  timestamp more than 60 seconds old.
- **No secrets at rest here.** The agent holds no passwords. When a sign-in is
  needed the backend sends the username and password for that one call; the
  agent types them and keeps nothing. Verification codes and phone approvals
  are always done by a person in the live view.
- **Local only.** Bind to the loopback or the office LAN. Never expose the agent
  to the public internet except through the pinned, signed channel the backend
  uses (a VPN/tunnel is the right way to reach an office PC).

## HTTP surface

All POST unless noted, JSON in and out. `GET /health` returns `{ "ok": true }`.

| Path | Purpose |
| --- | --- |
| `/session/start` | begin a task session (size the virtual screen) |
| `/session/end` | end it |
| `/screenshot` | `{ format, width, height }` → `{ image }` (base64) |
| `/input` | one action: click, move, down, up, drag, type, key, scroll |
| `/element-at`, `/focused` | UI Automation details under a point / of the focused control |
| `/fields` | labelled form fields in view (values read back, never passwords) |
| `/text` | visible text of the front window (for MFA/ error detection) |
| `/signals` | `{ text, hasPasswordField, hasOneTimeCodeField }` |
| `/window` | `{ kind: app\|browser\|none, app, title, url, signIn }` |
| `/launch` | `{ app }` start/raise a desktop app by id |
| `/open-url` | `{ url }` open an https page in the desktop browser |
| `/signin` | `{ username, password }` type a saved login into the front sign-in form |
| `/cursor` | current cursor position |

`reference_agent.py` is a minimal, dependency-light implementation for Windows
(pywinauto + Pillow + mss). It is a starting point, not a hardened build.
