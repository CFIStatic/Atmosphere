/**
 * Natural Chat commands that should run as a Computer browser task:
 * email someone a job summary, fill/update a site, open a CRM for outstanding
 * paperwork, "use Outlook", etc.
 *
 * Picks a saved Login when the person names a site we already know, resolves
 * people and job identifiers from the job file (and access roster when given),
 * and builds the instructions Computer gets. Passwords never appear here.
 */
import type { JobFileAskContext } from './jobFileAsk.js';
import type { ComputerLoginRow } from '../computer/store.js';
import { siteOf } from '../computer/sites.js';
import { normalizeSmsNumber, smsProviderConfigured } from './smsProvider.js';

/** Well-known sites people name in Chat; matched to Logins by host or label. */
export const KNOWN_COMPUTER_SITES: ReadonlyArray<{
  aliases: string[];
  host: string;
  url: string;
  kind: 'email' | 'portal' | 'crm' | 'sketch';
}> = [
  { aliases: ['outlook', 'office 365', 'o365', 'microsoft 365', 'hotmail', 'live.com'], host: 'outlook.office.com', url: 'https://outlook.office.com', kind: 'email' },
  { aliases: ['gmail', 'google mail', 'googlemail'], host: 'mail.google.com', url: 'https://mail.google.com', kind: 'email' },
  { aliases: ['xactimate', 'xactware'], host: 'identity.xactware.com', url: 'https://identity.xactware.com', kind: 'portal' },
  { aliases: ['xactanalysis', 'xact analysis'], host: 'www.xactanalysis.com', url: 'https://www.xactanalysis.com', kind: 'portal' },
  { aliases: ['docusketch', 'docu sketch'], host: 'app.docusketch.com', url: 'https://app.docusketch.com', kind: 'sketch' },
  { aliases: ['companycam', 'company cam'], host: 'app.companycam.com', url: 'https://app.companycam.com', kind: 'sketch' },
  { aliases: ['hover', 'hover.io'], host: 'hover.to', url: 'https://hover.to', kind: 'sketch' },
  { aliases: ['eagleview', 'eagle view'], host: 'eagleview.com', url: 'https://www.eagleview.com', kind: 'sketch' },
  { aliases: ['magicplan', 'magic plan'], host: 'cloud.magicplan.app', url: 'https://cloud.magicplan.app', kind: 'sketch' },
  { aliases: ['acculynx', 'accu lynx'], host: 'app.acculynx.com', url: 'https://app.acculynx.com', kind: 'crm' },
  { aliases: ['jobnimbus', 'job nimbus', 'jn'], host: 'app.jobnimbus.com', url: 'https://app.jobnimbus.com', kind: 'crm' },
  { aliases: ['salesforce', 'sfdc'], host: 'login.salesforce.com', url: 'https://login.salesforce.com', kind: 'crm' },
  { aliases: ['servicetitan', 'service titan'], host: 'go.servicetitan.com', url: 'https://go.servicetitan.com', kind: 'crm' },
];

export type ComputerCommandKind = 'email' | 'email_read' | 'website' | 'crm_status' | 'xactimate_estimate' | 'adjuster_status' | 'generic';

export interface ParsedComputerCommand {
  kind: ComputerCommandKind;
  siteMention: string | null;
  known: (typeof KNOWN_COMPUTER_SITES)[number] | null;
  /** Raw recipient phrase from Chat ("Pat", "the homeowner", an email). */
  recipient: string | null;
  /** Normalized role when they said "the homeowner" / "the adjuster". */
  recipientRole: 'homeowner' | 'adjuster' | 'insured' | 'customer' | null;
  wantsSummary: boolean;
  /** Outstanding / completed paperwork check in a CRM. */
  wantsOutstanding: boolean;
  /** Build / enter an estimate in Xactimate. */
  wantsEstimate: boolean;
  /** How to reach the adjuster when asking for a status update. */
  messageChannel: 'xactanalysis' | 'email' | 'sms' | null;
  question: string;
}

const ACTION_VERBS =
  /\b(fill(?:\s+(?:it|this|that|the\s+[\w-]+))?\s*(?:out|in)?|fill\s+out|complete|submit|enter|file|update|change|add|register|apply|request|book|schedule|upload|put\s+(?:it|this|the\s+[\w-]+)\s+(?:on|in|into)|send|email|e-?mail|message|compose|write|draft\s+(?:and\s+)?send|open|go\s+to|use|check|look\s*up|find|review|see|show|list)\b/i;

const WEB_SURFACE =
  /\b(website|web\s*site|web\s*form|online\s*form|portal|browser|online|crm)\b|\bsite\b(?!\s+address)|\.(?:com|gov|org|net|us|io|co\.uk)\b|https?:\/\/|\b(outlook|gmail|xactimate|xactware|office\s*365|o365|microsoft\s*365|acculynx|jobnimbus|salesforce|servicetitan|xactanalysis|docusketch|companycam|hover|eagleview|magicplan)\b/i;

const EMAIL_VERB = /\b(email|e-?mail|send|message|compose)\b/i;
const EMAIL_NOUN = /\b(email|e-?mail|message|note)\b/i;

