/**
 * Evidence-first answer for "what was said about X" questions.
 *
 * Retrieval runs over the transcript chunk index (plus summaries) for the
 * topic the question names. The answer quotes only retrieved chunk text,
 * verbatim, each with its clip name and timestamp. When the topic is not in
 * any transcript the answer says so and quotes nothing.
 */
import type { AskLookupCatalog } from './askLookup.js';
import { formatAskClock, formatAskDate, type AskMomentQuote } from './askMoments.js';
import { UNIDENTIFIED_SPEAKER, UNIDENTIFIED_SPEAKER_PROSE, speakerLabelOrUnidentified } from './askSpeakers.js';
import {
  retrieveAskEvidence,
  spokenOrder,
  type EvidenceHit,
  type EvidenceRetrieval,
  type TranscriptChunk,
} from './askTranscriptIndex.js';

const SPEECH_TOPIC =
  /\b(?:say|said|says|saying|quote|quoted|quotes|tell|told|mention|mentioned|mentions|talk|talked|talking|discuss|discussed|comes? up|came up|brought up|bring up|timestamps?|what time|at what time|verbatim|word for word)\b/i;

/** A question about what was said on a topic, with a searchable phrase. */
export function isTopicSpeechQuestion(question: string, evidence: EvidenceRetrieval): boolean {
  if (!evidence.phrases.length) return false;
  return SPEECH_TOPIC.test(question) || evidence.asksOwner;
}

export function topicEvidence(question: string, catalog: AskLookupCatalog): EvidenceRetrieval | null {
  const evidence = retrieveAskEvidence(catalog, question);
  if (!isTopicSpeechQuestion(question, evidence)) return null;
  // "what was said in the office recording" names a clip, not a topic: the clip path answers it.
  // A phrase that is spoken in a transcript is always a topic, even if a title shares its words.
  if (
    !evidence.transcript.some((hit) => hit.pinned) &&
    CLIP_REFERENCE.test(question) &&
    evidence.phrases.every((phrase) => namesAClip(phrase, catalog))
  ) {
    return null;
  }
  return evidence;
}

const CLIP_REFERENCE = /\b(?:recording|clip|video|footage|take|film|walk-?through)\b/i;

