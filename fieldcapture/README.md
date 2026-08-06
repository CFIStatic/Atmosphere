# Atmosphere Field Capture

The crew's side of the Work Verification Platform, designed from first
principles. One file, no build step, no dependencies — the same construction
as the Verifier, because it is the same product seen from the other end:
the Verifier is where evidence is read; this is where it is made.

## The principles

**One question, answered instantly.** A crew member opens this on a job site,
wearing gloves, in glare, in a hurry. The only question that matters is
"what do I film right now?" — so the home screen is today's jobs with
before/after status and one button each. No dashboard, no feed, no menu.

**One action per screen.** Today → shot list → record → checked at the door →
done. Each screen does one thing and leads to exactly one next thing. Back
exists; branching does not.

**The system's needs ride inside the crew's flow.** Verification needs an
anchor shot, the scope walked, exclusions filmed untouched, GPS and clock
attached, a hash sealed. None of that is a form. The shot list *is* the
scope; the door checks happen *to* the footage while the crew watches; the
labels write themselves. Evidence-grade capture costs the crew zero taps
beyond record and stop.

**Show the crew what the office sees.** The live watcher names the step being
filmed in plain words, and the door screen replays the same integrity checks
the Verifier will show a reviewer. A crew that can see their film passing
checks films better — and trusts the system that is, after all, watching
them work.

**Same tokens as the Verifier.** Paper, warm ink, one terracotta accent,
monospace as the record's voice. The film a crew makes and the evidence it
becomes should look like one product, because they are one record.

**Phone-shaped, honestly.** One centered column at phone width, targets sized
for gloves, the record button where a thumb lands. On a desktop it does not
stretch to pretend otherwise.

## What is in here

`index.html` — the whole thing: styles, script, and a demo record inline, so
it can be served from any static host, opened from disk, or embedded in the
demo artifact as the Field Capture view.

Against a live backend the screens hydrate from the proof endpoints that
already exist — today's assignments, `capture-guide` per phase, the upload
flow, the stored door checks, and `live-observe` for the watcher. The React
Field platform in `frontend/` remains the fully wired implementation; this
page is the product's face and its design source of truth.

## The flow

1. **Today** — jobs assigned to this crew, each with before/after status and
   one call to action. A "this week" strip shows what earlier films became
   (verified, read, waiting on a person), closing the loop that most capture
   tools leave open.
2. **Film it like this** — the shot list built from the job's own scope:
   anchor first (proves the address), each scope line, exclusions filmed
   untouched (the crew's protection, and labeled that way), a wrap for
   anything unexpected.
3. **Recording** — viewfinder with the live watcher naming the current step.
   Closed vocabulary: it names a step or says it cannot tell; it never
   invents one.
4. **Checked at the door** — the integrity ledger animates in: filmed on
   site (distance in feet), filmed just now, sealed, filed to the job. Then
   the honest handoff line: your part is done; the assistant reads it next.