/** Read the inbox / one message — never compose or send. */
export function isReadOnlyMailboxIntent(question: string): boolean {
  const q = String(question ?? '').toLowerCase();
  if (!/\b(email|e-?mail|inbox|outlook|gmail|mailbox|message)\b/.test(q)) return false;
  if (/\b(send|compose|draft|write|reply|forward|new email)\b/.test(q)) return false;
  return (
    /\b(most recent|latest|last|newest)\b/.test(q) ||
    /\b(subject|sender|from|who sent|what does .* say)\b/.test(q) ||
    /\b(read|check|look\s*up|find|show|tell me|what(?:'| i)?s)\b/.test(q)
  );
}

/** CRM lookup without writing notes / changing status. */
export function isReadOnlyCrmLookup(question: string): boolean {
  const q = String(question ?? '').toLowerCase();
  if (!/\bcrm\b/.test(q) && !KNOWN_COMPUTER_SITES.some((s) => s.kind === 'crm' && s.aliases.some((a) => q.includes(a)))) {
    return false;
  }
  if (/\b(update|add|write|put|post|enter|save|change|delete|upload|submit)\b/.test(q) && /\bnotes?\b/.test(q)) {
    return false;
  }
  return /\b(look\s*up|find|check|show|tell me|what(?:'| i)?s|status|read)\b/.test(q);
}

const SUMMARY = /\b(summar(?:y|ies|ize|ise)|how\s+things\s+are\s+going|status\s+update|update\s+on|progress\s+update|what'?s\s+going\s+on)\b/i;
const OUTSTANDING =
  /\b(outstanding|incomplete|missing|pending|still\s+need(?:s|ed)?|not\s+(?:yet\s+)?(?:done|complete|signed|uploaded)|overdue|what'?s\s+(?:left|open|outstanding)|paperwork|documents?\s+needed|checklist)\b/i;
const ESTIMATE =
  /\b(build|create|make|write|prepare|put\s+together|enter)\b[\s\S]{0,48}\b(estimate|estimating)\b|\b(estimate|estimating)\s+in\s+(?:xactimate|xactware)\b/i;
const ADJUSTER_STATUS =
  /\b(adjusters?|xactanalysis|xact\s*analysis)\b[\s\S]{0,60}\b(status|update|follow\s*-?up|check\s+in|message|email|text|sms|ask|ping|contact)\b|\b(status|update|follow\s*-?up|check\s+in|message|email|text|sms|ask|ping|contact)\b[\s\S]{0,60}\b(adjusters?|xactanalysis)\b|\b(email|text|message|sms|ask|contact)\s+(?:the\s+)?adjusters?\b|\b(update|status)\s+(?:from|with|via)\s+(?:the\s+)?(?:adjusters?|xactanalysis)\b/i;

/** "Fill the claim form…", "email the homeowner a summary", "what's outstanding in AccuLynx". */
export function looksLikeComputerTask(question: string): boolean {
  const q = String(question ?? '').trim().toLowerCase();
  if (!q) return false;
  if (/\buse (?:the )?(?:computer|browser)\b/.test(q)) return true;
  if (isReadOnlyMailboxIntent(q)) return true;
  if (/^(did|does|do|has|have|was|were|is|are|when|why|who|how|can you tell|explain)\b/.test(q) && !OUTSTANDING.test(q) && !/\bwhat'?s\s+(?:outstanding|left|open)\b/.test(q)) {
    // Allow "what is outstanding in AccuLynx" / "what's left in JobNimbus".
    if (!(/\bwhat\b/.test(q) && (OUTSTANDING.test(q) || KNOWN_COMPUTER_SITES.some((s) => s.kind === 'crm' && s.aliases.some((a) => q.includes(a)))))) {
      return false;
    }
  }
  if (/\bdraft\b/.test(q) && /\b(progress\s*share|field\s*(?:capture\s*)?invite|homeowner)\b/.test(q) && !/\bsend\b/.test(q)) {
    return false;
  }
  // Xactimate: build / enter the estimate inside Xactimate Online.
  if (ESTIMATE.test(q) && /\b(xactimate|xactware|\bxact\b)/.test(q)) return true;
  // Ask / message the adjuster (XactAnalysis, email, or text).
  if (ADJUSTER_STATUS.test(q)) return true;
  // CRM outstanding / paperwork questions.
  if (KNOWN_COMPUTER_SITES.some((s) => s.kind === 'crm' && s.aliases.some((a) => q.includes(a))) && (OUTSTANDING.test(q) || /\b(crm|paperwork|documents?|status)\b/.test(q) || /\bwhat\b/.test(q))) {
    return true;
  }
  if (EMAIL_VERB.test(q) && (EMAIL_NOUN.test(q) || /\bto\b/.test(q) || /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(q) || /\b(homeowner|adjuster|insured|customer|client)\b/.test(q))) {
    if (/\bdraft\b/.test(q) && !/\b(send|email|e-?mail)\b/.test(q.replace(/\bdraft\b/, ''))) return false;
    return true;
  }
  if (/\buse\b/.test(q) && KNOWN_COMPUTER_SITES.some((s) => s.aliases.some((a) => q.includes(a)))) return true;
  return ACTION_VERBS.test(q) && WEB_SURFACE.test(q);
}

function findKnown(text: string): (typeof KNOWN_COMPUTER_SITES)[number] | null {
  const lower = text.toLowerCase();
  // Prefer longer alias hits so "xactanalysis" is not swallowed by shorter names.
  let best: (typeof KNOWN_COMPUTER_SITES)[number] | null = null;
  let bestLen = 0;
  for (const site of KNOWN_COMPUTER_SITES) {
    for (const a of site.aliases) {
      if (a && lower.includes(a) && a.length > bestLen) {
        best = site;
        bestLen = a.length;
      }
    }
    if (lower.includes(site.host) && site.host.length > bestLen) {
      best = site;
      bestLen = site.host.length;
    }
  }
  return best;
}


function firstUrlOrHost(text: string): string | null {
  const url = text.match(/https?:\/\/[^\s<>"')]+/i);
  if (url) return url[0].replace(/[.,;:!?]+$/, '');
  const host = text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,12}\b/i);
  if (host && !/\.(pdf|docx?|xlsx?|csv|txt|jpe?g|png|gif)$/i.test(host[0])) return host[0].toLowerCase();
  return null;
}

function recipientRole(text: string): ParsedComputerCommand['recipientRole'] {
  const q = text.toLowerCase();
  if (/\b(the\s+)?homeowners?\b/.test(q)) return 'homeowner';
  if (/\b(the\s+)?adjusters?\b/.test(q)) return 'adjuster';
  if (/\b(the\s+)?insured\b/.test(q)) return 'insured';
  if (/\b(the\s+)?(customer|client)\b/.test(q)) return 'customer';
  return null;
}

function emailRecipient(text: string): string | null {
  const addr = text.match(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i);
  if (addr) return addr[0];
  const role = recipientRole(text);
  if (role) return role === 'homeowner' ? 'the homeowner' : role === 'adjuster' ? 'the adjuster' : role === 'insured' ? 'the insured' : 'the customer';
  const named = text.match(
    /\b(?:email|e-?mail|send|message)\s+(?:an?\s+)?(?:email\s+to\s+|message\s+to\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|the\s+[a-z]+)\b/,
  );
  if (named) {
    const who = named[1].replace(/^the\s+/i, '').trim();
    if (!/^(a|an|the|me|us|them|him|her|it|this|that|summary|update|email|message|note|status)\b/i.test(who)) return who;
  }
  const to = text.match(/\bto\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/);
  return to ? to[1] : null;
}


/** "Update the CRM notes" without naming AccuLynx/JobNimbus/etc. */
export function isCrmNotesIntent(question: string): boolean {
  const q = String(question ?? '').toLowerCase();
  if (!/\bcrm\b/.test(q)) return false;
  if (!/\bnotes?\b/.test(q)) return false;
  return /\b(update|add|write|put|post|enter|save)\b/.test(q);
}

/** Bare "CRM" with no known product alias and no host. */
export function isUnnamedCrmIntent(question: string): boolean {
  const q = String(question ?? '').toLowerCase();
  if (!/\bcrm\b/.test(q)) return false;
  if (KNOWN_COMPUTER_SITES.some((s) => s.kind === 'crm' && s.aliases.some((a) => q.includes(a)))) return false;
  return true;
}

export function parseComputerCommand(question: string): ParsedComputerCommand {
  const q = String(question ?? '').trim();
  const known = findKnown(q);
  const siteMention = known?.aliases.find((a) => q.toLowerCase().includes(a)) ?? firstUrlOrHost(q);
  const wantsSummary = SUMMARY.test(q);
  const wantsOutstanding = OUTSTANDING.test(q) || (Boolean(known?.kind === 'crm') && /\bwhat\b/i.test(q));
  const wantsEstimate = ESTIMATE.test(q);
  const role = recipientRole(q);
  const isAdjusterStatus =
    ADJUSTER_STATUS.test(q) ||
    (role === 'adjuster' && (EMAIL_VERB.test(q) || /\b(text|sms|status|update|ask|contact|message)\b/i.test(q)));
  let messageChannel: ParsedComputerCommand['messageChannel'] = null;
  if (isAdjusterStatus) {
    if (/\b(xactanalysis|xact\s*analysis)\b/i.test(q) || (known?.aliases.some((a) => a.includes('xactanalysis')) ?? false))
      messageChannel = 'xactanalysis';
    else if (/\b(text|sms|text\s+message)\b/i.test(q)) messageChannel = 'sms';
    else if (EMAIL_VERB.test(q) || /\bemail\b/i.test(q) || known?.kind === 'email') messageChannel = 'email';
  }
  const readMailbox = isReadOnlyMailboxIntent(q);
  const isEmail =
    !readMailbox &&
    ((EMAIL_VERB.test(q) && (EMAIL_NOUN.test(q) || Boolean(emailRecipient(q)) || Boolean(role))) ||
      (Boolean(known && known.kind === 'email') && EMAIL_VERB.test(q)));
  const isCrm =
    Boolean(known?.kind === 'crm') &&
    (wantsOutstanding ||
      isReadOnlyCrmLookup(q) ||
      /\b(crm|paperwork|status|documents?)\b/i.test(q) ||
      /\bwhat\b/i.test(q));
  const isXactEstimate =
    wantsEstimate &&
    (Boolean(known && (known.aliases.includes('xactimate') || known.aliases.includes('xactware') || known.host.includes('xactware'))) ||
      /\b(xactimate|xactware)\b/i.test(q));
  return {
    kind: readMailbox
      ? 'email_read'
      : isEmail && !isAdjusterStatus
      ? 'email'
      : isXactEstimate
        ? 'xactimate_estimate'
        : isAdjusterStatus
          ? 'adjuster_status'
          : isCrm
            ? 'crm_status'
            : known || siteMention
              ? 'website'
              : 'generic',
    siteMention: siteMention ?? null,
    known:
      known ??
      (isXactEstimate
        ? KNOWN_COMPUTER_SITES.find((x) => x.aliases.includes('xactimate')) ?? null
        : isAdjusterStatus && messageChannel === 'xactanalysis'
          ? KNOWN_COMPUTER_SITES.find((x) => x.aliases.includes('xactanalysis')) ?? null
          : null),
    recipient: isEmail || isAdjusterStatus ? emailRecipient(q) : null,
    recipientRole: role ?? (isAdjusterStatus ? 'adjuster' : null),
    wantsSummary,
    wantsOutstanding,
    wantsEstimate,
    messageChannel,
    question: q,
  };
}

export interface MatchedLogin {
  login: ComputerLoginRow;
  via: 'host' | 'label' | 'alias';
}

export function matchSavedLogin(logins: ComputerLoginRow[], command: ParsedComputerCommand): MatchedLogin | null {
  if (!logins.length) return null;
  const mention = (command.siteMention ?? '').toLowerCase().trim();
  const known = command.known;

  const byHost = (host: string) => {
    const site = siteOf(host);
    return logins.find((l) => l.host === host || siteOf(l.host) === site || l.host.endsWith(`.${site}`));
  };

  if (known) {
    const hit = byHost(known.host) ?? logins.find((l) => known.aliases.some((a) => l.label.toLowerCase().includes(a)));
    if (hit) return { login: hit, via: hit.host.includes(known.host) || siteOf(hit.host) === siteOf(known.host) ? 'host' : 'alias' };
  }
  if (mention) {
    try {
      const host = mention.includes('://') ? new URL(mention).hostname.toLowerCase() : mention.replace(/^www\./, '');
      const hit = byHost(host);
      if (hit) return { login: hit, via: 'host' };
    } catch {
      /* not a URL */
    }
    const byLabel = logins.find((l) => l.label.toLowerCase() === mention || l.label.toLowerCase().includes(mention));
    if (byLabel) return { login: byLabel, via: 'label' };
  }
  if (command.kind === 'email' || command.kind === 'email_read') {
    for (const pref of KNOWN_COMPUTER_SITES.filter((s) => s.kind === 'email')) {
      const hit = byHost(pref.host) ?? logins.find((l) => pref.aliases.some((a) => l.label.toLowerCase().includes(a)));
      if (hit) return { login: hit, via: 'alias' };
    }
  }
  return null;
}

/** A person we can email, resolved from the job file / access roster. */
export interface ResolvedPerson {
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  source: string;
}

/** Optional access-roster rows (homeowner shares, etc.) passed in by the Ask tool. */
export interface AccessPersonHint {
  kind?: string | null;
  name?: string | null;
  email?: string | null;
  displayName?: string | null;
}

function fact(file: JobFileAskContext | null | undefined, ...labels: string[]): string | null {
  const facts = file?.facts ?? {};
  for (const want of labels) {
    const hit = Object.entries(facts).find(([k]) => k.toLowerCase().replace(/[_-]+/g, ' ').trim() === want.toLowerCase());
    if (hit && String(hit[1]).trim()) return String(hit[1]).trim();
  }
  // Soft match: label contains the key words.
  for (const want of labels) {
    const hit = Object.entries(facts).find(([k]) => k.toLowerCase().includes(want.toLowerCase()));
    if (hit && String(hit[1]).trim()) return String(hit[1]).trim();
  }
  return null;
}

/**
 * Resolve "the homeowner" / "the adjuster" / a named person to name + email
 * from job facts, then the access roster. Never invents an address.
 */

/**
 * Find the job's adjuster from brief facts, access roster, carrier/Xactimate
 * assignment fields, or uploaded carrier documents. Never invents contact info.
 */
export function resolveAdjusterFromJob(input: {
  file?: JobFileAskContext | null;
  accessPeople?: AccessPersonHint[] | null;
}): ResolvedPerson {
  const { file, accessPeople } = input;
  const name =
    fact(
      file,
      'adjuster',
      'adjuster name',
      'claim adjuster',
      'assigned adjuster',
      'xa adjuster',
      'xactanalysis adjuster',
      'carrier adjuster',
      'desk adjuster',
      'field adjuster',
    ) ?? null;
  const email =
    fact(file, 'adjuster email', 'adjuster e-mail', 'xa adjuster email', 'carrier adjuster email') ?? null;
  const phone =
    fact(file, 'adjuster phone', 'adjuster mobile', 'adjuster cell', 'adjuster telephone', 'xa adjuster phone') ?? null;

  if (email || phone || name) {
    return {
      name,
      email,
      phone,
      role: 'adjuster',
      source: email || phone ? 'job file' : 'job file (name only)',
    };
  }

  const fromRoster = (accessPeople ?? []).find(
    (p) =>
      (p.kind === 'adjuster' || /adjuster/i.test(String(p.displayName ?? p.name ?? ''))) &&
      (String(p.email ?? '').includes('@') || true),
  );
  if (fromRoster && (fromRoster.email || fromRoster.name || fromRoster.displayName)) {
    return {
      name: fromRoster.name || fromRoster.displayName || null,
      email: fromRoster.email ?? null,
      phone: null,
      role: 'adjuster',
      source: 'access roster',
    };
  }

  for (const doc of file?.documents ?? []) {
    const blob = `${doc.filename ?? ''} ${doc.summary ?? ''} ${doc.kind ?? ''}`.toLowerCase();
    if (!/adjuster|carrier|xactanalysis|assignment|claim\s*letter/.test(blob)) continue;
    const summary = String(doc.summary ?? '');
    const em = summary.match(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i);
    const ph = summary.match(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/);
    const nm = summary.match(/(?:adjuster|assigned to)\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
    if (em || ph || nm) {
      return {
        name: nm ? nm[1] : null,
        email: em ? em[0] : null,
        phone: ph ? ph[0] : null,
        role: 'adjuster',
        source: `uploaded file (${doc.filename || 'carrier document'})`,
      };
    }
  }

  return { name: null, email: null, phone: null, role: 'adjuster', source: 'not on file' };
}

export function resolvePersonFromJob(input: {
  command: ParsedComputerCommand;
  file?: JobFileAskContext | null;
  accessPeople?: AccessPersonHint[] | null;
}): ResolvedPerson | null {
  const { command, file, accessPeople } = input;
  const role = command.recipientRole;
  const raw = (command.recipient ?? '').trim();
  if (!role && !raw) return null;
  if (raw.includes('@')) {
    return { name: null, email: raw, phone: null, role: role ?? 'recipient', source: 'your message' };
  }

  if (role === 'homeowner' || role === 'insured' || role === 'customer' || /^homeowner|insured|customer|client$/i.test(raw)) {
    const name =
      fact(file, 'homeowner', 'homeowner name', 'insured name', 'insured', 'named insured', 'customer', 'customer name', 'client', 'owner', 'property owner') ??
      null;
    const email =
      fact(file, 'homeowner email', 'insured email', 'customer email', 'client email', 'owner email', 'email') ?? null;
    if (email || name) {
      return { name, email, phone: fact(file, 'homeowner phone', 'homeowner mobile', 'insured phone', 'customer phone'), role: 'homeowner', source: email ? 'job file' : 'job file (name only)' };
    }
    const fromRoster = (accessPeople ?? []).find(
      (p) => (p.kind === 'homeowner' || /homeowner/i.test(String(p.displayName ?? ''))) && String(p.email ?? '').includes('@'),
    );
    if (fromRoster) {
      return {
        name: fromRoster.name || fromRoster.displayName || null,
        email: fromRoster.email ?? null,
        phone: null,
        role: 'homeowner',
        source: 'access roster',
      };
    }
    return { name: null, email: null, phone: null, role: 'homeowner', source: 'not on file' };
  }

  if (role === 'adjuster' || /^adjuster$/i.test(raw)) {
    return resolveAdjusterFromJob({ file, accessPeople });
  }

  // Named person: try facts / roster by name.
  if (raw) {
    const lower = raw.toLowerCase();
    const fromRoster = (accessPeople ?? []).find(
      (p) =>
        String(p.email ?? '').includes('@') &&
        (String(p.name ?? '').toLowerCase().includes(lower) || String(p.displayName ?? '').toLowerCase().includes(lower)),
    );
    if (fromRoster) {
      return { name: fromRoster.name || raw, email: fromRoster.email ?? null, phone: null, role: 'recipient', source: 'access roster' };
    }
  }
  return raw ? { name: raw, email: null, phone: null, role: 'recipient', source: 'your message (no email on file)' } : null;
}

/** Job identifiers Computer should use to find the right CRM / form record. */
export function jobIdentifiers(file: JobFileAskContext | null | undefined, address?: string | null): string[] {
  const lines: string[] = [];
  const job = file?.job ?? null;
  const claim = String(job?.claimNumber ?? '').trim();
  if (claim) lines.push(`Claim number: ${claim}`);
  const policy = String(job?.policyNumber ?? '').trim();
  if (policy) lines.push(`Policy number: ${policy}`);
  const title = String(job?.title ?? '').trim();
  if (title) lines.push(`Job title: ${title}`);
  const num = job?.jobNumber != null ? String(job.jobNumber).trim() : '';
  if (num) lines.push(`Job number: ${num}`);
  const addr = String(address ?? '').trim();
  if (addr) lines.push(`Property address: ${addr}`);
  const insured = fact(file, 'insured name', 'insured', 'homeowner', 'homeowner name', 'customer', 'customer name');
  if (insured) lines.push(`Insured / homeowner: ${insured}`);
  return lines;
}

export function jobSummaryForEmail(file: JobFileAskContext | null | undefined, address?: string | null): string {
  const pretty: string[] = [];
  const job = file?.job ?? null;
  if (job?.title) pretty.push(`Job: ${String(job.title).trim()}`);
  for (const id of jobIdentifiers(file, address)) {
    if (id.startsWith('Job title:')) continue;
    pretty.push(id);
  }
  const loss = String(job?.lossType ?? '').trim();
  if (loss) pretty.push(`Loss type: ${loss}`);
  const work = String(job?.workType ?? '').trim();
  if (work) pretty.push(`Work: ${work}`);
  if (!pretty.length) return 'No job details on file yet.';
  return ['Quick update on this job:', ...pretty.map((l) => `• ${l}`), '', 'Please reply if you need anything else.'].join('\n');
}

export interface ComputerTaskPlan {
  ok: true;
  instructions: string;
  startUrl: string | null;
  matchedLogin: MatchedLogin | null;
  kind: ComputerCommandKind;
  lead: string;
}

/** Text draft ready for Chat approval; send only after the person approves. */
export interface ComputerTaskSmsPending {
  ok: true;
  kind: 'adjuster_status';
  smsPendingApproval: true;
  to: string;
  body: string;
  lead: string;
  adjusterName: string | null;
}

/**
 * Exact email draft shown in Chat when no Outlook/Gmail Login exists yet.
 * Nothing is sent; the person adds a Login, then asks again so Computer can Approve Send.
 */
export interface ComputerTaskEmailDraftPending {
  ok: true;
  kind: 'email';
  emailDraftPreview: true;
  offerLogins: true;
  to: string | null;
  subject: string;
  body: string;
  lead: string;
  summary: string;
}

export interface ComputerTaskBlocked {
  ok: false;
  summary: string;
  offerLogins: boolean;
  /** Missing detail the person should answer in Chat (e.g. homeowner email). */
  needsClarification?: boolean;
}

/**
 * Gather rooms, measurements, footage findings, and scope from the job file,
 * then add clearly labeled industry-standard scaffold line items. Used as the
 * values Computer should enter inside Xactimate. Never invents prices.
 */
export interface XactimateScopeLine {
  label: string;
  detail: string;
  source: string;
}

export function buildXactimateScopeLines(
  file: JobFileAskContext | null | undefined,
  address?: string | null,
): XactimateScopeLine[] {
  const lines: XactimateScopeLine[] = [];
  const push = (label: string, detail: string, source: string) => {
    const L = label.trim();
    if (!L) return;
    if (lines.some((x) => x.label.toLowerCase() === L.toLowerCase())) return;
    lines.push({ label: L, detail: detail.trim(), source });
  };

  for (const id of jobIdentifiers(file, address)) {
    const idx = id.indexOf(':');
    if (idx < 0) push(id, '', 'job file');
    else push(id.slice(0, idx).trim(), id.slice(idx + 1).trim(), 'job file');
  }

  const facts = file?.facts ?? {};
  for (const [rawK, rawV] of Object.entries(facts)) {
    const k = rawK.toLowerCase();
    const v = String(rawV ?? '').trim();
    if (!v) continue;
    if (/lockbox|gate\s*code|password|ssn|secret|pin\b/i.test(k)) continue;
    if (
      /room|sq\.?\s*ft|square\s*feet|footage|measurement|dimension|pitch|squares?|ridge|eave|valley|stor(?:y|ies)|roof\s*type|shingle|damage|hail|wind|water|mitigation|class\s*\d/i.test(
        k,
      ) ||
      /room|sq\.?\s*ft|square|footage|measurement/i.test(v)
    ) {
      push(rawK.trim(), v, 'job file');
    }
  }

  for (const scope of file?.scope ?? []) {
    const title = String(scope.title ?? '').trim();
    if (!title) continue;
    const state = String(scope.state ?? '').trim();
    if (/exclud|do\s*not|don'?t|out\s*of\s*scope/i.test(state) || /exclud|do\s*not/i.test(title)) {
      push(
        `Do not include: ${title}`,
        [scope.detail, scope.reason].filter(Boolean).map(String).join(' — '),
        'job scope',
      );
      continue;
    }
    push(
      title,
      [scope.detail, state && !/^(included|listed|in[_ ]?scope)$/i.test(state) ? `State: ${state}` : '']
        .filter(Boolean)
        .join(' — '),
      'job scope',
    );
  }

  for (const doc of file?.documents ?? []) {
    const name = String(doc.filename ?? doc.summary ?? '').trim();
    if (!name) continue;
    if (
      /estimate|sketch|floor\s*plan|measurement|scope|xact/i.test(name) ||
      /estimate|measurement|scope/i.test(String(doc.kind ?? ''))
    ) {
      push(`Reference document: ${name}`, String(doc.summary ?? doc.relevanceReason ?? '').trim(), 'uploaded file');
    }
  }

  if ((file?.clips ?? []).length) {
    push(
      'Field capture on file',
      'Use rooms, damage notes, and measurements from field capture on this job when entering quantities. Do not invent footage.',
      'field capture',
    );
  }

  const hay = [
    String(file?.job?.title ?? ''),
    ...Object.entries(file?.facts ?? {}).map(([k, v]) => `${k} ${v}`),
    ...(file?.scope ?? []).map((l) => String(l.title ?? '')),
  ]
    .join(' ')
    .toLowerCase();

  const isRoof = /\broof|shingle|hail|wind\s*damage|ridge|eave|gutter\b/.test(hay);
  const isWater = /\bwater|flood|mitigation|dry.?out|mold|leak\b/.test(hay);

  type Std = { label: string; detail: string };
  const std: Std[] = [];
  if (isRoof) {
    std.push(
      { label: 'Remove composition shingles', detail: 'Tear off existing roof covering as needed. Quantity from roof squares or measurements on file.' },
      { label: 'Underlayment', detail: 'Install underlayment per code and manufacturer. Match roof area on file.' },
      { label: 'Drip edge', detail: 'Install drip edge at eaves and rakes as required.' },
      { label: 'Ridge cap', detail: 'Install ridge cap along ridges. Length from measurements on file.' },
      { label: 'Flashing', detail: 'Replace or install flashing at walls, chimneys, and penetrations as needed.' },
      { label: 'Debris haul-off', detail: 'Haul off tear-off debris and roofing waste.' },
    );
  }
  if (isWater) {
    std.push(
      { label: 'Water extraction', detail: 'Extract standing water from affected rooms.' },
      { label: 'Equipment — dehumidification / air movers', detail: 'Place drying equipment per mitigation class and room count on file.' },
      { label: 'Content manipulation', detail: 'Move and protect contents in affected rooms as needed.' },
      { label: 'Flooring — remove and replace (affected areas)', detail: 'Only where damage is documented on the job file.' },
      { label: 'Drywall — remove and replace (affected areas)', detail: 'Only where damage is documented on the job file.' },
    );
  }
  if (!isRoof && !isWater) {
    std.push(
      { label: 'General demolition — affected finishes', detail: 'Remove damaged finishes only where the job file documents damage.' },
      { label: 'Replace damaged finishes', detail: 'Match rooms and quantities from measurements and scope on file.' },
      { label: 'Clean and prepare for closing', detail: 'Final clean of work areas.' },
    );
  }
  for (const item of std) {
    push(item.label, `${item.detail} (Suggested standard item — confirm before relying on it.)`, 'industry standard');
  }

  return lines;
}

function formatXactimateScopeForInstructions(lines: XactimateScopeLine[]): string {
  if (!lines.length) {
    return 'No rooms, measurements, or scope lines were found on this job file yet. Call ask_clarification to ask what to enter.';
  }
  return lines
    .map((l, i) => `${i + 1}. ${l.label}${l.detail ? ` — ${l.detail}` : ''} [${l.source}]`)
    .join('\n');
}

function formatXactimateScopeForChat(lines: XactimateScopeLine[]): string {
  if (!lines.length) {
    return 'I do not have rooms, measurements, or scope on this job file yet to seed the estimate.';
  }
  // Markdown list so Chat renders one line item per line (not a run-on paragraph).
  const body = lines
    .map((l) => {
      const detail = l.detail.replace(/\s*\(Suggested standard item[^)]*\)\s*/gi, '').trim();
      const text = detail && !detail.toLowerCase().startsWith(l.label.toLowerCase()) ? `${l.label}: ${detail}` : l.label;
      return `- ${text}`;
    })
    .join('\n');
  return `Here is the draft list I will enter in Xactimate (no prices):\n\n${body}`;
}



/** Saved Logins for sketch / measurement providers (DocuSketch, CompanyCam, Hover, …). */
export function listSketchProviderLogins(logins: ComputerLoginRow[]): ComputerLoginRow[] {
  const knownSketch = KNOWN_COMPUTER_SITES.filter((s) => s.kind === 'sketch');
  return logins.filter((l) => {
    const label = l.label.toLowerCase();
    const host = l.host.toLowerCase();
    return knownSketch.some(
      (s) => host === s.host || host.endsWith(`.${s.host}`) || siteOf(host) === siteOf(s.host) || s.aliases.some((a) => label.includes(a)),
    );
  });
}

/**
 * Prefer a sketch provider named on the job / question; otherwise the org's
 * only sketch Login; otherwise null (ask the person).
 */
export function matchSketchProviderLogin(
  logins: ComputerLoginRow[],
  question: string,
  file?: JobFileAskContext | null,
): MatchedLogin | null {
  const sketchLogins = listSketchProviderLogins(logins);
  if (!sketchLogins.length) return null;
  const hay = [
    question,
    String(file?.job?.title ?? ''),
    ...Object.entries(file?.facts ?? {}).map(([k, v]) => `${k} ${v}`),
    ...(file?.documents ?? []).map((d) => `${d.filename ?? ''} ${d.summary ?? ''}`),
  ]
    .join(' ')
    .toLowerCase();
  for (const site of KNOWN_COMPUTER_SITES.filter((s) => s.kind === 'sketch')) {
    if (!site.aliases.some((a) => hay.includes(a)) && !hay.includes(site.host)) continue;
    const hit =
      sketchLogins.find((l) => l.host === site.host || siteOf(l.host) === siteOf(site.host) || site.aliases.some((a) => l.label.toLowerCase().includes(a))) ??
      null;
    if (hit) return { login: hit, via: 'alias' };
  }
  if (sketchLogins.length === 1) return { login: sketchLogins[0], via: 'label' };
  return null;
}

function jobMentionsSketch(file?: JobFileAskContext | null, question?: string): boolean {
  const hay = [
    question ?? '',
    ...Object.entries(file?.facts ?? {}).map(([k, v]) => `${k} ${v}`),
    ...(file?.documents ?? []).map((d) => `${d.filename ?? ''} ${d.kind ?? ''} ${d.summary ?? ''}`),
    ...(file?.scope ?? []).map((l) => String(l.title ?? '')),
  ]
    .join(' ')
    .toLowerCase();
  if (/\b(sketch|esx|measurement\s*report|roof\s*report|matterport|point\s*cloud)\b/.test(hay)) return true;
  return KNOWN_COMPUTER_SITES.some((s) => s.kind === 'sketch' && s.aliases.some((a) => hay.includes(a)));
}


/** Closing for adjuster text/email drafts: "Thank you," then the person and company. */
export function adjusterDraftSignOff(signerName?: string | null, companyName?: string | null): string[] {
  const name = String(signerName ?? '').trim();
  const company = String(companyName ?? '').trim();
  const lines = ['Thank you,'];
  if (name) lines.push(name);
  if (company && company.toLowerCase() !== name.toLowerCase()) lines.push(company);
  return lines;
}

export function planComputerTask(input: {
  question: string;
  logins: ComputerLoginRow[];
  file?: JobFileAskContext | null;
  address?: string | null;
  accessPeople?: AccessPersonHint[] | null;
  /** Signed-in person's name for the closing (adjuster drafts). */
  signerName?: string | null;
  /** Their company name for the closing, when known. */
  companyName?: string | null;
}): ComputerTaskPlan | ComputerTaskBlocked | ComputerTaskSmsPending | ComputerTaskEmailDraftPending {
  const command = parseComputerCommand(input.question);
  const matched = matchSavedLogin(input.logins, command);
  const namedSite = Boolean(command.known || command.siteMention);
  const ids = jobIdentifiers(input.file, input.address);

  // ---- Read-only mailbox (never compose / send) ----
  if (command.kind === 'email_read') {
    if (!matched) {
      return {
        ok: false,
        offerLogins: true,
        summary:
          "I don't have a saved Outlook or Gmail login yet. Open Logins in the sidebar, add it and sign in, then ask me again. I'll open the inbox and report back — nothing will be sent.",
      };
    }
    const host = matched.login.host;
    const label = matched.login.label || host;
    const instructions = [
      `Open ${label} (${host}) and go to the Inbox (not Compose / New mail).`,
      `Task (read only): ${command.question.trim()}`,
      'Find the message that answers the question (usually the most recent).',
      'Report the Subject and Sender (From) exactly as shown. Include the received time when visible.',
      `Call sign_in_saved with site "${host}" if you hit a sign-in page.`,
      'Do not compose, reply, forward, or click Send. Do not call request_approval for Send.',
      'If the inbox UI is unclear, call look_up_how_to, then continue. If still stuck, call ask_clarification.',
      'End with finish: title like "Inbox check", fields = Subject and Sender (and Received when known), submitted=false.',
    ].join('\n');
    return {
      ok: true,
      kind: 'email_read',
      instructions,
      startUrl: matched.login.url,
      matchedLogin: matched,
      lead: `Opening ${label} to read the inbox. Nothing will be sent.`,
    };
  }

  // ---- Email ----
  if (command.kind === 'email') {
    if (!matched) {
      const person = resolvePersonFromJob({ command, file: input.file, accessPeople: input.accessPeople });
      const to = person?.email ?? (command.recipient?.includes('@') ? command.recipient : null);
      const toName = person?.name ? `${person.name} <${to}>` : to;
      const summary = jobSummaryForEmail(input.file, input.address);
      const subject = input.file?.job?.title
        ? `Update: ${String(input.file.job.title).trim()}`
        : command.wantsSummary
          ? 'Job status update'
          : 'Update';
      const body = summary || '(Add the message body once you confirm what to send.)';
      const draftLines = [
        'Exact draft (nothing was sent):',
        `To: ${toName || '(need recipient email)'}`,
        `Subject: ${subject}`,
        '',
        body,
        '',
        'Open Logins in the sidebar, add Outlook or Gmail and save the password, then ask me again. I will open the mailbox, fill this draft, and check with you before Send.',
      ];
      return {
        ok: true,
        kind: 'email',
        emailDraftPreview: true,
        offerLogins: true,
        to: to ?? null,
        subject,
        body,
        lead: 'I drafted the email in Chat. Add an Outlook or Gmail login, then ask again so I can open the browser and get your Approve before Send.',
        summary: draftLines.join('\n'),
      };
    }
    const person = resolvePersonFromJob({ command, file: input.file, accessPeople: input.accessPeople });
    const needsEmail = Boolean(command.recipientRole || (command.recipient && !command.recipient.includes('@')));
    if (needsEmail && (!person || !person.email)) {
      const who = command.recipientRole === 'homeowner' || command.recipientRole === 'insured' || command.recipientRole === 'customer'
        ? 'homeowner'
        : command.recipientRole === 'adjuster'
          ? 'adjuster'
          : command.recipient || 'recipient';
      return {
        ok: false,
        offerLogins: false,
        needsClarification: true,
        summary: `I don't have an email address for the ${who} on this job file. What's their email? Once I have it I'll open ${matched.login.label}, draft the message, and check with you before sending.`,
      };
    }
    const to = person?.email ?? (command.recipient?.includes('@') ? command.recipient : null);
    if (!to) {
      return {
        ok: false,
        offerLogins: false,
        needsClarification: true,
        summary: `Who should I email, and what's their address? I'll open ${matched.login.label} and draft it once I know.`,
      };
    }
    const toName = person?.name ? `${person.name} <${to}>` : to;
    const summary = jobSummaryForEmail(input.file, input.address);
    const subject = input.file?.job?.title
      ? `Update: ${String(input.file.job.title).trim()}`
      : command.wantsSummary
        ? 'Job status update'
        : 'Update';
    const host = matched.login.host;
    const label = matched.login.label || host;
    const instructions = [
      `Open ${label} (${host}) and compose a new email.`,
      `To: ${toName}`,
      `Subject: ${subject}`,
      'Body (use this text; you may tidy line breaks but do not invent facts):',
      '---',
      summary,
      '---',
      person?.source ? `Recipient came from ${person.source}.` : '',
      `Call sign_in_saved with site "${host}" if you hit a sign-in page.`,
      'Fill To, Subject and Body. Keep the tone clean and professional — plain English, like a careful office admin wrote it. No slang, no emoji, no internal labels.',
      'Then call request_approval with the exact Send button label and wait.',
      'Never click Send (or any send/share control) without an approved request_approval. If the person declines, call finish without sending.',
      'If you do not know how to compose mail on this site, call look_up_how_to, then try again. If you are still stuck, call ask_clarification.',
    ]
      .filter(Boolean)
      .join('\n');
    return {
      ok: true,
      kind: 'email',
      instructions,
      startUrl: matched.login.url,
      matchedLogin: matched,
      lead: `Opening ${label} to email ${person?.name || to}. I'll check with you before anything is sent.`,
    };
  }




  // ---- Adjuster status (XactAnalysis / email / SMS scaffold) ----
  if (command.kind === 'adjuster_status') {
    const adjuster = resolveAdjusterFromJob({ file: input.file, accessPeople: input.accessPeople });
    if (!adjuster.name && !adjuster.email && !adjuster.phone) {
      return {
        ok: false,
        offerLogins: false,
        needsClarification: true,
        summary:
          "I could not find the adjuster on this job file. Who is the adjuster, and how should I reach them: XactAnalysis, email, or text?",
      };
    }

    const channel = command.messageChannel;
    const who =
      adjuster.name && adjuster.email
        ? `${adjuster.name} <${adjuster.email}>`
        : adjuster.name || adjuster.email || adjuster.phone || 'the adjuster';
    const ids = jobIdentifiers(input.file, input.address);
    const statusBody = [
      'Hello' + (adjuster.name ? ` ${adjuster.name.split(' ')[0]}` : '') + ',',
      '',
      'I am checking in for a status update on this claim.',
      ...ids.map((l) => l),
      '',
      'Please let us know the current status and any next steps on your side.',
      '',
      ...adjusterDraftSignOff(input.signerName, input.companyName),
    ].join('\n');

    if (!channel) {
      const found = [
        adjuster.name ? `name: ${adjuster.name}` : null,
        adjuster.email ? `email: ${adjuster.email}` : null,
        adjuster.phone ? `phone: ${adjuster.phone}` : null,
      ]
        .filter(Boolean)
        .join('; ');
      return {
        ok: false,
        offerLogins: false,
        needsClarification: true,
        summary: `I found the adjuster on file (${found}). How should I reach them: XactAnalysis, email, or text?`,
      };
    }

    if (channel === 'sms') {
      if (!adjuster.phone) {
        return {
          ok: false,
          offerLogins: false,
          needsClarification: true,
          summary: `I have the adjuster${adjuster.name ? ` (${adjuster.name})` : ''} but no phone number on file. What number should I text?`,
        };
      }
      const to = normalizeSmsNumber(adjuster.phone);
      if (!to) {
        return {
          ok: false,
          offerLogins: false,
          needsClarification: true,
          summary: `The adjuster phone on file (${adjuster.phone}) does not look valid. What number should I text?`,
        };
      }
      if (!smsProviderConfigured()) {
        return {
          ok: false,
          offerLogins: false,
          needsClarification: true,
          summary:
            'Texting is not connected on this account yet. Ask me to email the adjuster or message them in XactAnalysis instead.',
        };
      }
      return {
        ok: true,
        kind: 'adjuster_status',
        smsPendingApproval: true,
        to,
        body: statusBody,
        adjusterName: adjuster.name,
        lead: `Draft text to ${adjuster.name || 'the adjuster'} at ${to}. I will check with you before anything is sent.`,
      };
    }

    if (channel === 'email') {
      const mailLogin =
        matchSavedLogin(input.logins, { ...command, kind: 'email', known: KNOWN_COMPUTER_SITES.find((x) => x.aliases.includes('outlook')) ?? null, siteMention: 'outlook' }) ??
        matchSavedLogin(input.logins, { ...command, kind: 'email', known: KNOWN_COMPUTER_SITES.find((x) => x.aliases.includes('gmail')) ?? null, siteMention: 'gmail' });
      if (!mailLogin) {
        return {
          ok: false,
          offerLogins: true,
          summary:
            "I can email the adjuster from Outlook or Gmail once Computer is signed in. Open Logins in the sidebar, add Outlook or Gmail, and save the password. Then ask me again.",
        };
      }
      if (!adjuster.email) {
        return {
          ok: false,
          offerLogins: false,
          needsClarification: true,
          summary: `I have the adjuster${adjuster.name ? ` (${adjuster.name})` : ''} but no email address on file. What is their email?`,
        };
      }
      const host = mailLogin.login.host;
      const label = mailLogin.login.label || host;
      const subject = input.file?.job?.claimNumber
        ? `Status update request: claim ${input.file.job.claimNumber}`
        : 'Status update request';
      const instructions = [
        `Open ${label} (${host}) and compose a new email to the adjuster.`,
        `To: ${who}`,
        `Subject: ${subject}`,
        'Body (professional office tone — plain English, no slang, no emoji):',
        '---',
        statusBody,
        '---',
        `Adjuster came from ${adjuster.source}.`,
        `Call sign_in_saved with site "${host}" if you hit a sign-in page.`,
        'Fill To, Subject and Body. Then call request_approval with the exact Send button label and wait.',
        'Never click Send without an approved request_approval. If the person declines, call finish without sending.',
        'If the compose UI is unclear, call look_up_how_to, then try again. If still stuck, call ask_clarification.',
      ].join('\n');
      return {
        ok: true,
        kind: 'adjuster_status',
        instructions,
        startUrl: mailLogin.login.url,
        matchedLogin: mailLogin,
        lead: `Opening ${label} to email ${adjuster.name || 'the adjuster'} for a status update. I will check with you before anything is sent.`,
      };
    }

    // XactAnalysis
    const xaKnown = KNOWN_COMPUTER_SITES.find((x) => x.aliases.includes('xactanalysis')) ?? null;
    const xaLogin =
      matchSavedLogin(input.logins, {
        ...command,
        known: xaKnown,
        siteMention: 'xactanalysis',
        kind: 'website',
      }) ?? null;
    if (!xaLogin) {
      return {
        ok: false,
        offerLogins: true,
        summary:
          "I can message the adjuster in XactAnalysis once Computer is signed in. Open Logins in the sidebar, add XactAnalysis, and save the password (or sign in once). Then ask me again.",
      };
    }
    const host = xaLogin.login.host;
    const label = xaLogin.login.label || 'XactAnalysis';
    const instructions = [
      `Open ${label} (${host}). Call sign_in_saved with site "${host}" if you hit a sign-in page.`,
      'Find THIS claim / assignment using:',
      ...ids.map((l) => `• ${l}`),
      adjuster.name ? `• Adjuster: ${adjuster.name}` : '',
      '',
      'Open the message / note / assignment thread for this adjuster on this claim.',
      'Compose a short professional status-update request (plain English, no slang, no emoji). Suggested text:',
      '---',
      statusBody,
      '---',
      `Adjuster identity came from ${adjuster.source}.`,
      'Call request_approval before any Send, Submit, or Post control. Never send without approval.',
      'If the UI is unclear, call look_up_how_to for XactAnalysis messaging, then continue. If still stuck, call ask_clarification.',
      'End with finish: title "Adjuster status request", fields = claim id + adjuster + channel XactAnalysis, submitted = true only if an approved send went through, notes = short professional summary.',
    ]
      .filter(Boolean)
      .join('\n');
    return {
      ok: true,
      kind: 'adjuster_status',
      instructions,
      startUrl: xaLogin.login.url,
      matchedLogin: xaLogin,
      lead: `Opening ${label} to message ${adjuster.name || 'the adjuster'} for a status update. I will check with you before anything is sent.`,
    };
  }

  // ---- Xactimate estimate (sketch → export → build inside Xactimate Online) ----
  if (command.kind === 'xactimate_estimate') {
    const xactKnown = KNOWN_COMPUTER_SITES.find((x) => x.host.includes('xact')) ?? null;
    const xactLogin =
      matched?.login.host.includes('xact') || matched?.login.label.toLowerCase().includes('xact')
        ? matched
        : matchSavedLogin(input.logins, {
            ...command,
            known: xactKnown,
            siteMention: 'xactimate',
            kind: 'website',
          });
    if (!xactLogin) {
      return {
        ok: false,
        offerLogins: true,
        summary:
          "I can build this estimate inside Xactimate once Computer is signed in. Open Logins in the sidebar, add Xactimate (Xactware Online), and save the password (or sign in once). Then ask me again.",
      };
    }

    const sketchLogins = listSketchProviderLogins(input.logins);
    const sketchMatch = matchSketchProviderLogin(input.logins, command.question, input.file);
    const mentionsSketch = jobMentionsSketch(input.file, command.question);

    if (!sketchLogins.length) {
      return {
        ok: false,
        offerLogins: true,
        summary:
          "To build this estimate I need the job's sketch first. Open Logins in the sidebar and add your sketch or measurement provider (DocuSketch, CompanyCam, Hover, EagleView, magicplan, or whichever you use), then ask me again. I will pull the sketch, send it into Xactimate, and build the estimate from those quantities.",
      };
    }
    if (!sketchMatch) {
      const names = sketchLogins.map((l) => l.label || l.host).join(', ');
      return {
        ok: false,
        offerLogins: false,
        needsClarification: true,
        summary: `Which sketch provider should I use for this job? You have ${names} saved. Tell me which one has this job's sketch (or add the right one under Logins).`,
      };
    }
    if (!mentionsSketch && !Object.values(input.file?.facts ?? {}).some((v) => /sketch|esx|measurement/i.test(String(v)))) {
      // Still proceed when a single provider is saved — Computer will search that account.
      // If the person named no sketch and we cannot guess, ask once when zero identifiers for the job.
      if (!jobIdentifiers(input.file, input.address).length) {
        return {
          ok: false,
          offerLogins: false,
          needsClarification: true,
          summary:
            "I need a claim number, address, or insured name on this job to find the right sketch, and confirmation that a sketch exists. Add those on the job file or tell me which sketch to open.",
        };
      }
    }

    const scopeLines = buildXactimateScopeLines(input.file, input.address);
    const chatPreview = formatXactimateScopeForChat(scopeLines);
    const xactHost = xactLogin.login.host;
    const xactLabel = xactLogin.login.label || 'Xactimate';
    const sketchHost = sketchMatch.login.host;
    const sketchLabel = sketchMatch.login.label || sketchHost;
    const ids = jobIdentifiers(input.file, input.address);

    const instructions = [
      'Mission: build a complete working estimate INSIDE Xactimate Online for this job. Follow these steps in order. Do not skip ahead.',
      '',
      'STEP 1 — Get the job sketch from the sketch / measurement provider',
      `Open ${sketchLabel} (${sketchHost}). Call sign_in_saved with site "${sketchHost}" if you hit a sign-in page.`,
      'Find THIS job\'s sketch or measurement project using:',
      ...ids.map((l) => `• ${l}`),
      'Open the sketch for this property only. If you cannot find a sketch, call ask_clarification (do not invent rooms or quantities).',
      '',
      'STEP 2 — Send or export the sketch into Xactimate and pull room quantities',
      'Use the provider\'s built-in Xactimate / Xactware integration if it offers one (Send to Xactimate, Export to Xactimate, or similar).',
      'If there is no direct integration, export an ESX (or the provider\'s Xactimate-compatible file) and import it in Xactimate Online.',
      `Call request_approval before any Send to Xactimate, Export to Xactimate, or similar control that transmits the sketch. Never send or export without approval.`,
      'After the sketch is in Xactimate (or opened alongside), record room quantities from the sketch: SF walls, SF ceiling, SF floor, LF of walls/trim, and any roof squares or other measurements the sketch provides. Prefer sketch quantities over guesses.',
      '',
      'STEP 3 — Build the estimate inside Xactimate Online',
      `Open ${xactLabel} (${xactHost}) if you are not already there. Call sign_in_saved with site "${xactHost}" when you reach its sign-in page.`,
      'Create or open the project for THIS job only. Match it with the same identifiers above.',
      'Enter rooms, line items, and quantities from: (a) the sketch quantities you pulled, (b) footage findings and field capture on the job, (c) CRM / job-file scope and facts, and (d) the industry-standard scaffold rows below when they fit. Do not invent prices or coverage decisions.',
      'Line items / scope to enter (sketch quantities win when they conflict with scaffold guesses):',
      formatXactimateScopeForInstructions(scopeLines),
      '',
      'If a provider UI, ESX export, or Xactimate price-list step is unclear, call look_up_how_to for that site and step, then continue on the live page.',
      'If you are still stuck, call ask_clarification with one clear professional question.',
      'Call request_approval before any Save, Complete, Finalize, Submit, or similar control that commits the estimate. Never save or finalize without approval.',
      'Stay in the browser (Xactimate Online and the sketch provider). Do not download a desktop-only installer unless the site itself requires a page it opens.',
      'Writing quality: plain professional English — no slang, no emoji, no scraped junk.',
      'End with finish: title "Estimate in Xactimate", fields = sketch source + each major room or line item entered (label + quantity), submitted = true only if an approved save/finalize went through, notes = short professional summary including whether the sketch was sent in and what still needs the person.',
    ].join('\n');

    return {
      ok: true,
      kind: 'xactimate_estimate',
      instructions,
      startUrl: sketchMatch.login.url,
      matchedLogin: sketchMatch,
      lead: [
        `Opening ${sketchLabel} first to get this job's sketch, then I will send it into ${xactLabel} and build the estimate there.`,
        chatPreview,
        'I will check with you before sending the sketch into Xactimate and before saving or finalizing the estimate.',
      ].join('\n\n'),
    };
  }

  // ---- CRM notes (before read-only crm_status) ----
  if (isCrmNotesIntent(command.question)) {
    if (!matched) {
      const note = jobSummaryForEmail(input.file, input.address);
      return {
        ok: false,
        offerLogins: true,
        needsClarification: true,
        summary: [
          command.known?.kind === 'crm'
            ? `I don't have a saved login for ${command.known.aliases[0]} yet. Open Logins in the sidebar, add it, then ask me again.`
            : 'Which CRM should I open (AccuLynx, JobNimbus, ServiceTitan, Salesforce, or another site under Logins)?',
          'I will not start a blank browser until a CRM Login is ready.',
          note ? `Exact note draft I would enter once you Approve:\n---\n${note}\n---` : null,
        ]
          .filter(Boolean)
          .join('\n\n'),
      };
    }
    const host = matched.login.host;
    const label = matched.login.label || host;
    const note = jobSummaryForEmail(input.file, input.address);
    const instructions = [
      `Open ${label} (${host}) and find THIS job's record using these identifiers:`,
      ...(ids.length ? ids.map((l) => `• ${l}`) : ['• (use the job title / address from the job file)']),
      '',
      'Open the notes / activity / comments field for this job.',
      'Draft this exact note (tidy line breaks only; do not invent facts):',
      '---',
      note || command.question.trim(),
      '---',
      `Call sign_in_saved with site "${host}" if you hit a sign-in page.`,
      'Call request_approval with the exact Save / Update / Post button label before clicking it. Never save the note without approval.',
      'If you cannot find the record or the notes field, call ask_clarification with one clear question.',
      'End with finish after an approved save, or without saving if they decline.',
    ].join('\n');
    return {
      ok: true,
      kind: 'crm_status',
      instructions,
      startUrl: matched.login.url,
      matchedLogin: matched,
      lead: `Opening ${label} to draft the CRM note. I will check with you before anything is saved.`,
    };
  }

  // ---- CRM outstanding / paperwork ----
  if (command.kind === 'crm_status') {
    const crmName = command.known?.aliases[0] ?? command.siteMention ?? 'that CRM';
    if (!matched) {
      return {
        ok: false,
        offerLogins: true,
        summary: `I don't have a saved login for ${crmName} yet. Open Logins in the sidebar, add it and sign in (you can save the password so Computer signs back in on its own). Then ask me again.`,
      };
    }
    if (!ids.length) {
      return {
        ok: false,
        offerLogins: false,
        needsClarification: true,
        summary:
          "I need a claim number, address, or insured name on this job to find the right CRM record. Add one on the job file, or tell me which record to open.",
      };
    }
    const host = matched.login.host;
    const label = matched.login.label || host;
    const instructions = [
      `Open ${label} (${host}) and find THIS job's record using these identifiers (do not open a different job):`,
      ...ids.map((l) => `• ${l}`),
      '',
      'Once on the right record, review paperwork / documents / tasks / checklist items.',
      'Separate what is COMPLETED from what is still OUTSTANDING (missing, pending, not signed, not uploaded, not approved).',
      'FLAG anything that looks overdue, missing, blocked, or needing attention. Use plain Flag lines, for example:',
      '• Flag: Certificate of completion not signed',
      '• Flag: Estimate not uploaded',
      '• Flag: Photo packet incomplete',
      '',
      `Call sign_in_saved with site "${host}" if you hit a sign-in page.`,
      'Do not change, upload, submit, send, or delete anything. This is a read-and-report pass only.',
      'If the UI is unclear, call look_up_how_to for this CRM and the goal (find job paperwork status), then continue.',
      'If you still cannot find the record or tell status apart, call ask_clarification with one clear question.',
      'End with finish: title like "CRM status", fields = each outstanding or completed item (short plain labels + value such as "outstanding" / "done"), notes = a short plain summary a careful office admin would write, and list every Flag in notes.',
      'Writing rules for Chat report, notes, and Flag lines: plain English, professional, no slang, no emoji, no raw page scrape text, no internal error codes or technical labels. Lead with the answer. Example Flag: "Flag: Certificate of completion not signed".',
    ].join('\n');
    return {
      ok: true,
      kind: 'crm_status',
      instructions,
      startUrl: matched.login.url,
      matchedLogin: matched,
      lead: `Opening ${label} to check what's outstanding on this job. I'll report back in Chat and flag anything that needs attention.`,
    };
  }

  // ---- Named website without a Login ----
  if (namedSite && !matched && (command.kind === 'website' || command.known?.kind === 'crm')) {
    const name = command.known?.aliases[0] ?? command.siteMention ?? 'that site';
    return {
      ok: false,
      offerLogins: true,
      summary: `I don't have a saved login for ${name} yet. Open Logins in the sidebar, add it and sign in (you can save the password so Computer signs back in on its own). Then ask me again.`,
    };
  }

  // ---- Unnamed CRM notes: ask which CRM; never open a blank browser ----
  if (
    (command.kind === 'generic' || command.kind === 'website') &&
    isCrmNotesIntent(command.question) &&
    !matched
  ) {
    const named = Boolean(command.known?.kind === 'crm' || (command.siteMention && !isUnnamedCrmIntent(command.question)));
    if (!named || isUnnamedCrmIntent(command.question)) {
      const note = jobSummaryForEmail(input.file, input.address);
      return {
        ok: false,
        offerLogins: true,
        needsClarification: true,
        summary: [
          'Which CRM should I open (AccuLynx, JobNimbus, ServiceTitan, Salesforce, or another site under Logins)?',
          'I will not start a blank browser until I know which one.',
          note
            ? `Exact note draft I would enter once you pick a CRM and Approve:\n---\n${note}\n---`
            : null,
          'Add that CRM under Logins if it is not there yet, then ask me again.',
        ]
          .filter(Boolean)
          .join('\n\n'),
      };
    }
  }

  // ---- Generic website / fill ----
  const parts = [command.question.trim()];
  if (matched) {
    parts.push(
      `Use the saved login for ${matched.login.label} (${matched.login.host}): call sign_in_saved with site "${matched.login.host}" when you reach its sign-in page.`,
    );
  }
  if (ids.length) {
    parts.push(
      'Use these job-file values when filling fields (do not invent others):\n' + ids.map((l) => `• ${l}`).join('\n'),
    );
  }
  if (command.wantsSummary && input.file) {
    parts.push('Job summary you may use when describing status:\n' + jobSummaryForEmail(input.file, input.address));
  }
  parts.push(
    'If a required field (claim number, address, insured name, email) is missing from the list above, call ask_clarification instead of guessing.',
    'Call request_approval before any submit, send, pay, sign, delete or upload click. Never skip that.',
    'If the next step on the site is unclear, call look_up_how_to for that site and goal, then continue. If you are still stuck, call ask_clarification with one clear question.',
    'Any text you leave on the site or report back in Chat must read professionally: plain English, no slang, no emoji, no scraped junk.',
  );

  const startUrl =
    matched?.login.url ??
    command.known?.url ??
    (command.siteMention && !command.siteMention.includes(' ')
      ? command.siteMention.startsWith('http')
        ? command.siteMention
        : `https://${command.siteMention}`
      : null);

  // Never open an empty-URL browser for CRM-notes-shaped asks.
  if (isCrmNotesIntent(command.question) && !startUrl) {
    return {
      ok: false,
      offerLogins: true,
      needsClarification: true,
      summary:
        'Which CRM should I open? Add it under Logins (AccuLynx, JobNimbus, ServiceTitan, Salesforce, …), then ask me again. I will not start a blank browser.',
    };
  }

  return {
    ok: true,
    kind: command.kind,
    instructions: parts.join('\n\n'),
    startUrl,
    matchedLogin: matched,
    lead: matched
      ? `Opening ${matched.login.label} now, and I'll check with you before anything is submitted.`
      : "Opening a browser now, and I'll check with you before anything is submitted.",
  };
}