function namesAClip(phrase: string, catalog: AskLookupCatalog): boolean {
  const words = phrase.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  if (!words.length) return false;
  return (catalog.clips ?? []).some((clip) => {
    const title = new Set(String(clip.title ?? '').toLowerCase().match(/[a-z0-9']+/g) ?? []);
    return words.every((word) => title.has(word));
  });
}

/** People on the job the question names (by name or @mention). */
function namedPeople(question: string, catalog: AskLookupCatalog): string[] {
  const q = String(question ?? '').toLowerCase();
  const out: string[] = [];
  for (const person of catalog.people ?? []) {
    const name = String(person.name ?? '').trim();
    if (name.length < 2) continue;
    const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[^a-z0-9])@?${escaped}(?=$|[^a-z0-9])`).test(q) && !out.includes(name)) out.push(name);
  }
  return out;
}

function yesNoQuestion(question: string): boolean {
  return /^\s*(?:did|does|do|was|were|is|are|has|have|had)\b/i.test(question);
}

function dayLabel(workDate: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(workDate ?? ''));
  if (!m) return '';
  return formatAskDate({ month: Number(m[2]), day: Number(m[3]), year: null });
}

function quoteText(text: string): string {
  return `“${text.trim()}”`;
}

/** "(Clip title, 0:15)": the attachment every quoted line carries. */
export function quoteAttachment(hit: Pick<EvidenceHit, 'clipTitle' | 'startSec'>): string {
  const when = hit.startSec == null ? '' : `, ${formatAskClock(hit.startSec)}`;
  return `(${hit.clipTitle}${when})`;
}

function bulletFor(hit: EvidenceHit): string {
  const label = speakerLabelOrUnidentified(hit.speaker);
  const who = label === UNIDENTIFIED_SPEAKER ? '' : `${label}: `;
  return `- ${who}${quoteText(hit.text)} ${quoteAttachment(hit)}`;
}

function topicLabel(evidence: EvidenceRetrieval, hits: EvidenceHit[]): string {
  const matched = hits.flatMap((hit) => hit.matched);
  return (matched.sort((a, b) => b.length - a.length)[0] ?? evidence.phrases[0] ?? '').trim();
}

function clockList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? '';
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

/** Grounded answer for a topic speech question. Null when the question is not one. */
export function composeTopicSpeech(question: string, catalog: AskLookupCatalog, evidence?: EvidenceRetrieval | null): string | null {
  const found = evidence ?? topicEvidence(question, catalog);
  if (!found) return null;
  const asked = found.asked;
  const dayText = asked ? ` on ${formatAskDate(asked)}` : '';
  const hits = spokenOrder(found.transcript);
  const yesNo = yesNoQuestion(question);
  const phrase = found.phrases[0]!;
  if (!hits.length) {
    const scope = asked && found.clipCount === 0
      ? `Nothing on this job was recorded${dayText}.`
      : `${yesNo ? 'No. ' : ''}Nothing in the transcripts${dayText ? ` from${dayText.replace(/^ on/, '')}` : ''} on this job mentions “${phrase}”.`;
    const other = spokenOrder(found.otherDays);
    if (other.length) {
      const first = other[0]!;
      const day = dayLabel(first.workDate);
      return `${scope} It does come up${day ? ` on ${day}` : ''}:\n\n${other.slice(0, 6).map(bulletFor).join('\n')}`;
    }
    const summary = found.summaries[0];
    if (summary) {
      return `${scope} The AI summary of ${summary.clipTitle} mentions it, but no spoken line does.`;
    }
    return scope;
  }
  const topical = hits.filter((hit) => hit.reason !== 'commitment');
  const commitments = hits.filter((hit) => hit.reason === 'commitment');
  const named = namedPeople(question, catalog).filter(
    (name) => !hits.some((hit) => speakerLabelOrUnidentified(hit.speaker).toLowerCase() === name.toLowerCase()),
  );
  const notAttributed = named.length
    ? ` The recording doesn't identify who is speaking, so ${hits.length === 1 ? 'this line' : 'these lines'} can't be attributed to ${named.join(' or ')}.`
    : '';
  if (hits.length === 1 && !found.asksOwner) {
    const only = hits[0]!;
    const onDayOnly = asked ? `On ${formatAskDate(asked)}, ` : dayLabel(only.workDate) ? `On ${dayLabel(only.workDate)}, ` : '';
    const label = speakerLabelOrUnidentified(only.speaker);
    const who = label === UNIDENTIFIED_SPEAKER ? UNIDENTIFIED_SPEAKER_PROSE : label;
    const lead = `${yesNo ? 'Yes. ' : ''}${onDayOnly}${onDayOnly ? who : who.charAt(0).toUpperCase() + who.slice(1)} said ${quoteText(only.text)} ${quoteAttachment(only)}`;
    return `${lead}${notAttributed}`;
  }
  const label = topicLabel(found, topical);
  const clips = [...new Set(topical.map((hit) => hit.clipTitle))];
  const days = [...new Set(topical.map((hit) => dayLabel(hit.workDate)).filter(Boolean))];
  const when = clockList(topical.filter((hit) => hit.startSec != null).map((hit) => formatAskClock(hit.startSec!)));
  const onDay = asked ? `On ${formatAskDate(asked)}, ` : days.length === 1 ? `On ${days[0]}, ` : '';
  const where = clips.length === 1 ? ` in ${clips[0]}` : ` in ${clips.length} clips`;
  const lead = `${yesNo ? 'Yes. ' : ''}${onDay}${onDay ? label : label.charAt(0).toUpperCase() + label.slice(1)} comes up${when ? ` at ${when}` : ''}${where}.`;
  const sentences = [lead];
  if (found.asksOwner) {
    const commit = commitments[0];
    const commitLabel = commit ? speakerLabelOrUnidentified(commit.speaker) : null;
    if (commit && commitLabel && commitLabel !== UNIDENTIFIED_SPEAKER) {
      sentences.push(`At ${formatAskClock(commit.startSec ?? 0)}, ${commitLabel} commits to it.`);
    } else if (commit) {
      sentences.push(
        `At ${formatAskClock(commit.startSec ?? 0)}, ${UNIDENTIFIED_SPEAKER_PROSE} commits to it; the recording doesn't identify who that is.`,
      );
    } else {
      sentences.push("No one on the recording commits to it, and the speakers aren't identified.");
    }
  }
  return `${sentences.join(' ')}${notAttributed}\n\n${hits.map(bulletFor).join('\n')}`;
}

/** Quote cards for a topic speech question: retrieved chunks only. Empty (not null) when nothing matched. */
export function topicQuotes(question: string, catalog: AskLookupCatalog, evidence?: EvidenceRetrieval | null): AskMomentQuote[] | null {
  const found = evidence ?? topicEvidence(question, catalog);
  if (!found) return null;
  const hits = found.transcript.length ? found.transcript : found.otherDays;
  return spokenOrder(hits)
    .slice(0, 6)
    .map((hit) => ({
      sourceId: hit.cite,
      speaker: speakerLabelOrUnidentified(hit.speaker),
      text: hit.text,
      atSeconds: hit.startSec,
      clipTitle: hit.clipTitle,
    }));
}

