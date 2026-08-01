import type { SupabaseClient } from '@supabase/supabase-js';
import { formatCents, totalCashCents } from './jobCost.js';
import { loadOrgSnapshot } from './snapshot.js';
import { listAlerts } from './store.js';
import type { FinanceSnapshot } from './types.js';

/**
 * Builds the frozen payloads a third party (bank, insurer, investor) reads:
 * a financial report and a company narrative (how the shop works, who does what).
 */

export interface ShareSections {
  executiveSummary: boolean;
  companyOverview: boolean;
  teamAndRoles: boolean;
  howWeWork: boolean;
  cashPosition: boolean;
  accountsReceivable: boolean;
  jobCosting: boolean;
  backlog: boolean;
  alerts: boolean;
  documents: boolean;
}

export const DEFAULT_SHARE_SECTIONS: ShareSections = {
  executiveSummary: true,
  companyOverview: true,
  teamAndRoles: true,
  howWeWork: true,
  cashPosition: true,
  accountsReceivable: true,
  jobCosting: true,
  backlog: true,
  alerts: true,
  documents: true,
};

export interface TeamMember {
  userId: string;
  fullName: string | null;
  email: string | null;
  role: string;
  workType: string;
  roleLabel: string;
  workTypeLabel: string;
  responsibilities: string;
}

export interface CompanyProfile {
  orgName: string;
  contractorType: string | null;
  contractorTypeLabel: string | null;
  generatedAt: string;
  overview: string;
  howWeWork: string[];
  team: TeamMember[];
  roleSummary: { role: string; count: number; description: string }[];
  workMix: { workType: string; jobCount: number }[];
}

export interface FinancialReport {
  generatedAt: string;
  currency: 'USD';
  executiveSummary: string;
  cash: {
    onHandCents: number;
    floorCents: number;
    accounts: { name: string; accountType: string; balanceCents: number | null }[];
  };
  receivables: {
    openArCents: number;
    jobCountWithAr: number;
    agingBuckets: { label: string; cents: number; jobs: number }[];
    topAged: {
      title: string;
      jobNumber: number | null;
      openArCents: number;
      agingDays: number | null;
    }[];
  };
  jobCosting: {
    totalContractCents: number;
    totalCostCents: number;
    blendedMarginPct: number | null;
    jobs: {
      title: string;
      jobNumber: number | null;
      status: string;
      contractCents: number | null;
      costCents: number;
      marginPct: number | null;
      openArCents: number;
      invoicedCents: number;
      paidCents: number;
    }[];
  };
  backlog: {
    activeJobs: number;
    contractBacklogCents: number;
    unbilledCostCents: number;
  };
  alerts: {
    severity: string;
    category: string;
    title: string;
    detail: string | null;
    suggestedAction: string | null;
  }[];
  connections: {
    label: string;
    kind: string;
    provider: string;
    status: string;
    accessMode: string;
    lastSyncAt: string | null;
  }[];
}

const ROLE_LABELS: Record<string, string> = {
  project_manager: 'Project Manager',
  field_technician: 'Field Technician',
  accountant: 'Accountant',
  office_manager: 'Office Manager',
  sales: 'Sales',
};

const ROLE_RESPONSIBILITIES: Record<string, string> = {
  project_manager:
    'Owns active jobs end-to-end: schedule, crew, drying/production progress, carrier documentation, and close-out.',
  field_technician:
    'Performs on-site mitigation and construction work; logs moisture readings, labor, photos, and equipment placements.',
  accountant:
    'Owns the books: invoicing, collections, job cost, bank/accounting connections, and third-party financial packages.',
  office_manager:
    'Runs the office: customer communication, paperwork chase, scheduling support, and cross-team coordination.',
  sales:
    'Brings in new work: leads, inspections, estimates, and handoff to production when a job is won.',
};

const CONTRACTOR_LABELS: Record<string, string> = {
  restoration: 'Restoration company',
  roofing: 'Roofing company',
  general_contractor: 'General contractor',
  other: 'Contractor',
};

