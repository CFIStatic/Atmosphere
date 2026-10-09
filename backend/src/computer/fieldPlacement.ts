/**
 * Right value, right field. Before Computer types into a form, every value
 * must come from somewhere the person gave it (this job's fields or their own
 * words in Chat), and the field's label must fit that kind of value: a claim
 * number does not go into "Policy number", an email does not go into "Phone".
 * Decided in code from the page's own labels, not from what the model says.
 */
import { toChecked, toIsoDate } from './fieldValues.js';
import type { ProjectedJobField } from './types.js';

type Kind = 'claim' | 'policy' | 'job_number' | 'email' | 'phone' | 'zip' | 'date' | 'amount' | 'address' | 'name';

/** What a field label asks for. Order matters only for readability; a label can match several. */
const LABEL_KINDS: Array<[Kind, RegExp]> = [
  ['claim', /\bclaim\b/],
  ['policy', /\bpolicy\b/],
  ['job_number', /\b(job|work ?order|project|invoice|po|purchase order)\s*(#|no\.?|num(ber)?|id)\b/],
  ['email', /\be-?mail\b/],
  ['phone', /\b(phone|mobile|cell|tel|telephone|fax)\b/],
  ['zip', /\b(zip|postal|post ?code)\b/],
  ['date', /\b(date|dob|born|when)\b/],
  ['amount', /\b(amount|deductible|total|price|cost|rcv|acv|\$|usd|payment)\b/],
  ['address', /\b(address|street|addr)\b/],
  ['name', /\b(name|insured|policyholder|homeowner|customer|client|adjuster|contact|owner)\b/],
];

function labelKinds(label: string): Set<Kind> {
  const l = label.toLowerCase().replace(/[_*:]+/g, ' ');
  return new Set(LABEL_KINDS.filter(([, re]) => re.test(l)).map(([k]) => k));
}

/** What kind of value a source field is, from its key and label. */
function sourceKind(field: ProjectedJobField): Kind | null {
  const k = `${field.key} ${field.label}`.toLowerCase();
  if (/claimnumber|claim number/.test(k)) return 'claim';
  if (/policynumber|policy number/.test(k)) return 'policy';
  if (/jobnumber|job number/.test(k)) return 'job_number';
  if (/email/.test(k)) return 'email';
  if (/phone/.test(k)) return 'phone';
  if (/date|year built/.test(k)) return 'date';
  if (/deductible|amount/.test(k)) return 'amount';
  if (/address/.test(k)) return 'address';
  if (/name|insured|policyholder|homeowner|customer|client|adjuster|owner/.test(k)) return 'name';
  return null;
}

/** What kind of value this looks like on its own (for values from the person's message). */
function valueKind(value: string): Kind | null {
  const v = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) return 'email';
  if (toIsoDate(v)) return 'date';
  if (/^\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test(v)) return 'phone';
  return null;
}

/** Kinds that must never be swapped: a value of one kind in a field asking only for another. */
const STRICT: ReadonlySet<Kind> = new Set(['claim', 'policy', 'job_number', 'email', 'phone', 'zip', 'date']);

function norm(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function core(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface Placement {
  ok: boolean;
  /** Where the value came from, in words for people ("Job: Claim number", "Your message in Chat"). */
  source: string | null;
  /** Why it was refused, for the agent. */
  problem?: string;
}

/**
 * Check one value for one field. Choice values (checked / unchecked / yes / no)
 * need no source; everything typed does.
 */
export function checkPlacement(input: {
  label: string;
  value: string;
  projection: ProjectedJobField[];
  instructions: string;
}): Placement {
  const value = input.value.trim();
  const label = input.label.trim();
  if (!value) return { ok: false, source: null, problem: 'nothing to fill in' };
  if (toChecked(value) != null) return { ok: true, source: 'Choice' };

  // 1. Where did it come from? Whole value first, then a part of one (city or ZIP from the address).
  const n = norm(value);
  const c = core(value);
  const iso = toIsoDate(value);
  let from: ProjectedJobField | null =
    input.projection.find((f) => norm(f.value) === n) ??
    input.projection.find((f) => c.length >= 4 && core(f.value) === c) ??
    (iso ? (input.projection.find((f) => toIsoDate(f.value) === iso) ?? null) : null);
  let source: string | null = from ? from.source : null;
  if (!from && n.length >= 2) {
    const part = input.projection.find((f) => ` ${norm(f.value)} `.includes(` ${n} `));
    if (part) {
      from = part;
      source = `${part.source} (part)`;
    }
  }
  const said = ` ${norm(input.instructions)} `;
  if (!source && n && (said.includes(` ${n} `) || (c.length >= 4 && core(input.instructions).includes(c)))) source = 'Your message in Chat';
  if (!source && iso && (input.instructions.match(/[\w/.,-]+(?:\s+\d{1,2},?\s+\d{4})?/g) ?? []).some((w) => toIsoDate(w) === iso)) {
    source = 'Your message in Chat';
  }
  if (!source) {
    return {
      ok: false,
      source: null,
      problem: `“${value.slice(0, 60)}” is not in this job's fields or the person's message. Leave “${label.slice(0, 60)}” blank, or ask the person.`,
    };
  }

  // 2. Does the field ask for this kind of value? Only a clear clash counts.
  const kind = (from && !source.endsWith('(part)') ? sourceKind(from) : null) ?? valueKind(value);
  const wants = labelKinds(label);
  if (kind && wants.size && !wants.has(kind)) {
    const clash = [...wants].find((w) => STRICT.has(w) || STRICT.has(kind));
    // Names and addresses overlap with many labels ("Insured address"); only flag strict kinds.
    if (clash && (STRICT.has(kind) || STRICT.has(clash)) && !(kind === 'name' && wants.has('address')) && !(kind === 'address' && wants.has('name'))) {
      return {
        ok: false,
        source,
        problem: `“${label.slice(0, 60)}” looks like it asks for ${describe(clash)}, but this value is ${describe(kind)} (${source}). Find the field for ${describe(kind)}, or ask the person.`,
      };
    }
  }
  return { ok: true, source };
}

function describe(kind: Kind): string {
  return {
    claim: 'a claim number',
    policy: 'a policy number',
    job_number: 'a job or order number',
    email: 'an email address',
    phone: 'a phone number',
    zip: 'a ZIP code',
    date: 'a date',
    amount: 'an amount',
    address: 'an address',
    name: 'a name',
  }[kind];
}
