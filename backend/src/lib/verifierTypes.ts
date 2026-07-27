/**
 * The vocabulary the verifier reasons in.
 *
 * The whole subsystem turns on one distinction: an *expectation* is what the
 * work was supposed to produce, and a *finding* is what the site actually
 * shows. Keeping them as separate values — derived at different times, from
 * different sources, by different model calls — is what stops the check from
 * quietly collapsing into "the first agent said it went fine".
 */

/** What kind of claim an expectation makes about the site. */
export type ExpectationKind =
  /** A record matching these identifiers should now be findable. */
  | 'record_exists'
  /** A record that already existed should now carry these values. */
  | 'field_value'
  /** Something should NOT be present — a cancellation, a withdrawal. */
  | 'record_absent'
  /** A status, flag, or stage should now read a particular way. */
  | 'state_change'
  /** Rows the first agent reported reading should match what the site shows. */
  | 'reported_data_matches';

export interface Expectation {
  /** Stable within one verification: e1, e2, … Findings refer back by this. */
  id: string;
  kind: ExpectationKind;
  /** One plain sentence a person could check by hand. */
  description: string;
  /** Where on the site to look, in the site's own words. A hint, not a URL. */
  where: string;
  /** The fields that locate the record — a claim number, a date, a name. */
  identifiers: Record<string, string>;
  /** The values that must hold once located. */
  expected: Record<string, string>;
  /**
   * False for detail the instruction mentioned in passing. A violated
   * non-critical expectation is reported but does not by itself condemn the
   * run, which keeps the verifier from calling a good run bad over a
   * formatting difference.
   */
  critical: boolean;
}

/** The three ways a check can come out. There is deliberately no fourth. */
export type Verdict = 'satisfied' | 'violated' | 'indeterminate';

export interface Finding {
  expectationId: string;
  verdict: Verdict;
  /**
   * What was actually on the page — quoted, not summarised. A verdict without
   * this is an assertion, and the point of the verifier is to not be one.
   */
  evidence: string;
  /** Where the evidence was read. */
  url: string;
  /** Why this verdict, in one or two sentences. */
  reasoning: string;
  /**
   * Present only when violated: what would put it right, and whether doing so
   * is safe to attempt without asking.
   */
  repair?: RepairProposal;
}

/**
 * How a violation could be fixed, and — the part that matters — whether the
 * verifier is allowed to fix it on its own.
 *
 * The dividing line is destruction. Creating a missing record or correcting a
 * field the task already specified only completes work that was authorised.
 * Removing a duplicate, voiding an entry, or reconciling two conflicting
 * records destroys something a person may be relying on, and no amount of
 * model confidence makes that reversible. Those go to a human.
 */
export type RepairClass =
  /** The record is missing entirely — re-doing the original work is the fix. */
  | 'create_missing'
  /** The record is there with a wrong value the task specified. */
  | 'correct_value'
  /** Fixing it needs a deletion, a de-duplication, or a judgement call. */
  | 'needs_human';

export interface RepairProposal {
  repairClass: RepairClass;
  /**
   * What to do, written as an instruction for the first agent to carry out.
   * Scoped to this one violation — never "redo the run".
   */
  instruction: string;
  /** Why this is or is not safe to do unattended. */
  rationale: string;
}

/** One step in the verifier's own browse trace, mirroring the run's shape. */
export interface VerifierStep {
  index: number;
  action: string;
  detail: string;
  url: string;
  /** 'observe' while checking, 'repair' while putting something right. */
  phase: 'observe' | 'repair';
  error?: string;
}

/** The result of one observation pass over the site. */
export interface ObservationOutcome {
  verdict: Verdict;
  findings: Finding[];
  steps: VerifierStep[];
  summary: string;
}

/** Why the verifier stopped and asked a person. */
export type EscalationReason =
  | 'indeterminate'
  | 'unsafe_repair'
  | 'repair_exhausted'
  | 'repair_failed';

/**
 * A choice offered to the human resolving an escalation. `action` is what the
 * verifier does with the answer, so the person is picking an outcome rather
 * than composing a prompt for an agent.
 */
export interface EscalationOption {
  id: string;
  label: string;
  detail: string;
  action: EscalationAction;
}

export type EscalationAction =
  /** Carry out the attached instruction against the site, then re-check. */
  | 'repair'
  /** The work is fine as it stands; close the verification as verified. */
  | 'accept'
  /** The work is genuinely wrong and a human will handle it off-system. */
  | 'reject'
  /** Look again — useful when the person has just changed something. */
  | 'recheck';

export const ESCALATION_ACTIONS: readonly EscalationAction[] = [
  'repair',
  'accept',
  'reject',
  'recheck',
] as const;
