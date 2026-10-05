/**
 * Cross-company Computer learning: anonymized per-site step playbooks.
 *
 * Shared across orgs so runs get faster with scale. Hard rules — never store
 * passwords, tokens, customer/homeowner/job data, email/CRM content, estimate
 * figures, or anything typed into fields. Scrub URL path IDs and query params.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { siteOf, hostOfUrl } from './sites.js';

export type PlaybookOutcome = 'approve' | 'edit' | 'reject';

export type AnonymizedPlaybook = {
  screens: string[];
  selectors: string[];
  working_path: string[];
  known_errors: string[];
  recoveries: string[];
};

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const LONG_HEX_RE = /\b[0-9a-f]{16,}\b/gi;
const DIGIT_ID_RE = /\/\d{4,}(?=\/|$)/g;

/** Forbidden substrings / patterns that must never enter the shared table. */
export const PLAYBOOK_PII_PATTERNS: RegExp[] = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /bearer\s+[a-z0-9._-]+/i,
  /api[_-]?key/i,
  /homeowner/i,
  /\bcustomer\b/i,
  /\bclient\b/i,
  /job[_-]?id/i,
  /claim\s*#?\s*\d/i,
  /@[\w.-]+\.\w+/i, // emails
  /\$\s?\d/, // estimate / money figures
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // phone
];

export function scrubUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    u.search = '';
    u.hash = '';
    u.pathname = u.pathname
      .replace(UUID_RE, '/:id')
      .replace(LONG_HEX_RE, '/:id')
      .replace(DIGIT_ID_RE, '/:id');
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '') || u.origin;
  } catch {
    return null;
  }
}

export function scrubText(input: string): string {
  return input
    .replace(UUID_RE, '[id]')
    .replace(LONG_HEX_RE, '[id]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, '[amount]');
}

export function assertNoPii(value: unknown, path = 'playbook'): void {
  if (value == null) return;
  if (typeof value === 'string') {
    for (const re of PLAYBOOK_PII_PATTERNS) {
      if (re.test(value)) {
        throw new Error(`PII_OR_JOB_DATA_FORBIDDEN at ${path}: matched ${re}`);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoPii(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/password|token|secret|email|body|to\b|subject|amount|price|job|customer|homeowner/i.test(k)) {
        throw new Error(`PII_OR_JOB_DATA_FORBIDDEN key at ${path}.${k}`);
      }
      assertNoPii(v, `${path}.${k}`);
    }
  }
}

export function anonymizeSuccessfulRun(input: {
  startUrl?: string | null;
  currentUrl?: string | null;
  screens?: string[];
  selectors?: string[];
  workingPath?: string[];
  knownErrors?: string[];
  recoveries?: string[];
  /** Anything typed into fields — discarded. */
  typedFieldValues?: unknown;
}): { site: string; playbook: AnonymizedPlaybook } {
  void input.typedFieldValues; // never stored
  const host = hostOfUrl(input.currentUrl) || hostOfUrl(input.startUrl);
  if (!host) throw new Error('playbook_site_required');
  const site = siteOf(host);
  const playbook: AnonymizedPlaybook = {
    screens: (input.screens ?? []).map((s) => scrubText(String(s))).filter(Boolean).slice(0, 40),
    selectors: (input.selectors ?? [])
      .map((s) => String(s).trim())
      .filter((s) => s && !/password|token|secret/i.test(s))
      .slice(0, 80),
    working_path: (input.workingPath ?? [])
      .map((s) => scrubUrl(s) || scrubText(String(s)))
      .filter(Boolean)
      .slice(0, 40) as string[],
    known_errors: (input.knownErrors ?? []).map((s) => scrubText(String(s))).filter(Boolean).slice(0, 20),
    recoveries: (input.recoveries ?? []).map((s) => scrubText(String(s))).filter(Boolean).slice(0, 20),
  };
  assertNoPii(playbook);
  return { site, playbook };
}

export async function upsertSharedPlaybook(
  admin: SupabaseClient,
  input: {
    site: string;
    taskType: string;
    playbook: AnonymizedPlaybook;
    outcome: PlaybookOutcome;
  },
): Promise<{ id: string }> {
  assertNoPii(input.playbook);
  const site = input.site.trim().toLowerCase();
  const taskType = input.taskType.trim().toLowerCase() || 'general';
  const { data: existing } = await admin
    .from('computer_site_playbooks')
    .select('id, playbook, success_count, reject_count, edit_count')
    .eq('site', site)
    .eq('task_type', taskType)
    .maybeSingle();

  const merged = mergePlaybooks((existing?.playbook as AnonymizedPlaybook) || null, input.playbook);
  assertNoPii(merged);

  const patch: Record<string, unknown> = {
    playbook: merged,
    updated_at: new Date().toISOString(),
  };
  if (input.outcome === 'approve') {
    patch.success_count = (existing?.success_count ?? 0) + 1;
    patch.last_success_at = new Date().toISOString();
  } else if (input.outcome === 'reject') {
    patch.reject_count = (existing?.reject_count ?? 0) + 1;
  } else {
    patch.edit_count = (existing?.edit_count ?? 0) + 1;
  }

  if (existing?.id) {
    const { error } = await admin.from('computer_site_playbooks').update(patch).eq('id', existing.id);
    if (error) throw error;
    return { id: existing.id };
  }
  const { data, error } = await admin
    .from('computer_site_playbooks')
    .insert({
      site,
      task_type: taskType,
      ...patch,
      success_count: input.outcome === 'approve' ? 1 : 0,
      reject_count: input.outcome === 'reject' ? 1 : 0,
      edit_count: input.outcome === 'edit' ? 1 : 0,
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id as string };
}

export async function recordOrgOutcome(
  admin: SupabaseClient,
  input: {
    orgId: string;
    taskId?: string | null;
    site: string;
    taskType: string;
    outcome: PlaybookOutcome;
    playbookId?: string | null;
  },
): Promise<void> {
  const { error } = await admin.from('computer_playbook_outcomes').insert({
    org_id: input.orgId,
    task_id: input.taskId ?? null,
    site: input.site.trim().toLowerCase(),
    task_type: input.taskType.trim().toLowerCase() || 'general',
    outcome: input.outcome,
    playbook_id: input.playbookId ?? null,
  });
  if (error) throw error;
}

export async function loadSharedPlaybook(
  admin: SupabaseClient,
  site: string,
  taskType: string,
): Promise<AnonymizedPlaybook | null> {
  const { data } = await admin
    .from('computer_site_playbooks')
    .select('playbook')
    .eq('site', site.trim().toLowerCase())
    .eq('task_type', (taskType.trim().toLowerCase() || 'general'))
    .maybeSingle();
  const pb = data?.playbook as AnonymizedPlaybook | undefined;
  if (!pb) return null;
  assertNoPii(pb);
  return pb;
}

function mergePlaybooks(a: AnonymizedPlaybook | null, b: AnonymizedPlaybook): AnonymizedPlaybook {
  const uniq = (xs: string[]) => [...new Set(xs.map((s) => s.trim()).filter(Boolean))];
  return {
    screens: uniq([...(a?.screens ?? []), ...b.screens]).slice(0, 40),
    selectors: uniq([...(a?.selectors ?? []), ...b.selectors]).slice(0, 80),
    working_path: uniq([...(a?.working_path ?? []), ...b.working_path]).slice(0, 40),
    known_errors: uniq([...(a?.known_errors ?? []), ...b.known_errors]).slice(0, 20),
    recoveries: uniq([...(a?.recoveries ?? []), ...b.recoveries]).slice(0, 20),
  };
}
