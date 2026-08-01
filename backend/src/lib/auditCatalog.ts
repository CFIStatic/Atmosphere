/**
 * The registry of agents whose work the Audit tab accounts for.
 *
 * Runs store only `agent_key`. Everything an operator reads — the name, what
 * the agent does, the colour it wears in the timeline — lives here, so
 * renaming an agent is a code change rather than a migration that rewrites
 * history. It also means the Audit tab can list an agent that has never run:
 * "no runs yet" is a real answer, and it is not the same answer as an agent
 * being missing from the ledger entirely.
 *
 * `intake` records how a given agent's work reaches the ledger:
 *   • 'ledger' — the agent writes directly through lib/auditLog.ts.
 *   • 'bridge' — the agent already keeps its own run table, and a database
 *     trigger mirrors it (see db/audit_ledger.sql).
 */

export type AgentIntake = 'ledger' | 'bridge';

export interface AgentDefinition {
  key: string;
  name: string;
  blurb: string;
  /** Accent used by the Audit tab. One of the palette names the UI knows. */
  accent: 'brand' | 'neutral' | 'success' | 'caution' | 'danger';
  intake: AgentIntake;
  /** The table a bridged agent is mirrored from, for the provenance line. */
  sourceTable?: string;
}

export const AGENT_CATALOG: AgentDefinition[] = [
  {
    key: 'computer_use',
    name: 'Computer Use',
    blurb:
      'Operates a real computer on your behalf — reads the screen, moves the mouse, types, and works an application through to the end.',
    accent: 'brand',
    intake: 'ledger',
  },
  {
    key: 'web_access',
    name: 'Web Access',
    blurb:
      'Signs in to external sites — carrier portals, supplier dashboards — to pull data out of them and enter data into them.',
    accent: 'neutral',
    intake: 'bridge',
    sourceTable: 'web_runs',
  },
  {
    key: 'crm_sync',
    name: 'CRM Sync',
    blurb: 'Mirrors records from external applications into the CRM and reconciles what changed.',
    accent: 'success',
    intake: 'bridge',
    sourceTable: 'crm_sync_runs',
  },
  {
    key: 'backup',
    name: 'Backups',
    blurb: 'Snapshots the organization’s data on a schedule, then verifies the archive it wrote.',
    accent: 'caution',
    intake: 'bridge',
    sourceTable: 'backup_snapshots',
  },
  {
    key: 'field_assistant',
    name: 'Field Assistant',
    blurb:
      'Answers technicians on site, transcribes what they record, and labels what the camera sees.',
    accent: 'danger',
    intake: 'ledger',
  },
  {
    key: 'sales_agent',
    name: 'Atmosphere Outreach',
    blurb:
      'Internal GTM pipeline: researches restoration/construction buyers, finds decision-makers, runs Atmosphere product outreach, and books demos so sales can close.',
    accent: 'brand',
    intake: 'ledger',
  },
  {
    key: 'email_marketing',
    name: 'Email Marketing',
    blurb:
      'Watches weather against the CRM map and sends storm alerts plus follow-up check-ins to contacts in the path.',
    accent: 'caution',
    intake: 'ledger',
  },
  {
    key: 'cyber_defense',
    name: 'Cyber Defense',
    blurb:
      'Monitors every request, blocks hostile IPs, serves honeypot decoys, and auto-patches runtime hardening so attackers never reach real data.',
    accent: 'danger',
    intake: 'ledger',
  },
  {
    key: 'financial_agent',
    name: 'Financial Agent',
    blurb:
      'Monitors cash, receivables, and job cost for the CEO, CFO, and accountants — read-only into bank accounts and QuickBooks / online books.',
    accent: 'success',
    intake: 'ledger',
  },
  {
    key: 'project_manager',
    name: 'Project Manager',
    blurb:
      'Watches every open job for missed readings, stalled dry-outs, overdue work, and paperwork that would block the invoice.',
    accent: 'brand',
    intake: 'ledger',
  },
];

const BY_KEY = new Map(AGENT_CATALOG.map((agent) => [agent.key, agent]));

/**
 * Resolves a key to its definition, inventing a presentable one for a key the
 * catalog has not been taught yet.
 *
 * An agent that ships before its catalog entry does must still be readable in
 * the Audit tab — showing a raw key with no name is a worse failure than a
 * guessed title, and silently dropping the run would be worse than both.
 */
export function agentFor(key: string): AgentDefinition {
  const known = BY_KEY.get(key);
  if (known) return known;
  return {
    key,
    name: key
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' '),
    blurb: 'This agent is not in the catalog yet; its runs are recorded all the same.',
    accent: 'brand',
    intake: 'ledger',
  };
}

export function isKnownAgent(key: string): boolean {
  return BY_KEY.has(key);
}
