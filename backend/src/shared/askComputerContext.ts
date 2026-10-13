/**
 * What job Chat knows about Computer for one turn: the company's saved Logins
 * (labels and hosts only, never secrets) and the Computer tasks already run
 * from this job, with their results. Both feed routing and the model prompt
 * so a follow-up ("what about the second one?") reads earlier Computer results.
 */
import { computerStore } from '../computer/worker.js';
import type { AskToolContext } from './askTools.js';

export type SavedLoginHint = { label: string; host: string };

export type ComputerResultNote = {
  id: string;
  instructions: string;
  status: string;
  result: string | null;
  error: string | null;
  at: string | null;
  /** While Computer waits on the person: why, and the authenticator number when the page shows one. */
  waiting?: { reason: string; message: string; code: string | null } | null;
};

export type AskComputerContext = {
  /** Office user with Computer allowed on this turn. */
  allowed: boolean;
  logins: SavedLoginHint[];
  results: ComputerResultNote[];
};

const EMPTY: AskComputerContext = { allowed: false, logins: [], results: [] };

export async function loadAskComputerContext(ctx: AskToolContext | null | undefined): Promise<AskComputerContext> {
  if (!ctx || ctx.access !== 'org' || !ctx.userId) return EMPTY;
  const logins: Promise<SavedLoginHint[]> = ctx.savedLogins
    ? Promise.resolve(ctx.savedLogins)
    : (async () => {
        try {
          const store = computerStore();
          if (!store) return [];
          const rows = await store.listLogins(ctx.orgId);
          return rows.map((row) => ({ label: String(row.label ?? ''), host: String(row.host ?? '') }));
        } catch {
          return [];
        }
      })();
  const results: Promise<ComputerResultNote[]> = ctx.computerResults
    ? Promise.resolve(ctx.computerResults)
    : (async () => {
        try {
          if (!ctx.jobId || !ctx.supabase?.from) return [];
          const { data } = await ctx.supabase
            .from('computer_tasks')
            .select('id, instructions, status, result_summary, error, created_at, finished_at, waiting_reason:needs_you->>reason, waiting_message:needs_you->>message, waiting_code:needs_you->>code')
            .eq('org_id', ctx.orgId)
            .eq('job_id', ctx.jobId)
            .order('created_at', { ascending: false })
            .limit(5);
          return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
            id: String(row.id ?? ''),
            instructions: String(row.instructions ?? ''),
            status: String(row.status ?? ''),
            result: row.result_summary ? String(row.result_summary) : null,
            error: row.error ? String(row.error) : null,
            at: String(row.finished_at ?? row.created_at ?? '') || null,
            waiting:
              row.status === 'needs_you' && row.waiting_reason
                ? {
                    reason: String(row.waiting_reason),
                    message: String(row.waiting_message ?? ''),
                    code: row.waiting_code ? String(row.waiting_code) : null,
                  }
                : null,
          }));
        } catch {
          return [];
        }
      })();
  const [l, r] = await Promise.all([logins, results]);
  return { allowed: true, logins: l, results: r };
}

/** First line of the task instructions (the person's request), kept short. */
function requestLine(instructions: string): string {
  const task = instructions.match(/Task[^:]*:\s*([^\n]+)/i)?.[1] ?? instructions.split('\n')[0] ?? '';
  return task.trim().slice(0, 240);
}

/** Prompt block: Computer results already on this job, newest first. */
export function formatComputerResultsForPrompt(results: ComputerResultNote[]): string {
  const rows = results.filter((row) => row.result || row.error || row.status);
  if (!rows.length) return '';
  const lines = rows.slice(0, 5).map((row, index) => {
    const outcome = row.result?.trim() || (row.error ? `Error: ${row.error.trim()}` : `Status: ${row.status}`);
    const waiting = row.waiting
      ? `\n   Waiting on the person (${row.waiting.reason}): ${row.waiting.message.trim().slice(0, 300)}${
          row.waiting.code ? `\n   Authenticator number on the sign-in page: ${row.waiting.code}` : ''
        }`
      : '';
    return `${index + 1}. Request: ${requestLine(row.instructions)}\n   Status: ${row.status}${row.at ? ` (${row.at})` : ''}${waiting}\n   Result: ${outcome.slice(0, 3000)}`;
  });
  return [
    'COMPUTER RESULTS ON THIS JOB (browser tasks Computer already ran for this person, newest first; treat as facts the person has seen, and use them for follow-ups like "the second one"):',
    ...lines,
  ].join('\n');
}
