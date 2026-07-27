/**
 * The connector contract.
 *
 * A connector's only job is to hand back records from an external application,
 * verbatim. It does not map fields, rename anything, or decide what a record
 * means — the mirror stores exactly what the vendor returned, and normalising
 * into our CRM happens later, separately, and reversibly.
 *
 * That split is what makes the mirror trustworthy: when a mapping turns out to
 * be wrong, the original is still sitting there to re-derive from. A connector
 * that "helpfully" reshapes on the way in destroys the thing being backed up.
 */

export interface ExternalRecord {
  /** The vendor's own vocabulary: 'claim', 'estimate', 'customer', 'invoice'. */
  entityType: string;
  /** The vendor's primary key. Stable across syncs, or the mirror will duplicate. */
  externalId: string;
  /** The record exactly as received. */
  payload: Record<string, unknown>;
  /** When the vendor says it last changed, if it says. */
  sourceUpdatedAt?: string | null;
}

export interface FetchContext {
  /** Non-secret settings from the source row. */
  config: Record<string, unknown>;
  /**
   * The resolved credential, if the source names one. Read from the server
   * environment — it is never stored in, or read from, the database.
   */
  credential: string | null;
  /** Where the last run stopped, for incremental pulls. */
  cursor: string | null;
  /** Hard ceiling for this run; the connector must stop when it is reached. */
  maxRecords: number;
  signal: AbortSignal;
}

export interface FetchResult {
  records: ExternalRecord[];
  /** Cursor to resume from next time, or null for a full re-read each run. */
  nextCursor: string | null;
  /** True when the connector stopped early at maxRecords. */
  truncated: boolean;
}

export interface Connector {
  readonly kind: string;
  fetch(ctx: FetchContext): Promise<FetchResult>;
}
