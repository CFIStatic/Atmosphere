# Email deliverability

Atmosphere transactional mail (invites, field OTPs, password resets, progress
shares, contact / careers) goes through **Resend** as:

- **From:** `Atmosphere <hello@invites.jettx.ai>`
- **Reply-To:** `jack@jettx.ai` (same org; contact/careers keep the visitor)

Pin with `RESEND_API_KEY` + `RESEND_FROM_EMAIL=hello@invites.jettx.ai`. Production
never uses `onboarding@resend.dev` (that address only reaches the Resend account
owner). SMTP is a fallback only when Resend is unset or `SYSTEM_MAIL_DRIVER=smtp`.

Check live DNS:

```bash
npm run check:email-auth --prefix backend
```

`GET /api/ready` → `checks.mail.detail` should include
`resend from=hello@invites.jettx.ai`.

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

## DNS (GoDaddy + Google)

Inbox placement still needs DMARC on apex + `invites.jettx.ai`, and Google
Workspace DKIM for `jack@jettx.ai` in Gmail. Do **not** add Resend to apex SPF —
Resend authenticates on `send.invites.jettx.ai`.

| Type | Name | Value |
| --- | --- | --- |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:jack@jettx.ai; fo=1; adkim=r; aspf=r` |
| TXT | `_dmarc.invites` | same |

Google Admin → Gmail → Authenticate email → publish `google._domainkey`, then
Start authentication. Turn Resend click tracking **off** on `invites.jettx.ai`.
