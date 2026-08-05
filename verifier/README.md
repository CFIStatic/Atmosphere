# Atmosphere Verifier

The evidence portal. A separate property from the platform, deliberately.

## Why it is its own site

The people who need to review proof are not the people who run the company. An
adjuster settling a supplement, a carrier's desk examiner, a general
contractor's project manager releasing a payment, an attorney reading a job
back eighteen months later — none of them need an operations console, and
handing one to an outside party is both a support burden and a disclosure
problem. They need one screen: every clip on the job, what the analysis found,
whether the footage can be trusted, and who has touched it since.

Keeping it separate also keeps the access model honest. A Verifier link can be
scoped to a claim or a job and shared outward; the platform cannot.

## What is in here

`index.html` — the whole thing. No build step, no dependencies, no external
requests: styles, script and demo record are inline, so it can be served from
any static host, opened from disk, or embedded in the demo artifact as its own
view alongside Platform, Subcontractor and Website.

Against a live backend the record comes from `/api/operations/shared/:jobId/evidence`
and the proof endpoints; the copy in this file is the same demo narrative the
platform demo tells, seen from the reviewer's side.

## Three rules it is built around

**Integrity is a column, not a detail.** A clip whose GPS puts it two miles
from the site is worse than no clip at all, and the list says so before anybody
opens it.

**A model's reading and a person's acceptance are rendered differently.** They
are different claims. A screen that shows them identically is how the first
gets mistaken for the second, and that mistake releases money.

**Unknown is its own state.** Styled as neither pass nor fail, because an
unchecked clip is not a clean one — and "we could not tell" is an answer the
system is required to be able to give.

## The access model

Shares are account-to-account. A share is issued to a recipient's email and
opens only for a signed-in Atmosphere account matching it — which is what puts
a verified identity on every custody entry instead of "someone with the link",
and is also why every adjuster and attorney who reviews evidence ends up with
an Atmosphere account.

The share itself travels by email, sent from the sharing org's own connected
mailbox. The wording forks on whether the address already answers to an
account — sign in, or create one with this exact address — because the link
refuses any other account, forwarded or not. Erasure tombstones outrank the
notification (an address that asked to be forgotten gets no mail; the link
can be handed over any other way), and whether the email actually went out is
recorded in the custody entry for the share.

Watching is free; keeping a copy is not. A download by an external account
settles the sharing organization's fee first (their `evidence_download_policy`
row; $25 by default), through an append-once ledger — no signed download URL
exists until the ledger row reads paid or waived. The org's own members
download their evidence free, but still through the ledger and the custody
log, because "who holds a copy of this clip" should always be a query.
