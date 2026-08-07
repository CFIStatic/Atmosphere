import { anthropicClient } from '../lib/anthropic.js';
import { config } from '../config.js';

/**
 * Reading a scope of work out of a document.
 *
 * The customer uploads what they actually have — a signed work order, a
 * carrier estimate PDF, a typed-up agreement — and the model reads it into
 * the structured lines the footage will be judged against: what is to be
 * done, what must not be touched, with reasons and amounts where the
 * document states them.
 *
 * The one rule that matters: the extraction is a PROPOSAL. The model's
 * reading of a contract is not the contract, so nothing here writes a scope
 * line. The proposal is stored on the document row, a person edits and
 * confirms it, and only the confirm step creates job_scope_items — each
 * stamped with the document id, so "where did this line come from" is
 * always answerable.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ProposedScopeLine {
  title: string;
  state: 'included' | 'excluded';
  reason: string | null;
  amount: number | null;
  /** The model's own note — a page reference, an ambiguity, a hedge. */
  note: string | null;
}

export interface ScopeExtraction {
  lines: ProposedScopeLine[];
  /** Parts of the document the model could not read into lines. Owed, not hidden. */
  couldNotRead: string[];
  model: string;
}

export function scopeExtractionPrompt(): string {
  return [
    'You are reading a construction scope-of-work document. Extract the work lines a video of the job site could later be checked against.',
    '',
    'Return STRICT JSON only, no prose around it:',
    '{',
    '  "lines": [{"title": "...", "state": "included"|"excluded", "reason": "..."|null, "amount": 123.45|null, "note": "..."|null}],',
    '  "couldNotRead": ["..."]',
    '}',
    '',
    'Rules:',
    '1. A line\'s title is the WORK, stated as a doable thing ("Strip north slope to decking"), 2-200 characters. Not a heading, not a price row with no work in it.',
    '2. "excluded" is for work the document says must NOT be done or is explicitly out of scope. Carry the document\'s reason when it gives one — exclusions without reasons get violated by helpful people.',
    '3. "amount" only when the document states a price for that specific line. Never total unrelated numbers into a line.',
    '4. Extract only what the document actually says. If a section is illegible, ambiguous, or refers to an attachment you cannot see, put that in couldNotRead — do not guess a line into existence.',
    '5. 40 lines maximum. A document with more detail than that gets its major lines, and a couldNotRead entry saying detail was condensed.',
    '6. Use "note" for anything a person confirming this line should know: a page reference, a condition ("only if carrier approves"), a hedge.',
  ].join('\n');
}

/** Parse and sanitize the model's reply. Invalid lines are dropped, not repaired. */
export function parseScopeExtraction(raw: string, model: string): ScopeExtraction | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.lines)) return null;

  const lines: ProposedScopeLine[] = [];
  for (const line of parsed.lines.slice(0, 40)) {
    const title = typeof line?.title === 'string' ? line.title.trim() : '';
    if (title.length < 2 || title.length > 200) continue;
    const state = line.state === 'excluded' ? 'excluded' : line.state === 'included' ? 'included' : null;
    if (!state) continue;
    const amount =
      typeof line.amount === 'number' && Number.isFinite(line.amount) && line.amount >= 0
        ? Math.round(line.amount * 100) / 100
        : null;
    lines.push({
      title,
      state,
      reason: typeof line.reason === 'string' && line.reason.trim() ? line.reason.trim().slice(0, 1000) : null,
      amount,
      note: typeof line.note === 'string' && line.note.trim() ? line.note.trim().slice(0, 500) : null,
    });
  }
  if (!lines.length) return null;

  const couldNotRead = Array.isArray(parsed.couldNotRead)
    ? parsed.couldNotRead
        .filter((s: unknown) => typeof s === 'string' && (s as string).trim())
        .map((s: string) => s.trim().slice(0, 300))
        .slice(0, 12)
    : [];

  return { lines, couldNotRead, model };
}

/**
 * Run the extraction. PDFs go to the model as a native document block — no
 * text-extraction dependency to drift from what the model actually reads;
 * plain text goes as text.
 */
export async function extractScopeFromDocument(input: {
  mediaType: 'application/pdf' | 'text/plain';
  base64: string;
}): Promise<ScopeExtraction | null> {
  const content: any[] =
    input.mediaType === 'application/pdf'
      ? [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: input.base64 },
          },
          { type: 'text', text: 'Extract the scope lines from this document.' },
        ]
      : [
          {
            type: 'text',
            text:
              'Extract the scope lines from this document:\n\n' +
              Buffer.from(input.base64, 'base64').toString('utf8').slice(0, 60_000),
          },
        ];

  const response = await anthropicClient().messages.create({
    model: config.technician.assistant.model,
    max_tokens: 3000,
    system: scopeExtractionPrompt(),
    messages: [{ role: 'user', content }],
  });

  const text = response.content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('\n');
  return parseScopeExtraction(text, response.model);
}
