import { inferPattern, candidateEmails, splitName, type KnownAddress } from './patterns.js';
import { verifyEmail } from './verification.js';
import { buildMailboxVerifier } from './verifiers/index.js';
import { buildPhoneVerifier } from './phone/index.js';
import { config } from '../config.js';
import type { ContactSource } from './sources/ports.js';

/**
 * The "does this actually work?" tool.
 *
 * Every question asked of this feature eventually reduces to one thing: is the
 * data real. A search result cannot answer that — it looks identical whether
 * the pipeline found a verified mailbox or a vendor made an assertion nobody
 * checked. So this runs the whole thing against a name and a company you
 * choose and reports what each stage actually did: which sources answered,
 * what evidence they produced, what convention was inferred from it, which
 * addresses were tried, and what the mail server said about each one.
 *
 * The right way to use it is on yourself. You already know your own work
 * address, so a run against your own name and domain tells you immediately
 * whether the pipeline works — and if it comes back with nothing, the trace
 * says which stage was empty rather than leaving you guessing.
 *
 * Addresses come back masked. This runs the same expensive machinery a reveal
 * runs, so returning them in full would be an unbilled reveal with extra
 * steps — and a masked address is still enough to recognise one you know.
 * Nothing here is ever written to the CRM or charged for.
 */

export interface DiagnosisStage {
  name: string;
  /** Addresses this source published at the domain, usable as evidence. */
  evidenceFound: number;
  /** Whether this source held the person outright. */
  directHit: boolean;
  ms: number;
  note?: string;
}

export interface DiagnosisCandidate {
  /** m****@acme.com — enough to recognise, not enough to use unbilled. */
  masked: string;
  verdict: string;
  reason: string;
  verifier: string | null;
}

export interface Diagnosis {
  fullName: string;
  companyDomain: string;
  nameUsable: boolean;
  stages: DiagnosisStage[];
  evidenceTotal: number;
  inferredPattern: string | null;
  patternSupport: number;
  patternConfidence: number | null;
  candidates: DiagnosisCandidate[];
  /** The address the pipeline would have sold, masked. Null when none. */
  wouldReturn: string | null;
  wouldReturnSource: string | null;
  /** What is configured, so a null result can be explained rather than guessed at. */
  mailboxVerifier: string | null;
  phoneVerifier: string | null;
  sellUnverified: boolean;
  /** Plain-language account of why the run ended where it did. */
  summary: string;
}

/** m****@acme.com. Recognisable to someone who knows it, useless to anyone else. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '****';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(local.length - 1, 3))}@${domain}`;
}

export async function diagnose(
  fullName: string,
  companyDomain: string,
  sources: ContactSource[],
  orgKnownAddresses: KnownAddress[] = [],
): Promise<Diagnosis> {
  const domain = companyDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const mailboxVerifier = buildMailboxVerifier();
  const phoneVerifier = buildPhoneVerifier();

  const base: Diagnosis = {
    fullName,
    companyDomain: domain,
    nameUsable: Boolean(splitName(fullName)),
    stages: [],
    evidenceTotal: orgKnownAddresses.length,
    inferredPattern: null,
    patternSupport: 0,
    patternConfidence: null,
    candidates: [],
    wouldReturn: null,
    wouldReturnSource: null,
    mailboxVerifier: mailboxVerifier?.name ?? null,
    phoneVerifier: phoneVerifier?.name ?? null,
    sellUnverified: config.prospecting.sellUnverified,
    summary: '',
  };

  if (!base.nameUsable) {
    return {
      ...base,
      summary:
        'That name cannot be split into a first and last name, so no address can be constructed from it.',
    };
  }
  if (!domain || !domain.includes('.')) {
    return { ...base, summary: 'A company domain is needed — inference is per company.' };
  }

  // ---- Run each source, timing it, and collect the evidence ---------------
  const evidence: KnownAddress[] = [...orgKnownAddresses];
  let directHitFrom: string | null = null;
  let directHitEmail: string | null = null;

  for (const source of sources) {
    const started = Date.now();
    let published: KnownAddress[] = [];
    let note: string | undefined;
    try {
      published = await source.addressesAt(domain);
    } catch (err) {
      note = err instanceof Error ? err.message : 'source failed';
    }

    let directHit = false;
    if (!directHitFrom) {
      try {
        const hit = await source.find(fullName, domain);
        if (hit?.email) {
          directHit = true;
          directHitFrom = source.name;
          directHitEmail = hit.email;
        }
      } catch {
        /* a source that cannot answer is not a failure worth surfacing twice */
      }
    }

    for (const entry of published) {
      if (!evidence.some((e) => e.email.toLowerCase() === entry.email.toLowerCase())) {
        evidence.push(entry);
      }
    }

    base.stages.push({
      name: source.name,
      evidenceFound: published.length,
      directHit,
      ms: Date.now() - started,
      note,
    });
  }

  base.evidenceTotal = evidence.length;

  // ---- What convention does the evidence support? -------------------------
  const inferred = inferPattern(evidence, domain);
  base.inferredPattern = inferred?.pattern ?? null;
  base.patternSupport = inferred?.support ?? 0;
  base.patternConfidence = inferred?.confidence ?? null;

  // ---- Verify the direct hit first, then the inferred candidates ----------
  const toCheck: string[] = [];
  if (directHitEmail) toCheck.push(directHitEmail);
  for (const candidate of candidateEmails(fullName, domain, evidence, config.prospecting.maxPatternCandidates)) {
    if (!toCheck.includes(candidate)) toCheck.push(candidate);
  }

  for (const candidate of toCheck) {
    const result = await verifyEmail(candidate);
    base.candidates.push({
      masked: maskEmail(candidate),
      verdict: result.verdict,
      reason: result.reason,
      verifier: result.verifier,
    });

    const sellable =
      result.verdict === 'valid' ||
      (result.verdict === 'risky' && result.catchAll) ||
      (result.verdict === 'unknown' && config.prospecting.sellUnverified);

    if (sellable && !base.wouldReturn) {
      base.wouldReturn = maskEmail(candidate);
      base.wouldReturnSource =
        candidate === directHitEmail ? (directHitFrom ?? 'source') : 'Pattern + verification';
    }
  }

  return { ...base, summary: explain(base) };
}

