# Atmosphere Field Capture

The crew's side of the Work Verification Platform, designed from first
principles. One file, no build step, no dependencies — the same construction
as the Verifier, because it is the same product seen from the other end:
the Verifier is where evidence is read; this is where it is made.

## The principles

**One button, twice a day.** A crew member opens this on a job site, wearing
gloves, in glare, in a hurry. Asking them which job this is, whether it is a
before or an after, or what they just filmed is asking questions of someone
holding a ladder. So there is exactly one control: tap it when you get to
work, hold it when you are done. Everything between those two presses is the
system's problem.

**Attribution is derived, never typed.** One recording spans the whole day
and several jobs. Which stretch belongs to which job is decided from where
the phone was and when — which is why a job's address matters, and why a job
without one shows up on the home screen as *cannot be placed from GPS* while
there is still time to fix it. A stretch that cannot be placed is flagged for
a person, never quietly filed to whichever job happened to be nearest.

**The two presses carry different risk, so they are not equally easy.**
Starting the day early costs nothing. Ending it by accident with the phone in
a pocket loses the day's evidence. So starting is a tap and finishing is a
hold — still one button, in the same place, with the label saying which is
which.

**The system's needs ride inside the crew's flow.** Verification needs
location, a clock, frames sampled across the day, and a sealed hash. None of
that is a form. The door checks happen *to* the footage while the crew
watches; the labels write themselves. Evidence-grade capture costs the crew
two presses.

**Crew records; the office reads.** Field Capture never shows an AI report.
The live strip only names the site the phone thinks it is at. The AI
dictation — a spoken-style description of what is taking place — lives in
the Verifier next to the video. The end-of-day screen shows door checks and
how the day split by job so the crew knows the capture counted; the reading
itself is an office act.

**Same tokens as the Verifier.** Paper, warm ink, one terracotta accent,
monospace as the record's voice. The film a crew makes and the evidence it
becomes should look like one product, because they are one record.

**Phone-shaped, honestly.** One centered column at phone width, targets sized
for gloves, the one button full-width where a thumb lands. On a desktop it
does not stretch to pretend otherwise.

## What is in here

`index.html` — the whole thing: styles, script, and a demo record inline, so
it can be served from any static host, opened from disk, or embedded in the
demo artifact as the Field Capture view.

Against a live backend the screens hydrate from the proof endpoints that
already exist — today's assignments, the upload flow, the stored door checks,
and location status while rolling. A day-length (up to **24 hour**) recording
uploads as video only; the server sparsely extracts candidate stills with
FFmpeg, then **keeps only frames that look different** (perceptual hash) so a
static camera does not waste the model on the same picture for hours. That
pipeline lives in `backend/src/shared/videoIntelligence.ts` and is
**source-agnostic** — proof uploads, this Field Capture day file, CRM clips,
or any other fetchable video hit the same prepare+dictate path (also exposed
as `POST /api/media/video/process`). Proof rows still run the scope-aware
long-form analyst afterward; other ingresses get office dictation without a
`job_proofs` row. The phone never ships hundreds of base64 frames. The React
Field platform in `frontend/` remains the fully wired shell; this page is the
product's face and its design source of truth.

## The flow

1. **Today** — one button, and beneath it what the day expects: the jobs
   assigned to this crew, listed passively because none of them is a choice.
   A job with no address is marked *cannot be placed from GPS* here, where
   the office can still fix it. A "this week" strip shows what earlier days
   became, closing the loop most capture tools leave open.
2. **The day, running** — elapsed time, the site the phone believes it is at,
   and the watcher's plain-words reading. The site strip turns amber and says
   *not sure which job* rather than guessing. Closed vocabulary throughout:
   it names what it sees or says it cannot tell.
3. **Checked at the door** — the integrity ledger animates in: filmed on
   site, filmed live, sealed, split across N jobs. Below it, the day already
   segmented by job — including any stretch that could not be placed, shown
   as a named gap. Then the handoff: your part is done; the assistant reads
   it next.
