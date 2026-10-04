/**
 * The structured result a Computer task ends with: what it filled in, whether
 * anything was submitted, and one plain note. The agent reports it through
 * the finish tool; it is stored as versioned JSON in computer_tasks.
 * result_summary (no schema change) and parsed back for the task card.
 * Older rows hold a plain sentence and still read as notes.
 */

export interface ComputerResultField {
  label: string;
  value: string;
}

export interface ComputerTaskResult {
  /** Two to four words, e.g. "Form filled". */
  title: string | null;
  fields: ComputerResultField[];
  /** What the agent says. The card trusts the audit (an approved click) instead. */
  submitted: boolean;
  /** One plain sentence for anything notable, or null. */
  notes: string | null;
}

const MAX_STORED = 4000;
const MAX_FIELDS = 30;

function text(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Clean what the model passed to finish into a result. */
export function resultFromFinish(input: Record<string, unknown>): ComputerTaskResult {
  const rawFields = Array.isArray(input.fields) ? input.fields : [];
  const fields: ComputerResultField[] = [];
  for (const f of rawFields) {
    if (!f || typeof f !== 'object') continue;
    const label = text((f as Record<string, unknown>).label, 80).replace(/\s*[:：*]+$/, '');
    const value = text((f as Record<string, unknown>).value, 200);
    if (!label) continue;
    fields.push({ label, value });
    if (fields.length >= MAX_FIELDS) break;
  }
  const title = text(input.title, 60).replace(/[.!]+$/, '') || null;
  // A model that still sends the old one-paragraph summary: keep it as the note.
  const notes = text(input.notes, 300) || text(input.summary, 300) || null;
  return { title, fields, submitted: input.submitted === true, notes };
}

/** JSON for result_summary, trimmed to fit its 4000-character limit. */
export function encodeTaskResult(result: ComputerTaskResult): string {
  const fields = [...result.fields];
  let out = JSON.stringify({ v: 1, ...result, fields });
  while (out.length > MAX_STORED && fields.length) {
    fields.pop();
    out = JSON.stringify({ v: 1, ...result, fields });
  }
  return out.length > MAX_STORED ? JSON.stringify({ v: 1, ...result, fields: [], notes: null }) : out;
}

/** The structured result in result_summary, or null for a plain-text summary. */
export function parseTaskResult(stored: string | null | undefined): ComputerTaskResult | null {
  const raw = String(stored ?? '');
  if (!raw.startsWith('{"v":1')) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return resultFromFinish(parsed);
  } catch {
    return null;
  }
}
