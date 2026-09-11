# Email deliverability

Atmosphere transactional mail (invites, field OTPs, password resets, progress
shares, contact / careers) goes through **Resend** as:

- **From:** `Atmosphere <hello@invites.atmosphereteam.com>`
- **Reply-To:** `hello@atmosphereteam.com` (same org; contact/careers keep the visitor)

Pin with `RESEND_API_KEY` + `RESEND_FROM_EMAIL=hello@invites.atmosphereteam.com`.
Production never uses `onboarding@resend.dev` (that address only reaches the
Resend account owner). SMTP is a fallback only when Resend is unset or
`SYSTEM_MAIL_DRIVER=smtp`.

`invites.jettx.ai` / `hello@invites.jettx.ai` remain accepted as a **legacy**
sending domain during migration (env pin or automatic fallback if the Atmosphere
domain is not yet verified). Prefer Atmosphere.

Check live DNS:

```bash
npm run check:email-auth --prefix backend
```

`GET /api/ready` → `checks.mail.detail` should include
`resend from=hello@invites.atmosphereteam.com`.

## Sold path

| Type | Path |
| --- | --- |
| Org / platform invites | `routes/org.ts` → `sendSystemMail` |
| Job party invites | `deliverPartyInvite.ts` |
| Progress / job-file share | `progressShareEmail` (hard-fail if mail fails) |
| Evidence share | `shareEmail` (`emailed` flag truthful) |
| Password reset | `auth/sendPasswordReset.ts` |
| Field claim OTP | `routes/fieldIdentity.ts` |
| Contact / careers | `contactMail` / `careersMail` (`keepReplyTo`) |
| Billing receipts | **Stripe Dashboard** — not Atmosphere |

## Resend + Cloudflare DNS checklist

1. In Resend, add and verify **`invites.atmosphereteam.com`** (not the apex).
2. Publish the DKIM / return-path records Resend shows in **Cloudflare** DNS for
   `atmosphereteam.com`.
3. Turn Resend **click tracking OFF** on `invites.atmosphereteam.com` (tracking
   rewrites links and can break DMARC alignment).
4. On Railway: `RESEND_FROM_EMAIL=hello@invites.atmosphereteam.com`.
5. **Do not** put Resend in apex SPF — **Cloudflare Email Routing** owns apex
   SPF / MX for `hello@` / `support@` forwards to `jack@jettx.ai`. Resend
   authenticates only on `send.invites.atmosphereteam.com`.

Inbox placement still needs DMARC on apex + `invites.atmosphereteam.com`:

| Type | Name | Value |
| --- | --- | --- |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:hello@atmosphereteam.com; fo=1; adkim=r; aspf=r` |
| TXT | `_dmarc.invites` | same |
