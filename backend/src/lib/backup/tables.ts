/**
 * What goes into a backup, and how each table narrows to a single org.
 *
 * This list is the contract of the whole backup system: a table missing from it
 * is a table that silently does not get backed up. Adding a table to the schema
 * without adding it here is the failure mode to watch for, so the export refuses
 * to run if it finds public tables it does not recognise (see runner.ts).
 */

export type OrgFilter =
  /** Table has an org_id column. */
  | { kind: 'org_id' }
  /** The orgs table itself — narrow on its primary key. */
  | { kind: 'id' }
  /** Narrow to the user ids of the org's members (profiles). */
  | { kind: 'member_ids'; column: string }
  /** Global table with no per-org slice; included only in platform snapshots. */
  | { kind: 'platform_only' };

export interface BackupTable {
  name: string;
  /** Column to keyset-paginate on. Must be unique and orderable. */
  cursor: string;
  orgFilter: OrgFilter;
  note?: string;
}

export const BACKUP_TABLES: BackupTable[] = [
  // ---- Identity and org membership -------------------------------------
  { name: 'orgs', cursor: 'id', orgFilter: { kind: 'id' } },
  { name: 'profiles', cursor: 'id', orgFilter: { kind: 'member_ids', column: 'id' } },
  { name: 'org_members', cursor: 'id', orgFilter: { kind: 'org_id' } },

  // ---- CRM -------------------------------------------------------------
  { name: 'crm_accounts', cursor: 'id', orgFilter: { kind: 'org_id' } },
  { name: 'crm_contacts', cursor: 'id', orgFilter: { kind: 'org_id' } },
  { name: 'crm_properties', cursor: 'id', orgFilter: { kind: 'org_id' } },
  { name: 'crm_leads', cursor: 'id', orgFilter: { kind: 'org_id' } },
  { name: 'crm_jobs', cursor: 'id', orgFilter: { kind: 'org_id' } },
  { name: 'crm_activities', cursor: 'id', orgFilter: { kind: 'org_id' } },
  { name: 'crm_counters', cursor: 'id', orgFilter: { kind: 'org_id' } },

  // ---- Mirror of external applications ---------------------------------
  { name: 'crm_external_sources', cursor: 'id', orgFilter: { kind: 'org_id' } },
  { name: 'crm_external_records', cursor: 'id', orgFilter: { kind: 'org_id' } },
  { name: 'crm_sync_runs', cursor: 'id', orgFilter: { kind: 'org_id' } },

  // ---- Change ledger ---------------------------------------------------
  // Included so a restored database can still answer "what changed and when"
  // for the period before the snapshot.
  { name: 'crm_audit_log', cursor: 'id', orgFilter: { kind: 'org_id' } },

  // ---- Email Marketing (storm outreach) --------------------------------
  { name: 'em_settings', cursor: 'id', orgFilter: { kind: 'org_id' } },
  { name: 'em_storms', cursor: 'id', orgFilter: { kind: 'org_id' } },
  { name: 'em_outreach', cursor: 'id', orgFilter: { kind: 'org_id' } },
  { name: 'em_outreach_messages', cursor: 'id', orgFilter: { kind: 'org_id' } },
  { name: 'em_checkins', cursor: 'id', orgFilter: { kind: 'org_id' } },
];

/**
 * Tables deliberately left out, with the reason. Listed explicitly so the
 * completeness check in runner.ts can tell "intentionally excluded" from
 * "someone forgot".
 */
export const EXCLUDED_TABLES: Record<string, string> = {
  // PIN hashes and device-secret hashes. They are re-enrollable in seconds and
  // worthless to a restore, but an archive is copied to laptops and object
  // stores — places the database never goes. Excluding them keeps the PIN
  // design's blast radius exactly where it was designed to be.
  device_credentials: 'Re-enrollable credentials; excluded to keep secrets out of portable archives.',

  // Backup metadata about the very archive being written. Self-referential and
  // regenerated on restore.
  backup_snapshots: 'Backup catalog — regenerated, not restored.',
  backup_snapshot_items: 'Backup catalog — regenerated, not restored.',
  backup_verifications: 'Backup catalog — regenerated, not restored.',
};