function howWeWorkNarrative(contractorType: string | null): string[] {
  const base = [
    'Work is organized as jobs. A sold opportunity becomes a job with contract value, invoices, payments, and job cost.',
    'Atmosphere monitors production (Project Manager Agent) and the books (Financial Agent) under the same organization.',
    'Financial connections to banks and accounting software are read-only observation — balances and activity are watched; money is not moved by the agent.',
  ];

  if (contractorType === 'restoration') {
    return [
      'This is a restoration company. Typical flow: loss intake → mitigation (dry-out, emergency services) → documentation for the carrier → reconstruction when approved.',
      'Revenue is often insurance-backed. Receivables age against carriers and homeowners; deductible collection and supplement timing matter to cash.',
      ...base,
    ];
  }
  if (contractorType === 'roofing') {
    return [
      'This is a roofing company. Typical flow: inspection → estimate → material order → install → punch list → invoice/collection.',
      'Jobs may be insurance storm work or retail. Weather and material lead times drive schedule risk; job cost tracks labor, materials, and subcontract.',
      ...base,
    ];
  }
  if (contractorType === 'general_contractor') {
    return [
      'This is a general contractor. Typical flow: bid → contract → permitting → production → punch list → final invoice.',
      'Multiple trades and subcontractors are coordinated under one job; cost codes separate labor, materials, equipment, and subcontract.',
      ...base,
    ];
  }
  return [
    'This contractor runs jobs through Atmosphere from sale through production and billing.',
    ...base,
  ];
}

function agingBucket(days: number | null): string {
  if (days === null) return 'unknown';
  if (days < 30) return '0-29';
  if (days < 45) return '30-44';
  if (days < 60) return '45-59';
  if (days < 90) return '60-89';
  return '90+';
}

