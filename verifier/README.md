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

## The preview and the player

**A preview is a frame of the clip, or it is nothing.** The cell shows the
still the pipeline kept and the portal signed; failing that, one this browser
lifted out of the footage the last time somebody opened it, kept for the tab.
Failing both, it shows an empty cell that says the still has not been made
yet. What it never shows is a drawing — the schematic frames are the demo
artifact's, which has no footage behind it, and a reviewer who works out that
the picture in an evidence list is invented stops believing the column.

Nothing in the preview path fetches a clip. Minting a video URL is what writes
the `viewed` line in the chain of custody, so a hover, a scroll or a repaint
must not be able to do it — hovering a row plays the real seconds back in the
cell only for a clip already opened in this tab, whose URL is already in hand.

**The player is YouTube's, because that is the one everybody already has.** A
full-width bar under the picture that thickens when reached for, buffered
behind played, a bubble that follows the cursor, drag to scrub, and the keys
bound where they are bound there — space or K to pause, arrows for five
seconds, J and L for ten, M, F, and the digits for tenths. A player somebody
has to learn is a player they use wrong, and getting a second wrong is how two
people end up arguing about different moments.

The addition is the ticks. Every note the assistant wrote sits on the bar at
the second it describes, so the timeline is also the index of the reading:
hover one and it says what was seen there. They are only drawn against a
length the file itself reports, because a note pinned at a guess is worse than
no note.
