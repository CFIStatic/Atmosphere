/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Homeowner-safe wording for clip and day summaries.
 *
 * The analysis pipeline writes notes for the office (and for itself): "no
 * job-site conversation", "ASR noise/hallucination artifact", the title of a
 * YouTube video playing in the background. None of that may reach a homeowner
 * or viewer. Sentences carrying analyst language are dropped; a clip whose
 * analysis says it isn't job-site footage gets a neutral line instead.
 */

export const NEUTRAL_CLIP_LINE = 'Site video recorded';

/** Phrases that mark a sentence as internal analyst language. */
const ANALYST_SENTENCE = new RegExp(
  [
    '\\bASR\\b',
    'hallucinat',
    'artifact',
    'transcri(?:pt|ption|ber)\\s+(?:noise|error|garbage)',
    '\\bnoise\\b',
    'cannot be treated as',
    'not (?:real |actual )?speech',
    'no (?:job[- ]?site |work[- ]?site |relevant |on[- ]?site )?conversation',
    'job[- ]?site conversation',
    'youtube',
    'podcast',
    'episode',
    'monitor',
    'screen recording',
    'background (?:audio|video|media|tv|television)',
    'the (?:model|analy[sz]er|pipeline|ai)\\b',
    '\\bclip contains\\b',
    '\\bthis clip\\b',
    'unclear|unable to (?:determine|verify|identify)',
    'insufficient (?:evidence|footage)',
    'low confidence',
    '\\bframes?\\b',
    'the diary of a ceo',
    'nobody narrates',
    'no narration',
    'the office\\b',
    'no intelligible',
    'no recorded',
    'speaker label',
    '\\bmedia\\b',
    'attribut',
  ].join('|'),
  'i',
);

/** Analysis that says the clip isn't job-site footage at all. */
const NON_JOB_CLIP = new RegExp(
  [
    'no job[- ]?site conversation',
    'not (?:a )?job[- ]?site',
    'not related to (?:the )?(?:job|work|construction)',
    'no (?:construction|job|work)[- ]?(?:related )?(?:activity|content|work)',
    'youtube',
    'podcast',
    'every word of audio comes from',
    'no relevant (?:content|footage|activity)',
    'no (?:renovation|trade|construction) (?:or trade )?work is shown',
  ].join('|'),
  'i',
);

