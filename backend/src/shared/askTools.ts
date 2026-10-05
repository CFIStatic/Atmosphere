/**
 * Atmosphere Ask tools — small v1 set backed by real job-file APIs.
 *
 * Read tools run immediately. Destructive / outbound actions either draft
 * only or return needs_confirmation (never silent revoke/email/delete).
 */

import { ComputerServiceError, startComputerTask } from '../computer/service.js';
import { computerStore } from '../computer/worker.js';
import { looksLikeComputerTask, planComputerTask } from './askComputerCommand.js';
import { sendSms } from './smsProvider.js';
import { presentJobAccessRoster, type JobAccessPerson } from './jobAccessRoster.js';
import type { PunchListItem } from './jobPunchList.js';
import { buildJobProofPayload } from '../routes/proofOfWork.js';
import {
  askWebSearchBlockedReason,
  includeDomainsForAsk,
  isAskWebSearchConfigured,
  looksLikeExplicitWebSearchRequest,
  plainWebModelText,
  searchAskWebDetailed,
  shouldSupplementWithWebSearch,
  webSearchModelPayload,
  type AskWebHit,
} from './askWebSearch.js';
import type { JobFileAskContext } from './jobFileAsk.js';
import { requireAdmin, unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import {
  getAskCrmRecord,
  searchAskCrm,
  summarizeAskCrmRecord,
  crmUpdateSoftFail,
  listAskCrmConnections,
} from './askCrm.js';
import { runCrmAgentJob } from '../crm/agent/index.js';

export type AskAccessRole = 'org' | 'viewer';

export type AskToolContext = {
  orgId: string;
  jobId: string;
  supabase: any;
  access: AskAccessRole;
  file: JobFileAskContext;
  fetchFn?: typeof fetch;
  jobTitle?: string | null;
  /** Session user — required for writes (notes author). */
  userId?: string | null;
  authorLabel?: string | null;
  /** Site property id when the job has one (address updates). */
  propertyId?: string | null;
  /** Formatted site address already loaded for this turn. */
  address?: string | null;
};

export type AskToolResult = {
  ok: boolean;
  tool: string;
  summary: string;
  data?: unknown;
  /** UI navigation hints (section / clip seek / path). */
  ui?: {
    section?: 'access' | 'scope' | 'videos' | 'evidence' | 'parties' | 'setup' | 'brief' | 'computer' | 'logins';
    path?: string;
    workDate?: string;
    seekSeconds?: number;
    proofId?: string;
  };
  needsConfirmation?: {
    action: string;
    detail: string;
  };
  webHits?: AskWebHit[];
};

export type AskToolName =
  | 'web_search'
  | 'get_job_status'
  | 'get_job_fields'
  | 'update_job_fields'
  | 'get_crm_record'
  | 'search_crm'
  | 'list_who_has_access'
  | 'get_punch_list'
  | 'find_evidence_moments'
  | 'draft_progress_share_copy'
  | 'draft_field_invite_copy'
  | 'propose_revoke_access'
  | 'start_computer_task'
  | 'send_job_sms';

type ToolDef = {
  name: AskToolName;
  description: string;
  /** org = office only; both = office + homeowner/share */
  audience: 'org' | 'both';
  input_schema: Record<string, unknown>;
};

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

export const ASK_TOOL_DEFINITIONS: ToolDef[] = [
  {
    name: 'web_search',
    description:
      'Search the public web for anything this job file cannot answer (any topic: schedules, prices, product availability, current events, codes, or other public facts). Do not use it to replace job evidence about this job, its videos, people, findings, or records. If the user asks you to search or look something up, call this. Include the resolved calendar date in the query when they say Thursday, this Sunday, today, or tomorrow. Optional include_domains limits results to those sites, for example homedepot.com or lowes.com.',
    audience: 'both',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Public-web search query. Include a calendar date for relative days. No lockbox codes or street addresses.',
        },
        include_domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional hostnames to limit results, such as homedepot.com or lowes.com.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_job_status',
    description: 'Look up this job’s title, status, claim/policy numbers, and schedule from the job file.',
    audience: 'both',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_job_fields',
    description:
      'Read Atmosphere-native job fields: title, claim number, site address, and recent notes. Prefer this when the user asks what is on file for claim # / address / title / notes.',
    audience: 'both',
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: { type: 'string', enum: ['title', 'claimNumber', 'address', 'notes'] },
          description: 'Which fields to return. Omit for all.',
        },
      },
    },
  },
  {
    name: 'update_job_fields',
    description:
      'Update Atmosphere-native job fields on this job file (title, claim number, site address, or append a note). Office only. Does not email anyone. Does not write to external CRMs.',
    audience: 'org',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'New job title.' },
        claimNumber: { type: 'string', description: 'Claim / claim number to store on the job.' },
        address: { type: 'string', description: 'Site street address (updates the linked property).' },
        note: { type: 'string', description: 'Note body to append on the job file (not email).' },
      },
    },
  },
  {
    name: 'get_crm_record',
    description:
      'Pull claim, contact, and job fields from the connected CRM (JobNimbus, AccuLynx, Salesforce, ServiceTitan) plus Atmosphere-native fields for this job. Soft-fails with Atmosphere fields only when no external CRM is connected. Cite CRM as a source when used.',
    audience: 'both',
    input_schema: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          description: 'Optional focus: claim | contact | job | all (default all).',
        },
      },
    },
  },
  {
    name: 'search_crm',
    description:
      'Search connected CRM / Atmosphere records for a claim, contact, or job by name, email, phone, or claim number. Soft-fails to Atmosphere-native search when no external CRM is connected.',
    audience: 'org',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text (claim #, person name, email, phone, job title).' },
        limit: { type: 'number', description: 'Max hits (default 8).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_who_has_access',
    description: 'List who can open this job (homeowners, Field Capture invites). Office only.',
    audience: 'org',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_punch_list',
    description: 'Build the open punch / next-steps list from video analysis already on file.',
    audience: 'both',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max items (default 8).' },
      },
    },
  },
  {
    name: 'find_evidence_moments',
    description:
      'Find clip moments / transcript hits for a topic so the UI can jump to video timestamps.',
    audience: 'both',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'What to find in videos/mic (e.g. skylights, tarp).' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'draft_progress_share_copy',
    description:
      'Draft a progress-share message for a homeowner. Does NOT send email — returns copy only.',
    audience: 'org',
    input_schema: {
      type: 'object',
      properties: {
        recipientName: { type: 'string' },
        tone: { type: 'string', description: 'short | warm' },
      },
    },
  },
  {
    name: 'draft_field_invite_copy',
    description:
      'Draft a Field Capture invite message for a crew/sub. Does NOT send email — returns copy only.',
    audience: 'org',
    input_schema: {
      type: 'object',
      properties: {
        company: { type: 'string' },
        trade: { type: 'string' },
      },
    },
  },
  {
    name: 'propose_revoke_access',
    description:
      'Propose revoking someone’s job access. Does NOT revoke — returns a confirmation request for the user.',
    audience: 'org',
    input_schema: {
      type: 'object',
      properties: {
        personLabel: { type: 'string', description: 'Name or email of the person to revoke.' },
      },
      required: ['personLabel'],
    },
  },
  {
    name: 'start_computer_task',
    description:
      'Office only. Open a browser and DO work on a website for this job when the person used an action verb: ' +
      'email/send/message someone (including "the homeowner"), fill/update/change/add/submit on a named site, ' +
      '"use Outlook/Gmail/Xactimate", check outstanding paperwork in AccuLynx / JobNimbus / Salesforce / ServiceTitan, or build the estimate inside Xactimate Online for this job (sketch provider first), or message the adjuster via XactAnalysis / email / text for a status update. ' +
      'Prefer this over draft_* tools whenever they want something sent or changed on a live site. ' +
      'draft_progress_share_copy / draft_field_invite_copy stay for drafting copy without sending. ' +
      'Pulls people and identifiers from the job file first (homeowner email, claim #, address, insured name). ' +
      'Uses a saved Login when one matches; the server types passwords (the AI never sees them). ' +
      'Stops for sign-in / 2FA / number-matching / captcha, looks up how-to steps on the public web when stuck, ' +
      'asks the person a clear question when still unclear, and never submits, sends, pays, deletes, signs, ' +
      'accepts terms, or uploads without the person approving that click.',
    audience: 'org',
    input_schema: {
      type: 'object',
      properties: {
        instructions: { type: 'string', description: 'What to do on the website, in the person’s words.' },
        start_url: { type: 'string', description: 'Website to open first, if the person named one.' },
      },
      required: ['instructions'],
    },
  },
  {
    name: 'send_job_sms',
    description:
      'Office only. Send a text about this job via Twilio AFTER the person clearly approved the exact draft in Chat. ' +
      'Pass confirm=true only when they approved that exact body. Never send without confirm=true. ' +
      'Use after a text-the-adjuster draft that asked for approval.',
    audience: 'org',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Phone number to text (E.164 or US 10-digit).' },
        body: { type: 'string', description: 'Exact approved message body.' },
        confirm: {
          type: 'boolean',
          description: 'True only after the person approved sending this exact text.',
        },
      },
      required: ['to', 'body', 'confirm'],
    },
  },
];

