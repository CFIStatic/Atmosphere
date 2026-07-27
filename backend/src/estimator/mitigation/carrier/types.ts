import type { Unit } from '../types.js';

/**
 * Carrier programs and their service-level agreements.
 *
 * A franchise on a national account is not free to write whatever scope the
 * documentation supports. The program agreement — negotiated between the
 * franchisor and the carrier, and binding on every franchise in the network —
 * sets the price list, whether overhead and profit is payable, what needs
 * pre-approval, how many equipment days go unquestioned, what documentation must
 * accompany the invoice, and how fast each milestone must happen.
 *
 * Estimating outside those terms is not a clever margin play. It produces
 * chargebacks, delayed payment, and eventually removal from the program, and the
 * franchise wears all three. So the SLA is treated here as a **hard constraint**
 * the estimate must satisfy, and the profitability engine optimises inside it
 * rather than around it.
 *
 * ## The one way out, and its price
 *
 * Real jobs do exceed program limits, legitimately — a structure that has not
 * reached its drying goal on the day the equipment cap expires is the obvious
 * case. The agreement is not broken silently when that happens. A rule may be
 * exceeded only through a `SlaDeviation`, which requires a written reason **and
 * evidence already in the job that supports it**. A reason with no evidence
 * behind it is an assertion, not documentation, and is rejected.
 *
 * Documented deviations are printed on the estimate, so what went to the carrier
 * says plainly which term was exceeded and why.
 */

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

/** Canonical carrier id, e.g. 'state_farm'. Lowercase snake case. */
export type CarrierId = string;

/**
 * The network the work came through. A franchise usually reaches a carrier via
 * a TPA or a national-account program rather than directly, and it is the
 * *program* that carries the terms — the same carrier can pay differently
 * depending on which network assigned the job.
 */
export type ProgramId = string;

export interface CarrierIdentification {
  carrierId: CarrierId | null;
  /** Name as it appeared in the sources, for display. */
  carrierName: string | null;
  programId: ProgramId | null;
  programName: string | null;

  /**
   * How the carrier was determined.
   *
   * `stated`   — a source named it in a dedicated field. Trustworthy.
   * `inferred` — read out of prose, a claim-number pattern, or a photo caption.
   *              Usable, but the estimate says it was inferred.
   * `unknown`  — nothing identified it. No SLA is applied, and that is itself a
   *              finding, because working a program job blind to its terms is
   *              how a franchise collects chargebacks.
   */
  confidence: 'stated' | 'inferred' | 'unknown';
  /** Evidence ids and source fields that led to the identification. */
  basis: string[];
  /** Other carriers the sources hinted at. Non-empty means a human should look. */
  alternatives: Array<{ carrierId: CarrierId; carrierName: string; basis: string }>;
}

/* ------------------------------------------------------------------ *
 * Agreement
 * ------------------------------------------------------------------ */

/**
 * A single machine-checkable term.
 *
 * Every kind here corresponds to something that actually appears in restoration
 * program agreements and that can be checked against a finished estimate. Terms
 * that cannot be checked mechanically belong in `RequiredDocumentationRule` or
 * as a narrative note, not as a fake constraint.
 */
export type SlaConstraint =
  /** The price list the program mandates. */
  | { kind: 'price_list'; priceListId: string }
  /** Whether overhead and profit is payable, and at what ceiling. */
  | { kind: 'overhead_and_profit'; allowed: boolean; maxRate?: number }
  /** A negotiated discount off list, optionally scoped to certain categories. */
  | { kind: 'rate_concession'; discountPct: number; categories?: string[] }
  /** A ceiling on one line item's quantity. */
  | { kind: 'max_quantity'; catalogKey: string; max: number; unit: Unit; per: 'job' | 'room' | 'day' }
  /** A ceiling on total equipment days before approval is needed. */
  | { kind: 'max_equipment_days'; maxDays: number }
  /** Estimates over this total need written pre-approval. */
  | { kind: 'approval_threshold'; amount: number }
  /** Codes the program does not pay, at all. */
  | { kind: 'line_item_prohibited'; catalogKeys: string[] }
  /** Documentation that must accompany the estimate or invoice. */
  | { kind: 'required_documentation'; items: string[] }
  /** A milestone that must happen within a window of first notice of loss. */
  | { kind: 'timeline'; milestone: 'contact' | 'on_site' | 'inspection' | 'estimate_submitted' | 'work_complete'; withinHours: number }
  /** How long after completion the invoice may be submitted. */
  | { kind: 'invoice_window'; withinDays: number };