/** Long runs of non-Latin script are transcription artifacts in an English summary. */
const FOREIGN_RUN = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff]{2,}/;

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAnalystSentence(sentence: string): boolean {
  return ANALYST_SENTENCE.test(sentence) || FOREIGN_RUN.test(sentence) || /["“][^"”]{0,80}["”]\s*\)/.test(sentence);
}

export function isNonJobClipText(text: string | null | undefined): boolean {
  return typeof text === 'string' && NON_JOB_CLIP.test(text);
}

/**
 * Clean a summary for a homeowner. Returns null when nothing presentable is
 * left; never returns analyst sentences.
 */
export function homeownerSafeText(text: unknown, maxLength = 600): string | null {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t) return null;
  if (isNonJobClipText(t)) return null;
  const kept = sentences(t)
    .filter((s) => !isAnalystSentence(s))
    // Upstream text is sometimes cut mid-word; never show a half sentence.
    .filter((s, i, all) => i < all.length - 1 || all.length === 1 || /[.!?"')\]]$/.test(s));
  if (!kept.length) return null;
  let out = kept.join(' ');
  if (out.length > maxLength) {
    const cut = out.slice(0, maxLength);
    const end = cut.lastIndexOf('. ');
    out = end > 40 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
  }
  return out;
}

/** Short list items (key moments, findings): drop analyst ones, keep the rest. */
export function homeownerSafeList<T>(items: unknown, textOf: (item: T) => unknown): T[] {
  if (!Array.isArray(items)) return [];
  return (items as T[]).filter((item) => {
    const raw = typeof item === 'string' ? item : textOf(item);
    return typeof raw === 'string' && homeownerSafeText(raw) !== null;
  });
}

const CONVERSATION_TEXT_KEYS = [
  'conversationExecutiveSummary',
  'executiveSummary',
  'conversationSummary',
  'summary',
];
const CONVERSATION_LIST_KEYS = [
  'conversationKeyMoments',
  'keyMoments',
  'conversationAgreementFacts',
  'agreementFacts',
  'conversationAgreements',
  'agreements',
  'conversationRefusals',
  'refusals',
  'conversationActionItems',
  'actionItems',
  'conversationCommitments',
  'commitments',
];

function itemText(item: any): unknown {
  if (!item || typeof item !== 'object') return item;
  return item.text ?? item.fact ?? item.label ?? item.summary ?? item.description;
}

/** Every analysis text on a clip, for deciding whether it is job footage at all. */
function clipAnalysisTexts(video: any): string[] {
  const conv = video?.conversation && typeof video.conversation === 'object' ? video.conversation : {};
  return [video?.aiSummary, ...CONVERSATION_TEXT_KEYS.map((k) => conv[k])].filter(
    (t): t is string => typeof t === 'string' && t.trim().length > 0,
  );
}

/** Verbatim transcript minus lines that are only transcription artifacts. */
function cleanTranscript(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const out = text
    .split('\n')
    .filter((line) => !FOREIGN_RUN.test(line))
    .join('\n')
    .trim();
  return out || null;
}

export function isNonJobClip(video: any): boolean {
  return clipAnalysisTexts(video).some((t) => isNonJobClipText(t));
}

/**
 * The homeowner version of one proof video: summaries cleaned, analyst notes
 * gone, and a non-job clip reduced to a neutral line with no narrative.
 */
export function homeownerSafeVideo<V extends Record<string, any>>(video: V): V {
  const next: any = { ...video };
  if (isNonJobClip(video)) {
    next.aiSummary = NEUTRAL_CLIP_LINE;
    next.homeownerSummary = NEUTRAL_CLIP_LINE;
    next.conversation = null;
    next.dictationEntries = [];
    next.events = [];
    next.transcriptText = null;
    next.heardOnMic = null;
    next.transcriptSegments = [];
    next.transcriptWords = [];
    next.rooms = (video.rooms ?? []).map((r: any) => ({ ...r, findings: [] }));
    return next;
  }
  const summary = homeownerSafeText(video.aiSummary);
  next.aiSummary = summary;
  next.homeownerSummary = summary ?? NEUTRAL_CLIP_LINE;
  if (video.conversation && typeof video.conversation === 'object') {
    // Allowlist: only cleaned summaries and short fact lists. Details,
    // unresolved questions, speaker notes and raw segments stay with the office.
    const src: any = video.conversation;
    const conv: any = {};
    for (const key of CONVERSATION_TEXT_KEYS) {
      if (key in src) conv[key] = homeownerSafeText(src[key]);
    }
    for (const key of CONVERSATION_LIST_KEYS) {
      if (key in src) conv[key] = homeownerSafeList(src[key], itemText);
    }
    next.conversation = conv;
  }
  next.transcriptText = cleanTranscript(video.transcriptText);
  next.heardOnMic = cleanTranscript(video.heardOnMic);
  if (Array.isArray(video.transcriptSegments)) {
    next.transcriptSegments = video.transcriptSegments.filter((seg: any) => !FOREIGN_RUN.test(String(seg?.text ?? '')));
  }
  if (Array.isArray(video.transcriptWords)) {
    next.transcriptWords = video.transcriptWords.filter((w: any) => !FOREIGN_RUN.test(String(w?.text ?? '')));
  }
  if (Array.isArray(video.events)) {
    next.events = homeownerSafeList(video.events, itemText);
  }
  if (video.people && typeof video.people === 'object') {
    const people: any = { ...video.people };
    for (const key of ['peoplePresent', 'peopleSpeakers']) {
      if (Array.isArray(people[key])) {
        people[key] = people[key].filter(
          (p: any) =>
            ![p?.label, p?.speakerLabel, p?.displayName, p?.role].some(
              (t) => typeof t === 'string' && (isAnalystSentence(t) || /youtube|\bmedia\b|\btv\b|radio/i.test(t)),
            ),
        );
      }
    }
    next.people = people;
  }
  if (Array.isArray(video.dictationEntries)) {
    next.dictationEntries = video.dictationEntries
      .map((e: any) => {
        if (!e || typeof e !== 'object') return e;
        const out: any = { ...e };
        for (const k of ['text', 'summary', 'label', 'description']) {
          if (typeof out[k] === 'string') out[k] = homeownerSafeText(out[k]);
        }
        return out;
      })
      .filter((e: any) => !e || typeof e !== 'object' || ['text', 'summary', 'label', 'description'].some((k) => typeof e[k] === 'string' && e[k]));
  }
  if (Array.isArray(video.rooms)) {
    next.rooms = video.rooms.map((r: any) => ({
      ...r,
      findings: homeownerSafeList(r?.findings, itemText),
    }));
  }
  return next;
}
