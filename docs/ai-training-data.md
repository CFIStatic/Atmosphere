# Training data from clip summaries

Atmosphere can fine-tune a model on its own work once enough people have
checked the AI's clip summaries. This is the capture side and the export; no
training runs anywhere yet.

## Capture

- **Videos tab → open a clip → AI summary.** Office members can thumbs up,
  thumbs down with a reason, and **Fix it** (write what it should say). Saved
  to `clip_summary_feedback` with the AI text and model copied in at rating
  time. The clip's own summary never changes.
- **Chat answers** already have thumbs up / down (`ask_answer_feedback`).
- Homeowners, subcontractors and share-link viewers do not see the buttons.

## Consent

`org_ai_training_settings.opted_in`, shown as **Settings → Organization →
Help improve Atmosphere's AI**. Off unless a Global Admin turns it on. The
Privacy Policy says what that allows. Ratings are saved either way (they are
useful as quality signals for the workspace), but only opted-in workspaces are
ever exported.

## Export

```
cd backend
npm run export:training-set                    # counts only, writes nothing
npm run export:training-set -- --out ./training
```

Writes `summaries.sft.jsonl` (chat-format fine-tuning), `summaries.preference.jsonl`
(fix beats AI text, for DPO-style tuning) and `manifest.json`. Local files only.

What it leaves out: video, audio, stills, storage paths; clips with a child or
private moment; clips with no transcript; thumbs down without a fix. Names the
job knows, claim and policy numbers, emails, phones and street addresses become
placeholders. Splits are by job (`assignSplit`), so a job never straddles train
and test.

Before a real run: get sign-off, review a sample for names the scrubber missed,
and check the model provider's terms if any example's answer is an approved AI
summary rather than a person's fix.