/** Prompt block: the exact retrieved lines the model should quote from. */
export function formatEvidenceForPrompt(evidence: EvidenceRetrieval, topicQuestion: boolean): string {
  const hits = spokenOrder(evidence.transcript.length ? evidence.transcript : evidence.otherDays);
  if (!hits.length && !topicQuestion) return '';
  const lines: string[] = ['Retrieved transcript lines for this question (exact text from the transcript chunk index):'];
  if (!hits.length) {
    const dayText = evidence.asked ? ` on ${formatAskDate(evidence.asked)}` : '';
    lines.push(`- none. Nothing in the transcripts${dayText} on this job contains “${evidence.phrases[0] ?? ''}”. Say it was not found; do not quote other lines as if they were about it.`);
  } else {
    if (!evidence.transcript.length && evidence.asked) {
      lines.push(`(Nothing on ${formatAskDate(evidence.asked)} matched; these are from other days.)`);
    }
    for (const hit of hits.slice(0, 12)) {
      const when = hit.startSec == null ? 'untimed' : formatAskClock(hit.startSec);
      const day = dayLabel(hit.workDate);
      const speaker = speakerLabelOrUnidentified(hit.speaker);
      const why = hit.reason === 'commitment' ? ' · follows the matched line' : '';
      lines.push(`- [${hit.clipTitle}${day ? ` · ${day}` : ''} · ${when} · ${speaker} · cite ${hit.cite}${why}] ${hit.text}`);
    }
  }
  const summaries = evidence.summaries.slice(0, 3);
  if (summaries.length) {
    lines.push('Clip summaries that match (AI-written, supplementary; never quote them as speech):');
    for (const doc of summaries) lines.push(`- [${doc.clipTitle}] ${doc.text.slice(0, 300)}`);
  }
  return lines.join('\n');
}

/** The retrieval as a search_transcripts trace step, so its cites and quotes are allowed downstream. */
export function evidenceTraceStep(evidence: EvidenceRetrieval, catalog: AskLookupCatalog) {
  const hits = spokenOrder(evidence.transcript.length ? evidence.transcript : evidence.otherDays).map((hit) => ({
    proofId: hit.proofId,
    jobId: hit.jobId,
    jobTitle: catalog.jobTitle ?? null,
    title: hit.clipTitle,
    workDate: hit.workDate,
    atSeconds: hit.startSec,
    speaker: speakerLabelOrUnidentified(hit.speaker),
    excerpt: hit.text,
    cite: hit.cite,
  }));
  return {
    tool: 'search_transcripts',
    input: { query: evidence.phrases[0] ?? '', index: 'transcript_chunks' } as Record<string, unknown>,
    result: {
      ok: true,
      tool: 'search_transcripts',
      summary: hits.length
        ? `Found ${hits.length} transcript moment(s) in scope.`
        : `No transcript on this ${catalog.jobId ? 'job' : 'organization'} matches that.`,
      data: { query: evidence.phrases[0] ?? '', hits },
    },
  };
}

/**
 * Chunks this Ask retrieved: ranked hits, every chunk of a clip a tool loaded,
 * chunks at a moment a tool returned, and chunks shown in the prompt context.
 */
export function retrievedChunksFor(
  evidence: EvidenceRetrieval,
  trace: Array<{ tool: string; result: { ok: boolean; data?: unknown } }>,
  shownText: string,
): TranscriptChunk[] {
  const keys = new Set<string>([...evidence.transcript, ...evidence.otherDays].map((hit) => hit.key));
  const loaded = new Set<string>();
  const moments: Array<{ proofId: string; at: number | null }> = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const rec = value as Record<string, unknown>;
    if (typeof rec.proofId === 'string') {
      const at = rec.atSeconds == null || !Number.isFinite(Number(rec.atSeconds)) ? null : Number(rec.atSeconds);
      moments.push({ proofId: rec.proofId, at });
    }
    for (const child of Object.values(rec)) if (child && typeof child === 'object') visit(child);
  };
  for (const step of trace) {
    if (!step.result.ok) continue;
    const data = step.result.data as Record<string, unknown> | undefined;
    if (step.tool === 'get_clip' && data && typeof data.proofId === 'string') loaded.add(data.proofId);
    visit(data);
  }
  const shown = shownText.toLowerCase();
  for (const chunk of evidence.chunks) {
    if (loaded.has(chunk.proofId)) keys.add(chunk.key);
    else if (moments.some((m) => m.proofId === chunk.proofId && m.at != null && chunk.startSec != null && Math.abs(m.at - chunk.startSec) < 1)) keys.add(chunk.key);
    else if (chunk.text.length > 1 && shown.includes(chunk.text.toLowerCase())) keys.add(chunk.key);
  }
  return evidence.chunks.filter((chunk) => keys.has(chunk.key));
}
