# Computer on a Windows desktop (Xactimate)

Computer can work in a Windows desktop app the same way it works on a website:
it looks at the screen, clicks and types, and stops before anything final until
a person approves. The first desktop app is **Xactimate desktop**.

This is the same agent loop, approval gate, live view, audit and metering as the
cloud browser. Only the surface changes: instead of a hosted browser, the task
runs on one Windows computer per org, with the app installed once and kept.

## Xactimate is off until Verisk authorizes it

Verisk's Xactware EULA (the "Artificial Intelligence and Automation Tools
Restrictions" and the section 3 ban on RPA/AI accessing the Services) forbids an
AI or automation tool from operating Xactimate unless the EULA or your Services
Agreement **expressly authorizes** that use ("Authorized AI Use"). Hosting the
software for a customer may also fall under Verisk's hosting/third-party-use
limits.

So the capability ships **off**: `COMPUTER_DESKTOP_APPS` is empty by default and
no task is ever routed to Xactimate. Switch it on only after you have Verisk's
authorization in writing. Everything in this doc assumes that is in hand.

## The pieces

- **Desktop agent** (`desktop-agent/`) — a small local HTTPS service on the
  Windows computer. It takes screenshots and performs input, and types a saved
  sign-in the backend sends for one call. It holds no passwords and never types
  verification codes. See `desktop-agent/README.md`.
- **`WindowsDesktopProvider`** (`backend/src/computer/providers/windowsDesktop.ts`)
  — picks the org's computer, starts an EC2 host on demand and stops it when
  idle, connects the driver, and mints the live view.
- **`DesktopDriver`** (`backend/src/computer/desktop/driver.ts`) — the
  `ComputerDriver` for a desktop: screen, input, UI-Automation element details,
  and the sign-in address check so a saved password is only typed into that
  app's own sign-in window.
- **Desktop live view** (`backend/src/routes/desktopLive.ts`) — a same-origin
  page that shows the screen and, in control mode, forwards the person's clicks
  and keys. The link is a signed, short-lived, per-viewer token.

## Where the computer lives, and the sign-in location

A task opens on **one Windows computer per org**. Two shapes:

1. **The customer's own office PC.** The sign-in location is then naturally the
   customer's. This is the cheapest and the most accurate about location, which
   is what we want: Computer represents where the user actually is.
2. **A cloud Windows VM you run** (an `ec2` host). The backend starts it when a
   task needs it and stops it after `COMPUTER_DESKTOP_IDLE_STOP_MIN` idle; its
   disk persists, so the app and its sign-in survive. To keep the sign-in
   location at the customer's office, route the VM's outbound traffic through a
   small connector on their network (e.g. WireGuard), so traffic exits where the
   team is. This egress is an OS/network setup, not part of the agent.

The location is for representing where the team actually is — not for hiding
automation from Verisk. With Authorized AI Use in hand, there is nothing to hide.

## Setup (operator)

1. **Stand up the computer** (office PC or EC2 Windows) and install Xactimate.
2. **Run the agent** on it with a pinned certificate:
   ```
   # self-signed cert, kept on the host
   openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
     -keyout key.pem -out cert.pem -days 825 -subj "/CN=atmosphere-desktop-agent"
   set ATMOS_DESKTOP_AGENT_SECRET=<a 32+ char secret>
   python reference_agent.py --port 8443 --cert cert.pem --key key.pem
   ```
3. **Point the backend at it.** On the worker service set:
   - `COMPUTER_DESKTOP_AGENT_SECRET` — the same 32+ char secret.
   - `COMPUTER_DESKTOP_HOSTS` — JSON, org id → host. Always-on office PC:
     ```json
     { "<org-uuid>": { "url": "https://10.0.0.5:8443", "cert": "<base64 of cert.pem>" } }
     ```
     EC2 VM started on demand:
     ```json
     { "<org-uuid>": { "ec2": { "instanceId": "i-0abc…", "region": "us-east-1" }, "port": 8443, "cert": "<base64 of cert.pem>" } }
     ```
   - For `ec2` hosts, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` for an IAM
     user limited to `ec2:DescribeInstances`, `ec2:StartInstances`,
     `ec2:StopInstances` (ideally by instance tag).
4. **Switch the app on** only once authorized: `COMPUTER_DESKTOP_APPS=xactimate`.
   Until then every Xactimate request stays off the desktop.

Optional: `COMPUTER_DESKTOP_IDLE_STOP_MIN` [15] — minutes an idle EC2 desktop
stays on before it is stopped.

## Rough cost per org (estimates, not quotes)

- **EC2 Windows** (4 vCPU / 16 GB, e.g. t3.xlarge): ~$0.30–0.40/hr with Windows
  included. ~2 hrs/day over 22 workdays ≈ $15–20/mo; left on 24/7 ≈ $220–290/mo.
- **Disk/image:** ~$8–12/mo for 100 GB that persists between stops.
- **AI:** a screenshot per step, so several times a browser task's model cost.
- **Xactimate seat:** the customer's own seat (per user; Verisk doesn't publish
  pricing — secondary sources suggest ~$200–500/seat/mo).
- An **office PC** host removes the EC2 and disk cost entirely.

## What stays the same

Approvals (`gate.ts`), the per-org one-task rule, the allowlisted job
projection, "page content is untrusted", live-view links minted per viewer, and
the append-only audit all apply unchanged. Computer never types a verification
code and never solves a captcha; a person does that in the live view.
