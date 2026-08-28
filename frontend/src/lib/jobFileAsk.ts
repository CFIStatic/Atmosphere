import type { JobSummary, ProofQuestion, ProofResponse, SharedJobRecord } from './api';

/** Office path for a job file you can ask. */
export function jobFilePath(jobId: string, extra?: { title?: string; number?: string | number | null }): string {
  const q = new URLSearchParams({ job: jobId });
  if (extra?.title) q.set('title', extra.title);
  if (extra?.number != null && extra.number !== '') q.set('number', String(extra.number));
  return `/jobs?${q.toString()}`;
}

export interface JobFileBeat {
  id: string;
  when: string;
  kind: 'video' | 'said' | 'note';
  title: string;
  detail: string;
}

export interface JobFileTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  groundedOn?: number;
  at: string;
}

function formatWorkDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function looksLikeHomeowner(label: string): boolean {
  return /owner|insured|resident|customer|homeowner/i.test(label);
}

/**
 * A readable file, not a dashboard: what the clips and the record already know.
 */
export function buildJobFileDossier(input: {
  proofs: ProofResponse | null;
  messages: SharedJobRecord['messages'];
}): JobFileBeat[] {
  const beats: JobFileBeat[] = [];

  for (const message of input.messages) {
    if (!message.body.trim()) continue;
    beats.push({
      id: `msg-${message.id}`,
      when: message.created_at,
      kind: looksLikeHomeowner(message.author_label) ? 'said' : 'note',
      title: looksLikeHomeowner(message.author_label)
        ? `${message.author_label} said`
        : message.author_label,
      detail: message.body.trim(),
    });
  }

  const videos = [...(input.proofs?.videos ?? [])].sort((a, b) => {
    const byDate = b.workDate.localeCompare(a.workDate);
    if (byDate !== 0) return byDate;
    return a.phase.localeCompare(b.phase);
  });

  for (const video of videos) {
    const heard = video.heardOnMic?.trim();
    const summary = video.aiSummary?.trim();
    if (!heard && !summary) continue;
    const when = formatWorkDate(video.workDate);
    if (heard) {
      beats.push({
        id: `mic-${video.id}`,
        when: video.workDate,
        kind: 'said',
        title: `Heard on the mic · ${when}`,
        detail: heard,
      });
    }
    if (summary) {
      beats.push({
        id: `clip-${video.id}`,
        when: video.workDate,
        kind: 'video',
        title: `${video.company} · ${when}`,
        detail: summary,
      });
    }
  }

  for (const day of input.proofs?.days ?? []) {
    const summary = day.aiSummary?.trim() || day.summary?.trim();
    if (!summary) continue;
    if (beats.some((beat) => beat.detail === summary)) continue;
    beats.push({
      id: `day-${day.partyId}-${day.workDate}`,
      when: day.workDate,
      kind: 'video',
      title: `${day.company} · ${formatWorkDate(day.workDate)}`,
      detail: summary,
    });
  }

  return beats.slice(0, 8);
}

export function jobFileSuggestions(input: {
  hasMic: boolean;
  hasVideo: boolean;
  latestDate: string | null;
}): string[] {
  const suggestions: string[] = [];
  if (input.hasMic) suggestions.push('What did the homeowner say?');
  suggestions.push('What happened on this job?');
  if (input.latestDate) {
    suggestions.push(`What did the crew do on ${formatWorkDate(input.latestDate)}?`);
  }
  suggestions.push(input.hasVideo ? 'Is anything still unfinished?' : 'Has anything been filmed yet?');
  if (!input.hasMic) suggestions.push('Did anyone on site mention a change?');
  return suggestions.slice(0, 4);
}

export function latestFilmedDate(proofs: ProofResponse | null): string | null {
  const dates = [
    ...(proofs?.videos ?? []).map((video) => video.workDate),
    ...(proofs?.days ?? []).map((day) => day.workDate),
  ].filter(Boolean);
  if (dates.length === 0) return null;
  return dates.sort()[dates.length - 1] ?? null;
}

export function hasMicOnFile(proofs: ProofResponse | null): boolean {
  return Boolean(
    proofs?.videos?.some((video) => Boolean(video.heardOnMic?.trim())) ||
      proofs?.videos?.some((video) => video.transcriptStatus === 'done'),
  );
}

export function hasVideoOnFile(proofs: ProofResponse | null): boolean {
  return Boolean((proofs?.videos?.length ?? 0) > 0 || (proofs?.days?.length ?? 0) > 0);
}

export function turnsFromQuestions(questions: ProofQuestion[]): JobFileTurn[] {
  return [...questions]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .flatMap((question) => {
      const turns: JobFileTurn[] = [
        {
          id: `${question.id}-q`,
          role: 'user',
          content: question.question,
          at: question.created_at,
        },
      ];
      if (question.answer) {
        turns.push({
          id: `${question.id}-a`,
          role: 'assistant',
          content: question.answer,
          groundedOn: question.grounded_on?.length,
          at: question.created_at,
        });
      }
      return turns;
    });
}

export function jobFileMatches(job: Pick<JobSummary, 'title' | 'jobNumber' | 'claimNumber'>, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    job.title.toLowerCase().includes(needle) ||
    String(job.jobNumber).includes(needle) ||
    (job.claimNumber ?? '').toLowerCase().includes(needle)
  );
}

export function siteLine(record: SharedJobRecord | null): string | null {
  const facts = record?.brief?.facts ?? {};
  return facts['Site address'] || facts['Address'] || facts['Property'] || null;
}