export async function loadOrgIdentity(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{
  orgName: string;
  contractorType: string | null;
  members: { userId: string; role: string; workType: string; fullName: string | null; email: string | null }[];
}> {
  const { data: org } = await supabase
    .from('orgs')
    .select('id, name, contractor_type')
    .eq('id', orgId)
    .maybeSingle();

  const { data: members } = await supabase
    .from('org_members')
    .select('user_id, role, work_type, profiles(full_name, email)')
    .eq('org_id', orgId);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const team = (members ?? []).map((m: any) => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return {
      userId: m.user_id as string,
      role: m.role as string,
      workType: m.work_type as string,
      fullName: (profile?.full_name as string | null) ?? null,
      email: (profile?.email as string | null) ?? null,
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return {
    orgName: (org?.name as string) ?? 'Organization',
    contractorType: (org?.contractor_type as string | null) ?? null,
    members: team,
  };
}

export function buildCompanyProfile(
  identity: Awaited<ReturnType<typeof loadOrgIdentity>>,
  snapshot: FinanceSnapshot,
  now = new Date(),
): CompanyProfile {
  const team: TeamMember[] = identity.members.map((m) => ({
    userId: m.userId,
    fullName: m.fullName,
    email: m.email,
    role: m.role,
    workType: m.workType,
    roleLabel: ROLE_LABELS[m.role] ?? m.role,
    workTypeLabel: m.workType === 'mitigation' ? 'Mitigation' : 'Construction',
    responsibilities: ROLE_RESPONSIBILITIES[m.role] ?? 'Team member on this organization.',
  }));

  const roleCounts = new Map<string, number>();
  for (const m of team) roleCounts.set(m.role, (roleCounts.get(m.role) ?? 0) + 1);

  const workMixMap = new Map<string, number>();
  for (const j of snapshot.jobs) {
    workMixMap.set(j.workType, (workMixMap.get(j.workType) ?? 0) + 1);
  }

  const contractorLabel = identity.contractorType
    ? CONTRACTOR_LABELS[identity.contractorType] ?? identity.contractorType
    : null;

  const overview = [
    `${identity.orgName} is ${contractorLabel ? `a ${contractorLabel.toLowerCase()}` : 'a contracting business'} using Atmosphere to run jobs and the books.`,
    `The team has ${team.length} active member${team.length === 1 ? '' : 's'} across ${roleCounts.size} role${roleCounts.size === 1 ? '' : 's'}.`,
    `This package explains who does what, how work flows from sale to payment, and the financial position frozen at generation time.`,
  ].join(' ');

  return {
    orgName: identity.orgName,
    contractorType: identity.contractorType,
    contractorTypeLabel: contractorLabel,
    generatedAt: now.toISOString(),
    overview,
    howWeWork: howWeWorkNarrative(identity.contractorType),
    team,
    roleSummary: [...roleCounts.entries()].map(([role, count]) => ({
      role: ROLE_LABELS[role] ?? role,
      count,
      description: ROLE_RESPONSIBILITIES[role] ?? '',
    })),
    workMix: [...workMixMap.entries()].map(([workType, jobCount]) => ({ workType, jobCount })),
  };
}

export function buildFinancialReport(
  snapshot: FinanceSnapshot,
  companyName: string,
  now = new Date(),
): FinancialReport {
  const cashCents = totalCashCents(snapshot.accounts);
  const openArCents = snapshot.rollups.reduce((s, r) => s + r.openArCents, 0);
  const totalCostCents = snapshot.rollups.reduce((s, r) => s + r.costCents, 0);
  const totalContractCents = snapshot.rollups.reduce((s, r) => s + (r.contractCents ?? 0), 0);
  const blendedMarginPct =
    totalContractCents > 0
      ? ((totalContractCents - totalCostCents) / totalContractCents) * 100
      : null;

  const buckets = new Map<string, { cents: number; jobs: number }>();
  for (const label of ['0-29', '30-44', '45-59', '60-89', '90+', 'unknown']) {
    buckets.set(label, { cents: 0, jobs: 0 });
  }
  for (const r of snapshot.rollups) {
    if (r.openArCents <= 0) continue;
    const key = agingBucket(r.agingDays);
    const b = buckets.get(key)!;
    b.cents += r.openArCents;
    b.jobs += 1;
  }

  const unbilledCostCents = snapshot.rollups.reduce(
    (s, r) => s + Math.max(0, r.costCents - r.invoicedCents),
    0,
  );

  const executiveSummary = [
    `${companyName} financial package as of ${now.toISOString().slice(0, 10)}.`,
    `Cash on hand ${formatCents(cashCents)}; open receivables ${formatCents(openArCents)} across ${snapshot.rollups.filter((r) => r.openArCents > 0).length} job(s).`,
    `Contract value on open jobs ${formatCents(totalContractCents)}; cost to date ${formatCents(totalCostCents)}${
      blendedMarginPct !== null ? ` (blended margin ${blendedMarginPct.toFixed(1)}%).` : '.'
    }`,
    `Bank and accounting connections are observed read-only. Figures below are frozen for this package.`,
  ].join(' ');

  return {
    generatedAt: now.toISOString(),
    currency: 'USD',
    executiveSummary,
    cash: {
      onHandCents: cashCents,
      floorCents: snapshot.settings.cashFloorCents,
      accounts: snapshot.accounts.map((a) => ({
        name: a.name,
        accountType: a.accountType,
        balanceCents: a.balanceCents,
      })),
    },
    receivables: {
      openArCents,
      jobCountWithAr: snapshot.rollups.filter((r) => r.openArCents > 0).length,
      agingBuckets: [...buckets.entries()].map(([label, v]) => ({
        label,
        cents: v.cents,
        jobs: v.jobs,
      })),
      topAged: snapshot.rollups
        .filter((r) => r.openArCents > 0)
        .sort((a, b) => (b.agingDays ?? 0) - (a.agingDays ?? 0))
        .slice(0, 10)
        .map((r) => ({
          title: r.title,
          jobNumber: r.jobNumber,
          openArCents: r.openArCents,
          agingDays: r.agingDays,
        })),
    },
    jobCosting: {
      totalContractCents,
      totalCostCents,
      blendedMarginPct,
      jobs: snapshot.jobs.map((j) => {
        const rollup = snapshot.rollups.find((r) => r.jobId === j.id);
        return {
          title: j.title,
          jobNumber: j.jobNumber,
          status: j.status,
          contractCents: j.contractCents,
          costCents: rollup?.costCents ?? 0,
          marginPct: rollup?.marginPct ?? null,
          openArCents: j.openArCents,
          invoicedCents: j.invoicedCents,
          paidCents: j.paidCents,
        };
      }),
    },
    backlog: {
      activeJobs: snapshot.jobs.filter((j) =>
        ['draft', 'scheduled', 'in_progress', 'on_hold'].includes(j.status),
      ).length,
      contractBacklogCents: snapshot.jobs
        .filter((j) => ['scheduled', 'in_progress', 'on_hold'].includes(j.status))
        .reduce((s, j) => s + Math.max(0, (j.contractCents ?? 0) - j.invoicedCents), 0),
      unbilledCostCents,
    },
    alerts: [],
    connections: snapshot.connections.map((c) => ({
      label: c.label,
      kind: c.kind,
      provider: c.provider,
      status: c.status,
      accessMode: c.accessMode,
      lastSyncAt: c.lastSyncAt,
    })),
  };
}

export async function buildSharePayloads(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ report: FinancialReport; companyProfile: CompanyProfile }> {
  const [snapshot, identity, alerts] = await Promise.all([
    loadOrgSnapshot(supabase, orgId),
    loadOrgIdentity(supabase, orgId),
    listAlerts(supabase, orgId, { limit: 50 }),
  ]);

  const report = buildFinancialReport(snapshot, identity.orgName);
  report.alerts = alerts
    .filter((a) => a.status === 'open' || a.status === 'acknowledged')
    .slice(0, 25)
    .map((a) => ({
      severity: a.severity,
      category: a.category,
      title: a.title,
      detail: a.detail,
      suggestedAction: a.suggestedAction,
    }));

  const companyProfile = buildCompanyProfile(identity, snapshot);
  return { report, companyProfile };
}
