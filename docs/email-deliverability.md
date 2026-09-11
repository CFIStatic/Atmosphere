# Email deliverability — jettx.ai

Atmosphere mail (job invites, field OTPs, password resets, contact / careers)
was landing in junk because **jettx.ai is not fully authenticated**. The app
now sends through Resend as `hello@invites.jettx.ai` (DKIM + SES return-path)
and refuses to spoof `jack@jettx.ai` over an unrelated SMTP login. **Inbox
placement still needs two DNS records at GoDaddy and Google Workspace DKIM.**
Those cannot be published from this repo — nameservers are
`ns07.domaincontrol.com` / `ns08.domaincontrol.com`.

Check what is live:

```bash
npm run check:email-auth --prefix backend
```


## Sold-path email inventory

| Type | Code path | From (Resend) | Notes |
| --- | --- | --- | --- |
| Platform / org invites | `routes/org.ts` → `sendSystemMail` | `hello@invites.jettx.ai` | Returns `emailed: false` on failure; UI says so |
| Field Capture / job party invites | `deliverPartyInvite.ts` | same | Start a job + Add people |
| Progress / job-file share | `evidencePortal.ts` + `progressShareEmail` | same | Hard-fails (`email_not_sent`) if mail fails |
| Evidence share notify | `evidencePortal.ts` + `shareEmail` | same | Share kept; `emailed` flag truthful |
| Password reset | `auth/sendPasswordReset.ts` | same | Atmosphere mails the link (not Supabase Auth) |
| Field claim OTP | `routes/fieldIdentity.ts` | same | Email channel only (SMS not wired) |
| Contact form | `contactMail.ts` | same | `keepReplyTo` visitor address |
| Careers apply | `careersMail.ts` | same | Same transport |
| Billing receipts | Stripe Customer emails | Stripe | **Not** Atmosphere/Resend — enable in Stripe Dashboard |

**Transport order:** Resend (`RESEND_API_KEY`) → SMTP only if From matches the SMTP account → file log sink in development (`SYSTEM_MAIL_DRIVER=log` or unset SMTP/Resend).

**Domain fallback:** production always tries `hello@invites.jettx.ai` first (verified subdomain). It never treats `onboarding@resend.dev` as a production success path (that address only reaches the Resend account owner). Reply-To stays `jack@jettx.ai` when it is the same org.

**Prod verify:** `GET /api/ready` → `checks.mail.detail` should look like `resend from=hello@invites.jettx.ai …`. Then send one org invite or job party invite to `jack@jettx.ai` and confirm inbox delivery (not spam).

---

## What is wrong today

| Check | Live zone (2026-09) | Why it matters |
| --- | --- | --- |
| Apex SPF | Present (`include:_spf.google.com` via GoDaddy) | Google Workspace may send as `jack@jettx.ai` |
| Apex DMARC | **Missing** | Gmail, Yahoo, and Outlook require a DMARC record. Without it they junk the message |
| `invites.jettx.ai` DMARC | **Missing** | Same, for Resend's From (`hello@invites.jettx.ai`) |
| Resend DKIM | Present at `resend._domainkey.invites.jettx.ai` | Lets Resend sign invites |
| Resend return-path SPF | Present at `send.invites.jettx.ai` | Bounce domain for Resend / SES |
| Google Workspace DKIM | **Missing** (`google._domainkey.jettx.ai`) | Mail typed in Gmail, or sent via Gmail SMTP as `jack@jettx.ai`, fails DKIM |

Do **not** add Resend (`include:amazonses.com`) to the apex SPF. Resend already
authenticates on `send.invites.jettx.ai`. Changing apex SPF can break Google
Workspace.

---

## Records to add at GoDaddy

DNS → **jettx.ai** → Records. Leave existing MX and the current SPF TXT alone.

| Type | Name | Value |
| --- | --- | --- |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:jack@jettx.ai; fo=1; adkim=r; aspf=r` |
| TXT | `_dmarc.invites` | `v=DMARC1; p=none; rua=mailto:jack@jettx.ai; fo=1; adkim=r; aspf=r` |

`p=none` only publishes the policy and collects reports. After a week of clean
`rua` mail, raise both to `p=quarantine`, then `p=reject`.

### Google Workspace DKIM (for `jack@jettx.ai` in Gmail)

1. [Google Admin](https://admin.google.com) → Apps → Google Workspace → Gmail → **Authenticate email**.
2. Select `jettx.ai` → **Generate new record** (2048-bit).
3. Publish the TXT Google shows at `google._domainkey` (or the selector it names).
4. Click **Start authentication**. Wait until the Admin console says authenticating.

Until that TXT exists, every message sent as `jack@jettx.ai` from the Gmail UI
fails DKIM and is a junk candidate.

---

## What the app does now

- **Resend first.** `SYSTEM_MAIL_DRIVER=smtp` is the only way to force mailbox
  SMTP. A Yahoo / consumer SMTP login is never used to claim `jack@jettx.ai`.
- **From** is `Atmosphere <hello@invites.jettx.ai>` unless the apex domain is
  verified on the Resend account. **Reply-To** stays `jack@jettx.ai` (same org).
- Transactional sends set `Auto-Submitted: auto-generated` and a unique
  `X-Entity-Ref-ID` so Gmail does not thread every invite together.
- Marketing / sales sends add one-click `List-Unsubscribe`. Production never
  falls back to `onboarding@resend.dev` (that address only reaches the Resend
  account owner and would falsely mark invites as emailed).
- Contact and careers forms use the same authenticated path.

Turn click tracking **off** on the Resend domain (`invites.jettx.ai` →
Tracking). Rewritten links are a common junk signal.

---

## After DNS is live

1. Wait for TTL (GoDaddy often 1 hour; apex TXT here is ~30 minutes).
2. `npm run check:email-auth --prefix backend` — every line should say `ok`.
3. Send one invite to a Gmail, Outlook, and Yahoo address you control.
4. In each message, **Show original** / **View source** and confirm
   `spf=pass`, `dkim=pass`, `dmarc=pass` (or `dmarc=pass (p=none)`).
5. In Resend → Domains, `invites.jettx.ai` stays **Verified**.