/**
 * Say why the run ended where it did.
 *
 * A bare "no result" is the least useful answer a diagnostic can give, because
 * every distinct cause looks the same from outside: no evidence, no
 * convention, a dead mailbox, or simply nothing configured to check with.
 */
function explain(d: Diagnosis): string {
  if (d.wouldReturn) {
    const how =
      d.wouldReturnSource === 'Pattern + verification'
        ? `inferred from ${d.patternSupport} known ${d.patternSupport === 1 ? 'address' : 'addresses'} at ${d.companyDomain} using ${d.inferredPattern}`
        : `held directly by ${d.wouldReturnSource}`;
    const checked = d.mailboxVerifier
      ? `confirmed by ${d.mailboxVerifier}`
      : 'NOT confirmed — no mailbox verifier is configured';
    return `Would return ${d.wouldReturn} — ${how}, ${checked}.`;
  }

  if (!d.evidenceTotal) {
    return `No addresses are known at ${d.companyDomain}, from your CRM or any source. Inference will not guess at a domain with no evidence, so there is nothing to build a candidate from. Connect a source, or add one contact at this company.`;
  }
  if (!d.inferredPattern) {
    return `Found ${d.evidenceTotal} ${d.evidenceTotal === 1 ? 'address' : 'addresses'} at ${d.companyDomain}, but no consistent convention among them — one address is a coincidence, and two must agree before it counts.`;
  }
  if (!d.candidates.length) {
    return `Learned the convention (${d.inferredPattern}) but produced no candidate to test, which should not happen — worth reporting.`;
  }
  if (!d.mailboxVerifier) {
    return `Built ${d.candidates.length} ${d.candidates.length === 1 ? 'candidate' : 'candidates'} using ${d.inferredPattern}, but nothing is configured to confirm a mailbox, so every one came back unknown and none can be sold. Connect ZeroBounce or NeverBounce in Contact data.`;
  }
  const verdicts = d.candidates.map((c) => c.verdict);
  if (verdicts.every((v) => v === 'invalid')) {
    return `Tried ${d.candidates.length} ${d.candidates.length === 1 ? 'candidate' : 'candidates'} using ${d.inferredPattern}; ${d.mailboxVerifier} rejected all of them. This person probably does not use the company's usual convention.`;
  }
  return `Tried ${d.candidates.length} candidates; none could be confirmed. ${d.mailboxVerifier} would not commit either way, and unconfirmed addresses are withheld rather than billed.`;
}
