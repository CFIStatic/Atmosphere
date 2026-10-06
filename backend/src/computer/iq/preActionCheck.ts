/**
 * Independent check before any irreversible step (submit, send, pay, save,
 * accept, delete, sign, upload). A separate model call, with no tools and no
 * view of the agent's reasoning, compares the person's request with what is
 * on the page and the approval card. If it finds a problem, the approval card
 * is not shown and the agent is told what to fix. It fails closed: an error or
 * an unreadable answer counts as "not confirmed".
 */
import type { ComputerModel, ComputerModelResponse } from '../agent.js';
import type { ApprovalField } from '../types.js';

export interface PreActionRequest {
  instructions: string;
  buttonLabel: string;
  kind: string;
  summary: string;
  fields: ApprovalField[];
  pageOrigin: string | null;
  pageText: string;
  screenshotJpegB64: string | null;
}

export interface PreActionVerdict {
  ok: boolean;
  concerns: string[];
}

const SYSTEM = [
  'You are an independent reviewer for a browser assistant that is about to ask a person to approve an irreversible action.',
  'You did not do the work. Check only whether the action on the page matches what the person asked for.',
  'Flag: wrong site or wrong form; a field value that contradicts the request; a required field left empty; a different action than requested (for example paying when asked only to look up a price); duplicated items; an error message on the page.',
  'Do not flag style, wording or things the request does not mention.',
  'Answer with JSON only: {"ok": true|false, "concerns": ["short concern", ...]}. Use at most 3 concerns, each under 160 characters.',
].join('\n');

function clip(s: string, n: number) {
  return s.replace(/\s+/g, ' ').trim().slice(0, n);
}

export function buildPreActionPrompt(req: PreActionRequest): string {
  const fields = req.fields
    .slice(0, 40)
    .map((f) => `- ${clip(f.label, 80)}: ${clip(String(f.value ?? ''), 200)}${f.verified === false ? ' (not found on the page)' : ''}`)
    .join('\n');
  return [
    `Person's request:\n${clip(req.instructions, 3000)}`,
    `Action about to be approved: ${req.kind} via the button “${clip(req.buttonLabel, 120)}” on ${req.pageOrigin ?? 'an unknown site'}.`,
    `Assistant's summary for the approval card:\n${clip(req.summary, 1000)}`,
    fields ? `Fields on the card:\n${fields}` : 'No fields on the card.',
    `Visible page text (truncated):\n${clip(req.pageText, 4000)}`,
  ].join('\n\n');
}

export function parseVerdict(text: string): PreActionVerdict {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('verdict_unreadable');
  const raw = JSON.parse(m[0]) as { ok?: unknown; concerns?: unknown };
  if (typeof raw.ok !== 'boolean') throw new Error('verdict_unreadable');
  const concerns = Array.isArray(raw.concerns) ? raw.concerns.map((c) => clip(String(c), 160)).filter(Boolean).slice(0, 3) : [];
  return { ok: raw.ok, concerns };
}

export async function runPreActionCheck(
  model: ComputerModel,
  modelId: string,
  req: PreActionRequest,
): Promise<{ verdict: PreActionVerdict; response: ComputerModelResponse }> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: buildPreActionPrompt(req) }];
  if (req.screenshotJpegB64) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: req.screenshotJpegB64 } });
  const response = await model.create({
    model: modelId,
    system: [{ type: 'text', text: SYSTEM }],
    tools: [],
    messages: [{ role: 'user', content: content as never }],
    max_tokens: 400,
  });
  const text = (Array.isArray(response.content) ? response.content : [])
    .filter((b) => b.type === 'text')
    .map((b) => String(b.text ?? ''))
    .join('\n');
  return { verdict: parseVerdict(text), response };
}
