/**
 * The `ai_findings.timeline` contract is a list of reading windows:
 * `{ startSeconds, endSeconds?, summary }` (see longAnalyst). The per-clip
 * dictation path (descriptionFindings) used to write the same beats as its
 * `events`, keyed `atSeconds`. Every reader looks for `startSeconds`, so those
 * rows arrived without a time and the office player stamped the whole scene
 * description at 0:00, then listed the same beats again at their real times
 * from the narration entries.
 *
 * normalizeAnalysisTimeline is the one place a timeline row gets its time:
 * - `startSeconds`, else `atSeconds`; a row with neither is dropped (a window
 *   with no time is not a moment).
 * - a row that repeats an event / narration beat within 1.5 s is dropped,
 *   because that beat is already on the log at its own time.
 */

export type AnalysisTimelineRow = {
  startSeconds: number;
  endSeconds?: number | null;
  summary: string;
  action?: string | null;
};

type Beat = { atSeconds?: unknown; text?: unknown; summary?: unknown; note?: unknown };

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function beatKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Same words within 1.5 s, or one text opening with the other's first 24 characters. */
export function sameBeat(aAt: number, aText: string, bAt: number, bText: string): boolean {
  if (Math.abs(aAt - bAt) > 1.5) return false;
  const left = beatKey(aText);
  const right = beatKey(bText);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 24 && right.includes(left.slice(0, 24))) return true;
  if (right.length >= 24 && left.includes(right.slice(0, 24))) return true;
  return false;
}

export function normalizeAnalysisTimeline(
  timeline: unknown,
  beats?: unknown[] | null,
): AnalysisTimelineRow[] {
  if (!Array.isArray(timeline)) return [];
  const known: Array<{ at: number; text: string }> = [];
  for (const raw of beats ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const beat = raw as Beat;
    const at = num(beat.atSeconds);
    const text = [beat.text, beat.summary, beat.note].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
    if (at == null || !text) continue;
    known.push({ at, text });
  }
  const out: AnalysisTimelineRow[] = [];
  for (const raw of timeline) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const summary = typeof row.summary === 'string' ? row.summary.trim() : '';
    if (!summary) continue;
    const start = num(row.startSeconds) ?? num(row.atSeconds);
    if (start == null) continue;
    if (known.some((beat) => sameBeat(beat.at, beat.text, start, summary))) continue;
    if (out.some((prev) => sameBeat(prev.startSeconds, prev.summary, start, summary))) continue;
    const end = num(row.endSeconds);
    out.push({
      startSeconds: start,
      ...(end != null && end >= start ? { endSeconds: end } : {}),
      summary,
      ...(typeof row.action === 'string' && row.action ? { action: row.action } : {}),
    });
  }
  return out.sort((a, b) => a.startSeconds - b.startSeconds);
}

/** Every timed beat already on a clip: narration entries plus findings events. */
export function clipBeats(input: { narration?: unknown; findings?: unknown }): unknown[] {
  const narration = input.narration && typeof input.narration === 'object'
    ? (input.narration as { entries?: unknown }).entries
    : null;
  const findings = input.findings && typeof input.findings === 'object'
    ? (input.findings as { events?: unknown }).events
    : null;
  return [...(Array.isArray(narration) ? narration : []), ...(Array.isArray(findings) ? findings : [])];
}