export { looksLikeComputerTask } from './askComputerCommand.js';


export function askToolsForAccess(access: AskAccessRole): ToolDef[] {
  return ASK_TOOL_DEFINITIONS.filter((t) => {
    if (t.name === 'web_search' && !isAskWebSearchConfigured()) return false;
    return t.audience === 'both' || access === 'org';
  });
}

export function anthropicToolsForAccess(access: AskAccessRole) {
  return askToolsForAccess(access).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

/** Heuristic tool picks when the model cannot call tools (Gemini path). */
export function pickAskToolsHeuristically(question: string, access: AskAccessRole): AskToolName[] {
  const q = trim(question).toLowerCase();
  const picks: AskToolName[] = [];
  const allow = new Set(askToolsForAccess(access).map((t) => t.name));

  const add = (name: AskToolName) => {
    if (allow.has(name) && !picks.includes(name)) picks.push(name);
  };

  if (/who has access|who can (see|open)|access roster|who('?s| is) invited/.test(q)) {
    add('list_who_has_access');
  }
  if (/punch|next steps?|open items?|to-?do|action items?/.test(q)) {
    add('get_punch_list');
  }
  if (/status|where are we|job number|scheduled/.test(q) && !/access|punch|claim/.test(q)) {
    add('get_job_status');
  }
  if (
    /\b(claim\s*(#|number|num)?|policy\s*(#|number)?|site address|job title|what('?s| is) (the )?(title|claim|address)|notes? on (the )?file)\b/.test(
      q,
    )
  ) {
    add('get_job_fields');
  }
  if (
    /\b(set|update|change|rename|add|save|put|write)\b/.test(q) &&
    /\b(title|claim|address|note|notes)\b/.test(q)
  ) {
    add('update_job_fields');
  }
  if (/show me|jump to|find (the )?(clip|moment|video)|when did|timestamp|seek/.test(q)) {
    add('find_evidence_moments');
  }
  if (/draft.*(progress|share|homeowner)|progress share (message|email|copy)/.test(q)) {
    add('draft_progress_share_copy');
  }
  if (/draft.*(invite|field capture)|invite (message|email|copy)/.test(q)) {
    add('draft_field_invite_copy');
  }
  if (/revoke|remove access|cut off access/.test(q)) {
    add('propose_revoke_access');
  }
  // Approve / send a drafted adjuster text (Twilio) — only after an explicit approve.
  if (
    allow.has('send_job_sms') &&
    /\b(approve|send|yes)\b/.test(q) &&
    /\b(text|sms|message)\b/.test(q) &&
    !looksLikeComputerTask(question)
  ) {
    return ['send_job_sms'];
  }
  // A browser task is the whole turn: no other tool runs beside it.
  if (allow.has('start_computer_task') && looksLikeComputerTask(question)) {
    return ['start_computer_task'];
  }
  if (
    /\b(crm|jobnimbus|acculynx|salesforce|servicetitan|in (the )?crm|from (the )?crm)\b/.test(q) ||
    /\b(claim|contact|insured|homeowner)\b/.test(q) && /\b(crm|jobnimbus|acculynx|salesforce|servicetitan)\b/.test(q)
  ) {
    add('get_crm_record');
  }
  if (
    /\b(search|find|look up|lookup)\b/.test(q) &&
    /\b(crm|jobnimbus|acculynx|salesforce|servicetitan|contact|claim)\b/.test(q)
  ) {
    add('search_crm');
  }
  // Explicit search always runs. Other non-job questions run too (no topic list).
  // Job evidence questions are not pre-searched; the model may still call the tool.
  if (shouldSupplementWithWebSearch(question, '')) {
    add('web_search');
  }

  // Explicit search requests keep web_search even when other tools fill the cap.
  if (
    looksLikeExplicitWebSearchRequest(question) &&
    picks.includes('web_search')
  ) {
    const rest = picks.filter((name) => name !== 'web_search');
    return (['web_search', ...rest] as AskToolName[]).slice(0, 3);
  }

  return picks.slice(0, 3);
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

async function loadAccessRoster(ctx: AskToolContext): Promise<JobAccessPerson[]> {
  const admin = unscopedAdminOrNull() ?? requireAdmin();
  const [sharesRes, partiesRes, grantsRes] = await Promise.all([
    ctx.supabase
      .from('verifier_shares')
      .select(
        'id, label, recipient_email, created_by, created_at, expires_at, revoked_at, last_opened_at, open_count, share_kind',
      )
      .eq('org_id', ctx.orgId)
      .eq('job_id', ctx.jobId)
      .eq('share_kind', 'progress')
      .order('created_at', { ascending: false }),
    ctx.supabase
      .from('job_parties')
      .select(
        'id, company, trade, contact_name, email, role, service_role, service_role_custom, created_by, created_at, invited_at, last_seen_at, revoked_at',
      )
      .eq('org_id', ctx.orgId)
      .eq('job_id', ctx.jobId)
      .order('created_at', { ascending: true }),
    admin
      .from('job_progress_grants')
      .select('id, user_id, share_id, recipient_email, created_at, last_accessed_at, service_role')
      .eq('org_id', ctx.orgId)
      .eq('job_id', ctx.jobId),
  ]);

  let grants = (grantsRes.data ?? []) as any[];
  if (grantsRes.error) grants = [];

  const profileIds = new Set<string>();
  for (const row of (sharesRes.data ?? []) as any[]) {
    if (row.created_by) profileIds.add(row.created_by);
  }
  for (const row of (partiesRes.data ?? []) as any[]) {
    if (row.created_by) profileIds.add(row.created_by);
  }
  for (const row of grants) {
    if (row.user_id) profileIds.add(row.user_id);
  }

  let profiles: any[] = [];
  if (profileIds.size) {
    const { data } = await admin
      .from('profiles')
      .select('id, full_name, email, service_role, service_role_custom')
      .in('id', [...profileIds]);
    profiles = (data ?? []) as any[];
  }

  return presentJobAccessRoster({
    shares: (sharesRes.data ?? []) as any[],
    parties: (partiesRes.data ?? []) as any[],
    grants,
    profiles,
  });
}

const ASK_MUTATING_TOOLS = new Set<AskToolName>(['update_job_fields', 'propose_revoke_access', 'start_computer_task', 'send_job_sms']);

/** Writes run first, one at a time. Reads in one turn run together. */
export function partitionAskTools(names: AskToolName[]): { sequential: AskToolName[]; parallel: AskToolName[] } {
  const sequential: AskToolName[] = [];
  const parallel: AskToolName[] = [];
  for (const name of names) {
    if (ASK_MUTATING_TOOLS.has(name)) sequential.push(name);
    else parallel.push(name);
  }
  return { sequential, parallel };
}

export async function executeAskTool(
  name: string,
  rawInput: Record<string, unknown> | undefined,
  ctx: AskToolContext,
): Promise<AskToolResult> {
  const input = rawInput ?? {};
  const allowed = new Set(askToolsForAccess(ctx.access).map((t) => t.name));
  if (!allowed.has(name as AskToolName)) {
    return {
      ok: false,
      tool: name,
      summary: 'That action is only available to office users on this job.',
    };
  }

  try {
    switch (name as AskToolName) {
      case 'web_search': {
        if (!isAskWebSearchConfigured()) {
          return { ok: false, tool: name, summary: 'Web search is not configured.' };
        }
        const query = trim(input.query) || trim(input.q);
        if (!query) {
          return { ok: false, tool: name, summary: 'Missing search query.' };
        }
        const blocked = askWebSearchBlockedReason(query);
        if (blocked) {
          return {
            ok: false,
            tool: name,
            summary: `Web search refused (${blocked}): Ask will not reverse-image-search or identify children / private job-site people.`,
          };
        }
        const domains = includeDomainsForAsk(query, input.include_domains ?? input.includeDomains);
        const outcome = await searchAskWebDetailed(query, {
          fetchFn: ctx.fetchFn,
          limit: 5,
          includeDomains: domains,
        });
        const hits = outcome.hits;
        if (!hits.length && !outcome.answer) {
          return {
            ok: true,
            tool: name,
            summary: 'No web results were found. Do not invent web findings; answer from the job file when it applies.',
            webHits: [],
          };
        }
        return {
          ok: true,
          tool: name,
          summary: outcome.answer
            ? `Web search answer: ${plainWebModelText(outcome.answer)}`
            : `Found ${hits.length} web result(s). Job evidence still wins for this job.`,
          data: {
            answer: outcome.answer,
            results: hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet })),
          },
          webHits: hits,
        };
      }

      case 'get_job_status': {
        const job = ctx.file.job;
        const data = {
          title: job?.title ?? null,
          jobNumber: job?.jobNumber ?? null,
          status: job?.status ?? null,
          claimNumber: job?.claimNumber ?? null,
          policyNumber: job?.policyNumber ?? null,
          workType: job?.workType ?? null,
          lossType: job?.lossType ?? null,
          scheduledStart: job?.scheduledStart ?? null,
          scheduledEnd: job?.scheduledEnd ?? null,
          address: ctx.address ?? null,
        };
        return {
          ok: true,
          tool: name,
          summary: `Job status: ${data.status || 'unknown'}${data.title ? ` — ${data.title}` : ''}.`,
          data,
          ui: { section: 'setup' },
        };
      }

      case 'get_job_fields': {
        const wanted = Array.isArray(input.fields)
          ? (input.fields as unknown[]).map((f) => trim(f))
          : ['title', 'claimNumber', 'address', 'notes'];
        const want = new Set(wanted.length ? wanted : ['title', 'claimNumber', 'address', 'notes']);
        const job = ctx.file.job;
        const notes = (ctx.file.messages ?? [])
          .map((m) => ({
            author: trim(m.author) || null,
            body: trim(m.body),
          }))
          .filter((m) => m.body)
          .slice(0, 8);
        const data: Record<string, unknown> = {};
        if (want.has('title')) data.title = job?.title ?? null;
        if (want.has('claimNumber')) data.claimNumber = job?.claimNumber ?? null;
        if (want.has('address')) data.address = ctx.address ?? null;
        if (want.has('notes')) data.notes = notes;
        const bits: string[] = [];
        if (want.has('title')) bits.push(`title=${data.title ? String(data.title) : '(empty)'}`);
        if (want.has('claimNumber'))
          bits.push(`claim=${data.claimNumber ? String(data.claimNumber) : '(empty)'}`);
        if (want.has('address')) bits.push(`address=${data.address ? String(data.address) : '(empty)'}`);
        if (want.has('notes')) bits.push(`notes=${notes.length}`);
        return {
          ok: true,
          tool: name,
          summary: `Job fields on file: ${bits.join(', ')}.`,
          data,
          ui: { section: 'setup' },
        };
      }

      case 'update_job_fields': {
        if (ctx.access !== 'org') {
          return {
            ok: false,
            tool: name,
            summary: 'Only office users can update job fields.',
          };
        }
        const title = trim(input.title);
        const claimNumber = trim(input.claimNumber);
        const address = trim(input.address);
        const note = trim(input.note);
        if (!title && !claimNumber && !address && !note) {
          return {
            ok: false,
            tool: name,
            summary: 'Nothing to update — provide title, claimNumber, address, and/or note.',
          };
        }

        const changed: string[] = [];
        const data: Record<string, unknown> = {};

        if (title || claimNumber) {
          const patch: Record<string, string> = {};
          if (title) patch.title = title.slice(0, 200);
          if (claimNumber) patch.claim_number = claimNumber.slice(0, 80);
          const { data: row, error } = await ctx.supabase
            .from('crm_jobs')
            .update(patch)
            .eq('org_id', ctx.orgId)
            .eq('id', ctx.jobId)
            .select('id, title, claim_number')
            .maybeSingle();
          if (error) {
            return { ok: false, tool: name, summary: `Could not update job: ${String(error.message || error).slice(0, 160)}` };
          }
          if (!row) {
            return { ok: false, tool: name, summary: 'Job not found for update.' };
          }
          if (title) {
            changed.push('title');
            data.title = (row as any).title;
            if (ctx.file.job) ctx.file.job.title = (row as any).title;
          }
          if (claimNumber) {
            changed.push('claimNumber');
            data.claimNumber = (row as any).claim_number;
            if (ctx.file.job) ctx.file.job.claimNumber = (row as any).claim_number;
          }
        }

        if (address) {
          let propertyId = ctx.propertyId ?? null;
          if (!propertyId) {
            const { data: jobRow } = await ctx.supabase
              .from('crm_jobs')
              .select('property_id')
              .eq('org_id', ctx.orgId)
              .eq('id', ctx.jobId)
              .maybeSingle();
            propertyId = (jobRow as any)?.property_id ?? null;
          }
          if (!propertyId) {
            return {
              ok: false,
              tool: name,
              summary: 'This job has no linked property yet — set the site address from Start a job / job setup first.',
              ui: { section: 'setup' },
            };
          }
          const line = address.slice(0, 200);
          const { error } = await ctx.supabase
            .from('crm_properties')
            .update({ address_line1: line })
            .eq('org_id', ctx.orgId)
            .eq('id', propertyId);
          if (error) {
            return {
              ok: false,
              tool: name,
              summary: `Could not update address: ${String(error.message || error).slice(0, 160)}`,
            };
          }
          changed.push('address');
          data.address = line;
          ctx.address = line;
          ctx.propertyId = propertyId;
        }

        if (note) {
          if (!ctx.userId) {
            return {
              ok: false,
              tool: name,
              summary: 'Sign in as an office user to add a note.',
            };
          }
          const body = note.slice(0, 4000);
          const { data: msg, error } = await ctx.supabase
            .from('job_messages')
            .insert({
              org_id: ctx.orgId,
              job_id: ctx.jobId,
              author_id: ctx.userId,
              author_label: trim(ctx.authorLabel) || 'Office',
              body,
              is_decision: false,
            })
            .select('id, author_label, body, created_at')
            .single();
          if (error) {
            return {
              ok: false,
              tool: name,
              summary: `Could not add note: ${String(error.message || error).slice(0, 160)}`,
            };
          }
          changed.push('note');
          data.note = { id: (msg as any).id, body: (msg as any).body, author: (msg as any).author_label };
          const messages = ctx.file.messages ?? [];
          messages.unshift({ author: (msg as any).author_label, body: (msg as any).body });
          ctx.file.messages = messages;
        }

        const connections = await listAskCrmConnections(ctx.supabase, ctx.orgId);
        const crmHint = crmUpdateSoftFail(connections);
        return {
          ok: true,
          tool: name,
          summary: `Updated ${changed.join(', ')} on this Atmosphere job file. ${crmHint}`,
          data: { changed, ...data, crmHint },
          ui: { section: note && !title && !claimNumber && !address ? 'brief' : 'setup' },
        };
      }


      case 'get_crm_record': {
        const record = await getAskCrmRecord({
          supabase: ctx.supabase,
          orgId: ctx.orgId,
          jobId: ctx.jobId,
          addressHint: ctx.address ?? null,
        });
        const focus = trim(input.focus).toLowerCase();
        let data: Record<string, unknown> = { ...record };
        if (focus === 'claim') {
          data = {
            claimNumber: record.claimNumber,
            policyNumber: record.policyNumber,
            softFail: record.softFail,
            connectedProviders: record.connectedProviders,
          };
        } else if (focus === 'contact') {
          data = {
            contact: record.contact,
            softFail: record.softFail,
            connectedProviders: record.connectedProviders,
          };
        } else if (focus === 'job') {
          data = {
            title: record.title,
            status: record.status,
            jobNumber: record.jobNumber,
            address: record.address,
            softFail: record.softFail,
            connectedProviders: record.connectedProviders,
          };
        }
        return {
          ok: true,
          tool: name,
          summary: summarizeAskCrmRecord(record),
          data,
          ui: { section: 'setup', path: '/crm' },
        };
      }

      case 'search_crm': {
        const query = trim(input.query) || trim(input.q);
        if (!query) {
          return { ok: false, tool: name, summary: 'Missing CRM search query.' };
        }
        const limit = Number(input.limit);
        const result = await searchAskCrm({
          supabase: ctx.supabase,
          orgId: ctx.orgId,
          query,
          limit: Number.isFinite(limit) ? limit : 8,
        });
        // When JobNimbus credentials are on file, try a live/API search via the agent runner.
        const admin = unscopedAdminOrNull();
        const jnConnected = result.connectedProviders.some(
          (c) => c.provider === 'jobnimbus' && c.connected,
        );
        if (admin && jnConnected) {
          try {
            const agent = await runCrmAgentJob(admin, {
              orgId: ctx.orgId,
              system: 'jobnimbus',
              kind: 'search',
              query,
            });
            if (Array.isArray(agent.hits) && agent.hits.length) {
              for (const hit of agent.hits as Array<Record<string, unknown>>) {
                result.hits.push({
                  kind: 'external',
                  provider: 'jobnimbus',
                  label: 'JobNimbus',
                  id: String(hit.externalId ?? hit.id ?? ''),
                  title: String(hit.title ?? 'JobNimbus record'),
                  claimNumber: (hit.claimNumber as string | null) ?? null,
                });
              }
              result.softFail = null;
            } else if (agent.summary && !result.hits.length) {
              result.softFail = agent.summary;
            }
          } catch {
            /* soft-fail — keep Atmosphere results */
          }
        }
        const summary = result.hits.length
          ? `Found ${result.hits.length} CRM hit(s) for “${query.slice(0, 60)}”.${result.softFail ? ' ' + result.softFail : ''}`
          : `No CRM hits for “${query.slice(0, 60)}”.${result.softFail ? ' ' + result.softFail : ''}`;
        return {
          ok: true,
          tool: name,
          summary,
          data: result,
          ui: { section: 'setup', path: '/crm' },
        };
      }

      case 'list_who_has_access': {
        const people = await loadAccessRoster(ctx);
        const live = people.filter((p) => p.state === 'live' || p.state === 'claimed');
        return {
          ok: true,
          tool: name,
          summary: live.length
            ? `Listed ${live.length} people with access.`
            : 'No live access rows on this job yet.',
          data: live.map((p) => ({
            name: p.displayName || p.name,
            email: p.email,
            kind: p.kind,
            accessType: p.accessType,
            state: p.state,
            lastAccessedAt: p.lastAccessedAt,
          })),
          ui: { section: 'access' },
        };
      }

      case 'get_punch_list': {
        const limit = Math.min(Math.max(Number(input.limit) || 8, 1), 20);
        const payload = await buildJobProofPayload(ctx.supabase, ctx.orgId, ctx.jobId);
        const items = ((payload.punchList ?? []) as PunchListItem[]).slice(0, limit);
        return {
          ok: true,
          tool: name,
          summary: items.length
            ? `Found ${items.length} open punch / next-step item(s).`
            : 'No open punch items from video analysis yet.',
          data: items.map((item) => ({
            text: item.text,
            detail: item.detail,
            ownerLabel: item.ownerLabel,
            source: item.source,
            workDate: item.workDate,
            seekSeconds: item.seekSeconds,
            proofId: item.proofId,
            company: item.company,
          })),
          ui: items[0]?.proofId
            ? {
                section: 'videos',
                proofId: items[0].proofId,
                workDate: items[0].workDate ?? undefined,
                seekSeconds: items[0].seekSeconds ?? undefined,
              }
            : { section: 'videos' },
        };
      }

      case 'find_evidence_moments': {
        const topic = trim(input.topic) || trim(input.query);
        if (!topic) {
          return { ok: false, tool: name, summary: 'Missing topic to search for.' };
        }
        const words = tokens(topic);
        const moments: Array<{
          workDate: string;
          phase: string | null;
          summary: string;
          transcriptHit: string | null;
        }> = [];
        for (const clip of ctx.file.clips ?? []) {
          const hay = [clip.summary, clip.narration, clip.transcript, ...(clip.changes ?? []), ...(clip.concerns ?? [])]
            .map((s) => trim(s))
            .join('\n')
            .toLowerCase();
          const hits = words.filter((w) => hay.includes(w));
          if (!hits.length && !hay.includes(topic.toLowerCase())) continue;
          const transcript = trim(clip.transcript);
          let transcriptHit: string | null = null;
          if (transcript) {
            const lower = transcript.toLowerCase();
            const idx = words.map((w) => lower.indexOf(w)).find((i) => i >= 0) ?? -1;
            if (idx >= 0) {
              transcriptHit = transcript.slice(Math.max(0, idx - 40), idx + 120).trim();
            }
          }
          moments.push({
            workDate: String(clip.workDate ?? ''),
            phase: clip.phase ?? null,
            summary: trim(clip.summary).slice(0, 220),
            transcriptHit,
          });
          if (moments.length >= 5) break;
        }
        return {
          ok: true,
          tool: name,
          summary: moments.length
            ? `Found ${moments.length} clip moment(s) matching “${topic}”.`
            : `No clip moments matched “${topic}”.`,
          data: moments,
          ui: moments[0]
            ? { section: 'videos', workDate: moments[0].workDate }
            : { section: 'videos' },
        };
      }

      case 'draft_progress_share_copy': {
        const nameLabel = trim(input.recipientName) || 'there';
        const title = trim(ctx.file.job?.title) || trim(ctx.jobTitle) || 'your project';
        const body =
          `Hi ${nameLabel},\n\n` +
          `Here’s a link to follow progress on ${title} in Atmosphere. You can watch the job file, ask questions, and see what’s been filmed — no app install required.\n\n` +
          `[Paste the progress-share link from Who has access → Invite]\n\n` +
          `Thanks`;
        return {
          ok: true,
          tool: name,
          summary: 'Drafted a progress-share message (not sent).',
          data: { subject: `Progress on ${title}`, body, sent: false },
          ui: { section: 'access' },
        };
      }

      case 'draft_field_invite_copy': {
        const company = trim(input.company) || 'your crew';
        const trade = trim(input.trade);
        const title = trim(ctx.file.job?.title) || trim(ctx.jobTitle) || 'the job';
        const body =
          `Hi ${company}${trade ? ` (${trade})` : ''},\n\n` +
          `You’re invited to Field Capture for ${title}. Open the invite link on your phone to record proof clips for this job.\n\n` +
          `[Paste the Field Capture invite link]\n\n` +
          `Thanks`;
        return {
          ok: true,
          tool: name,
          summary: 'Drafted a Field Capture invite message (not sent).',
          data: { subject: `Field Capture invite — ${title}`, body, sent: false },
          ui: { section: 'parties' },
        };
      }

      case 'propose_revoke_access': {
        const label = trim(input.personLabel);
        if (!label) {
          return { ok: false, tool: name, summary: 'Say who to revoke (name or email).' };
        }
        const people = await loadAccessRoster(ctx);
        const needle = label.toLowerCase();
        const match = people.find((p) => {
          const blob = `${p.displayName ?? ''} ${p.name ?? ''} ${p.email ?? ''}`.toLowerCase();
          return blob.includes(needle);
        });
        if (!match) {
          return {
            ok: false,
            tool: name,
            summary: `Could not find “${label}” on the access roster.`,
            ui: { section: 'access' },
          };
        }
        return {
          ok: true,
          tool: name,
          summary: `Ready to revoke access for ${match.displayName || match.email || label} — confirmation required (not revoked yet).`,
          data: {
            id: match.id,
            kind: match.kind,
            name: match.displayName || match.name,
            email: match.email,
          },
          needsConfirmation: {
            action: 'revoke_access',
            detail: `Revoke ${match.displayName || match.email || label}? Use Who has access → Revoke. Ask will not revoke silently.`,
          },
          ui: { section: 'access' },
        };
      }


      case 'send_job_sms': {
        if (ctx.access !== 'org' || !ctx.userId) {
          return { ok: false, tool: name, summary: 'Sending texts is only available to signed-in office users.' };
        }
        const to = trim(input.to);
        const body = trim(input.body);
        const confirm = input.confirm === true || input.confirm === 'true';
        if (!to || !body) {
          return { ok: false, tool: name, summary: 'Need a phone number and the exact message body.' };
        }
        if (!confirm) {
          return {
            ok: false,
            tool: name,
            summary: [
              'Draft only — nothing was sent. Approve this text first:',
              '',
              `To: ${to}`,
              body,
              '',
              'Reply to approve, then I will send it via Twilio.',
            ].join('\n'),
            data: { to, body, channel: 'sms' },
            needsConfirmation: {
              action: 'send_job_sms',
              detail: `Approve sending this text to ${to} via Twilio?`,
            },
          };
        }
        const result = await sendSms({ to, body, orgId: ctx.orgId, jobId: ctx.jobId });
        if (!result.ok) {
          return { ok: false, tool: name, summary: result.message, data: { reason: result.reason } };
        }
        return {
          ok: true,
          tool: name,
          summary: `Text sent to ${to} via Twilio.`,
          data: { to, provider: result.provider, id: result.id },
        };
      }
      case 'start_computer_task': {
        if (ctx.access !== 'org' || !ctx.userId) {
          return { ok: false, tool: name, summary: 'Computer is only available to signed-in office users.' };
        }
        const instructions = trim(input.instructions);
        if (!instructions) {
          return { ok: false, tool: name, summary: 'Say what to do on the website.', ui: { section: 'computer', path: 'computer-task:error' } };
        }
        try {
          const store = computerStore();
          const logins = store ? await store.listLogins(ctx.orgId) : [];
          let accessPeople: Array<{ kind?: string | null; name?: string | null; email?: string | null; displayName?: string | null }> = [];
          try {
            if (ctx.jobId) {
              accessPeople = (await loadAccessRoster(ctx)).map((p) => ({
                kind: p.kind,
                name: p.name,
                email: p.email,
                displayName: p.displayName,
              }));
            }
          } catch {
            accessPeople = [];
          }
          let companyName: string | null = null;
          try {
            const { data: orgRow } = await ctx.supabase
              .from('orgs')
              .select('name')
              .eq('id', ctx.orgId)
              .maybeSingle();
            companyName = String((orgRow as { name?: string | null } | null)?.name ?? '').trim() || null;
          } catch {
            companyName = null;
          }
          const plan = planComputerTask({
            question: instructions,
            logins,
            file: ctx.file,
            address: ctx.address ?? null,
            accessPeople,
            signerName: ctx.authorLabel ?? null,
            companyName,
          });
          if (!plan.ok) {
            return {
              ok: false,
              tool: name,
              summary: plan.summary,
              ui: {
                section: plan.offerLogins ? 'logins' : 'computer',
                path: plan.offerLogins
                  ? 'logins'
                  : plan.needsClarification
                    ? 'computer-task:need-detail'
                    : 'computer-task:error',
              },
            };
          }
          if ('emailDraftPreview' in plan && plan.emailDraftPreview) {
            return {
              ok: true,
              tool: name,
              summary: plan.summary,
              data: {
                channel: 'email',
                draftPreview: true,
                to: plan.to,
                subject: plan.subject,
                body: plan.body,
                offerLogins: true,
              },
              ui: { section: 'logins', path: 'computer-task:draft-preview' },
            };
          }
          if ('smsPendingApproval' in plan && plan.smsPendingApproval) {
            const draft = [
              plan.lead,
              '',
              `To: ${plan.to}`,
              '',
              plan.body,
            ].join('\n');
            return {
              ok: true,
              tool: name,
              summary: draft,
              data: {
                channel: 'sms',
                to: plan.to,
                body: plan.body,
                adjusterName: plan.adjusterName,
                provider: 'twilio',
              },
              needsConfirmation: {
                action: 'send_job_sms',
                detail: `Approve sending this text to ${plan.to}? Nothing was sent yet.`,
              },
              ui: { section: 'computer', path: 'computer-task:sms-approval' },
            };
          }
          if (!('instructions' in plan)) {
            return {
              ok: false,
              tool: name,
              summary: 'Could not plan that computer task.',
              ui: { section: 'computer', path: 'computer-task:error' },
            };
          }
          const task = await startComputerTask({
            orgId: ctx.orgId,
            userId: ctx.userId,
            jobId: ctx.jobId || null,
            instructions: plan.instructions,
            startUrl: trim(input.start_url) || plan.startUrl,
            file: ctx.file,
            address: ctx.address ?? null,
          });
          return {
            ok: true,
            tool: name,
            summary: plan.lead,
            data: {
              taskId: task.id,
              status: task.status,
              jobFields: task.job_projection.length,
              loginHost: plan.matchedLogin?.login.host ?? null,
              kind: plan.kind,
            },
            ui: { section: 'computer', path: `computer-task:${task.id}` },
          };
        } catch (err) {
          if (err instanceof ComputerServiceError) {
            const path = err.code === 'not_set_up' ? 'computer-task:not-set-up' : 'computer-task:error';
            return { ok: false, tool: name, summary: err.message, ui: { section: 'computer', path } };
          }
          throw err;
        }
      }

      default:
        return { ok: false, tool: name, summary: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const detail = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    return { ok: false, tool: name, summary: `Tool failed: ${detail}` };
  }
}

/** Format tool results for the model prompt / final context. */
export function formatAskToolResultsForModel(results: AskToolResult[]): string {
  if (!results.length) return '';
  return results
    .map((r) => {
      const modelData = r.tool === 'web_search' ? webSearchModelPayload(r.data) : r.data;
      const payload = modelData != null ? `\n${JSON.stringify(modelData, null, 0).slice(0, 3500)}` : '';
      const confirm = r.needsConfirmation
        ? `\nNEEDS CONFIRMATION: ${r.needsConfirmation.detail}`
        : '';
      const summary = r.tool === 'web_search' ? plainWebModelText(r.summary) : r.summary;
      return `### Tool ${r.tool} (${r.ok ? 'ok' : 'failed'})\n${summary}${confirm}${payload}`;
    })
    .join('\n\n');
}

export function collectWebHitsFromToolResults(results: AskToolResult[]): AskWebHit[] {
  const hits: AskWebHit[] = [];
  for (const r of results) {
    for (const h of r.webHits ?? []) {
      if (!hits.some((x) => x.url === h.url)) hits.push(h);
    }
  }
  return hits;
}

/** Machine trailer for actions taken — UI turns into chips. */
export function formatActionsTrailer(results: AskToolResult[]): string {
  const parts: string[] = [];
  for (const r of results) {
    // The Computer card renders its own "not set up" / "not allowed" state.
    if (!r.ok && r.tool !== 'start_computer_task') continue;
    const maxLabel = r.ui?.path === 'computer-task:sms-approval' ? 4000 : 80;
    const label = r.summary.replace(/[|,⟦⟧]/g, ' ').slice(0, maxLabel);
    const section = r.ui?.section ?? '';
    const path = r.ui?.path ?? '';
    parts.push(`${r.tool}|${label}|${section}|${path}`);
  }
  if (!parts.length) return '';
  return `⟦actions: ${parts.join(' ;; ')}⟧`;
}

export function parseActionsTrailer(raw: string): Array<{
  tool: string;
  label: string;
  section?: string;
  path?: string;
}> {
  const match = trim(raw).match(/(?:\n|^)\s*⟦actions:\s*([^⟧]+)⟧\s*/i);
  if (!match) return [];
  const out: Array<{ tool: string; label: string; section?: string; path?: string }> = [];
  for (const part of (match[1] ?? '').split(/\s*;;\s*/)) {
    const [tool, label, section, path] = part.split('|');
    if (!trim(tool) || !trim(label)) continue;
    out.push({
      tool: trim(tool),
      label: trim(label),
      section: trim(section) || undefined,
      path: trim(path) || undefined,
    });
  }
  return out;
}

/** Pull title / claim / address / note from a natural-language update ask. */
export function parseJobFieldUpdatesFromQuestion(question: string): {
  title?: string;
  claimNumber?: string;
  address?: string;
  note?: string;
} {
  const q = trim(question);
  const out: { title?: string; claimNumber?: string; address?: string; note?: string } = {};
  if (!q) return out;

  const title =
    q.match(/\b(?:rename(?:\s+job)?|set\s+title|update\s+title|change\s+title|title)\s*(?:to|as|=|:)?\s*["“]?([^"”\n]+)["”]?/i) ||
    q.match(/\b(?:call|name)\s+(?:this\s+)?job\s+["“]?([^"”\n]+)["”]?/i);
  if (title?.[1]) out.title = trim(title[1]).replace(/[.?!]$/, '');

  const claim =
    q.match(/\b(?:claim(?:\s*(?:#|number|num))?|set\s+claim)\s*(?:to|as|=|:)?\s*([A-Za-z0-9][A-Za-z0-9-]{1,40})/i);
  if (claim?.[1]) out.claimNumber = trim(claim[1]);

  const address =
    q.match(/\b(?:address|site)\s*(?:to|as|=|:)?\s*["“]?([^"”\n]{5,200})["”]?/i) ||
    q.match(/\b(?:set|update|change)\s+(?:the\s+)?(?:site\s+)?address\s+(?:to|as|=|:)?\s*["“]?([^"”\n]{5,200})["”]?/i);
  if (address?.[1]) out.address = trim(address[1]).replace(/[.?!]$/, '');

  const note =
    q.match(/\b(?:add\s+(?:a\s+)?note|note\s+that|save\s+(?:a\s+)?note|write\s+(?:a\s+)?note)\s*(?:saying|:)?\s*["“]?([^"”\n]{2,4000})["”]?/i);
  if (note?.[1]) out.note = trim(note[1]).replace(/[.?!]$/, '');

  return out;
}