export interface SlaRule {
  id: string;
  title: string;
  /**
   * The term in plain language, as summarised from the agreement.
   *
   * A summary, never a transcription — program agreements are confidential
   * contracts between the franchisor and the carrier, and this codebase is not
   * the place to reproduce one. What is stored is enough to check compliance and
   * to tell a human which clause to go read.
   */
  summary: string;
  constraint: SlaConstraint;
  /**
   * `hard`  — exceeding it without a documented deviation blocks submission.
   * `soft`  — exceeding it is flagged and reported but does not block.
   */
  severity: 'hard' | 'soft';
  /** Where in the agreement this came from, e.g. "Exhibit B §4.2". */
  sourceRef?: string;
}

export interface ProgramAgreement {
  carrierId: CarrierId;
  carrierName: string;
  programId: ProgramId;
  programName: string;
  /** Agreement version, so an estimate records which terms it was built against. */
  version: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  rules: SlaRule[];

  /** Where these terms came from and when — the provenance an audit will want. */
  source: {
    kind: 'manual' | 'portal' | 'mock';
    /** Portal URL or uploaded document name. Never a credential. */
    reference?: string;
    retrievedAt: string;
    /** Who entered or approved these terms, when entered by hand. */
    enteredBy?: string;
  };
}

/* ------------------------------------------------------------------ *
 * Deviation
 * ------------------------------------------------------------------ */

/**
 * Permission to exceed one rule, in writing, with evidence.
 *
 * `evidenceIds` is not optional and not decorative. The whole difference between
 * a documented deviation and simply ignoring the agreement is that a reviewer
 * can open the evidence and see the reason for themselves.
 */
export interface SlaDeviation {
  ruleId: string;
  /** Written justification. Goes onto the estimate verbatim. */
  reason: string;
  /** Evidence in this job that supports the reason. Must be non-empty. */
  evidenceIds: string[];
  /** Who authorised it — a named person, not a role. */
  authorizedBy?: string;
  authorizedAt?: string;
  /**
   * True when the agent proposed this deviation from evidence it found, rather
   * than a human entering it. Proposals are never auto-applied; they are
   * surfaced for someone to accept, because agreeing to exceed a carrier's terms
   * is a commercial decision and not a computation.
   */
  proposed?: boolean;
}

/* ------------------------------------------------------------------ *
 * Compliance
 * ------------------------------------------------------------------ */

export type SlaStatus =
  | 'met'
  | 'violated'
  /** Exceeded, but with a written, evidence-backed deviation on file. */
  | 'deviation_documented'
  /** Within terms, but the program requires written approval before proceeding. */
  | 'approval_required'
  | 'not_applicable'
  /** The sources do not answer whether this term is satisfied. */
  | 'undetermined';

export interface SlaCheck {
  ruleId: string;
  title: string;
  status: SlaStatus;
  severity: SlaRule['severity'];
  detail: string;
  /** What to do about it. */
  remedy?: string;
  /** Dollar effect of bringing the estimate into compliance. Negative = comes off. */
  revenueImpact?: number;
  /** The deviation that excused this, when one applied. */
  deviation?: SlaDeviation;
  sourceRef?: string;
}

export interface SlaComplianceReport {
  identification: CarrierIdentification;
  /** Null when no agreement could be resolved — the estimate says so loudly. */
  agreement: ProgramAgreement | null;
  checks: SlaCheck[];
  met: number;
  violated: number;
  deviations: number;
  /** Deviations the agent found grounds for but a human has not accepted. */
  proposedDeviations: SlaDeviation[];
  /**
   * True when an unexcused breach of a `hard` rule is present. The push route
   * refuses to write an estimate into Xactimate while this is set.
   */
  blocksSubmission: boolean;
  summary: string;
}
