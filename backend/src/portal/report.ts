import type { Project, ProjectDocument, ProjectUpdate, Milestone } from '../pm/types.js';
import { buildRegulationBrief } from './regulations.js';
import type { PortalShare, PortalVisibility } from './types.js';

/**
 * Build the guest-facing HomeOwner Report DTO. Every field is gated by the
 * restoration company's visibility flags — unset sections become null rather
 * than leaking defaults from internal PM data.
 */

const PHASE_LABELS: Record<string, string> = {
  intake: 'Intake',
  inspection: 'Inspection',
  approval: 'Approval',
  scheduled: 'Scheduled',
  mitigation: 'Mitigation',
  drying: 'Drying',
  drying_complete: 'Drying complete',
  permitting: 'Permitting',
  production: 'Production',
  punch_list: 'Punch list',
  final_review: 'Final review',
  invoicing: 'Invoicing',
  paid: 'Paid',
};

function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase;
}

export interface DryingSummaryGuest {
  isDrying: boolean;
  openAreas: number;
  areasAtGoal: number;
  daysDrying: number | null;
  headline: string;
}

export interface HomeownerReport {
  orgName: string | null;
  /** Brand shown in the guest chat header — logo + display name. */
  brand: {
    name: string;
    logoUrl: string | null;
  };
  share: {
    id: string;
    welcomeNote: string | null;
    customerName: string | null;
  };
  project: {
    projectNumber: string;
    name: string;
    workType: string;
    lossType: string | null;
    status: string;
    phase: string | null;
    phaseLabel: string | null;
    address: string | null;
    city: string | null;
    region: string | null;
  };
  schedule: {
    scheduledStartAt: string | null;
    targetCompletionAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
  claim: {
    carrier: string | null;
    claimNumber: string | null;
    deductibleCents: number | null;
  } | null;
  contacts: {
    office: { name: string | null; phone: string | null; email: string | null } | null;
    adjuster: { name: string | null; phone: string | null; email: string | null } | null;
    field: { name: string | null; phone: string | null } | null;
  };
  milestones: { label: string; dueAt: string; kind: string; completedAt: string | null }[] | null;
  updates: { subject: string | null; body: string; sentAt: string | null; createdAt: string }[] | null;
  drying: DryingSummaryGuest | null;
  documents: { label: string; kind: string; status: string }[] | null;
  customMessage: string | null;
  capabilities: {
    chat: boolean;
    policyUpload: boolean;
    insuranceQa: boolean;
  };
  regulation: ReturnType<typeof buildRegulationBrief>;
}

export function buildHomeownerReport(input: {
  orgName: string | null;
  share: PortalShare;
  visibility: PortalVisibility;
  project: Project;
  milestones: Milestone[];
  updates: ProjectUpdate[];
  documents: ProjectDocument[];
  drying: DryingSummaryGuest | null;
}): HomeownerReport {
  const { visibility: v, project: p, share } = input;

  const addressParts = [p.addressLine1, p.addressLine2].filter(Boolean);
  const address = addressParts.length > 0 ? addressParts.join(', ') : null;

  const customerMilestones = input.milestones.filter(
    (m) => m.kind === 'customer' || m.kind === 'carrier' || m.kind === 'permit',
  );

  const customerUpdates = input.updates.filter(
    (u) => u.audience === 'customer' && (u.status === 'approved' || u.status === 'sent'),
  );

  return {
    orgName: input.orgName,
    brand: {
      name: v.brandName?.trim() || v.officeName?.trim() || input.orgName || 'Restoration team',
      logoUrl: v.logoUrl,
    },
    share: {
      id: share.id,
      welcomeNote: share.welcomeNote,
      customerName: share.customerName ?? p.customerName,
    },
    project: {
      projectNumber: p.projectNumber,
      name: p.name,
      workType: p.workType,
      lossType: p.lossType,
      status: p.status,
      phase: v.showPhaseProgress ? p.phase : null,
      phaseLabel: v.showPhaseProgress ? phaseLabel(p.phase) : null,
      address,
      city: p.city,
      region: p.region,
    },
    schedule: v.showSchedule
      ? {
          scheduledStartAt: p.scheduledStartAt,
          targetCompletionAt: p.targetCompletionAt,
          startedAt: p.startedAt,
          completedAt: p.completedAt,
        }
      : null,
    claim: v.showClaimBasics
      ? {
          carrier: p.carrier,
          claimNumber: p.claimNumber,
          deductibleCents: v.showDeductible ? p.deductibleCents : null,
        }
      : null,
    contacts: {
      office: v.showOfficeContact
        ? {
            name: v.officeName ?? input.orgName,
            phone: v.officePhone ?? null,
            email: v.officeEmail ?? null,
          }
        : null,
      adjuster: v.showAdjusterContact
        ? {
            name: p.adjusterName,
            phone: p.adjusterPhone,
            email: p.adjusterEmail,
          }
        : null,
      field: v.showFieldContact
        ? {
            name: v.fieldContactName,
            phone: v.fieldContactPhone,
          }
        : null,
    },
    milestones: v.showMilestones
      ? customerMilestones.map((m) => ({
          label: m.label,
          dueAt: m.dueAt,
          kind: m.kind,
          completedAt: m.completedAt,
        }))
      : null,
    updates: v.showCustomerUpdates
      ? customerUpdates.map((u) => ({
          subject: u.subject,
          body: u.body,
          sentAt: u.sentAt,
          createdAt: u.createdAt,
        }))
      : null,
    drying: v.showDryingSummary ? input.drying : null,
    documents: v.showDocuments
      ? input.documents
          .filter((d) => d.status === 'provided' || d.status === 'waived')
          .map((d) => ({
            label: d.label,
            kind: d.kind,
            status: d.status,
          }))
      : null,
    customMessage: v.customMessage,
    capabilities: {
      chat: v.allowChat,
      policyUpload: v.allowPolicyUpload,
      insuranceQa: v.allowInsuranceQa,
    },
    regulation: buildRegulationBrief({
      region: p.region,
      carrier: p.carrier,
      lossType: p.lossType,
    }),
  };
}

/** Compact facts string for the assistant — mirrors what the guest can already see. */
export function jobFactsForAssistant(report: HomeownerReport): string {
  const lines: string[] = [
    `Job ${report.project.projectNumber}: ${report.project.name}`,
    `Status: ${report.project.status}` +
      (report.project.phaseLabel ? `, phase ${report.project.phaseLabel}` : ''),
  ];
  if (report.project.address) {
    lines.push(
      `Property: ${[report.project.address, report.project.city, report.project.region]
        .filter(Boolean)
        .join(', ')}`,
    );
  }
  if (report.schedule) {
    lines.push(
      `Schedule: start ${report.schedule.scheduledStartAt ?? 'TBD'}, target completion ${report.schedule.targetCompletionAt ?? 'TBD'}`,
    );
  }
  if (report.claim) {
    lines.push(
      `Claim: carrier ${report.claim.carrier ?? 'n/a'}, claim # ${report.claim.claimNumber ?? 'n/a'}` +
        (report.claim.deductibleCents != null
          ? `, deductible $${(report.claim.deductibleCents / 100).toFixed(2)}`
          : ''),
    );
  }
  if (report.contacts.office) {
    lines.push(
      `Office contact: ${report.contacts.office.name ?? 'office'} ${report.contacts.office.phone ?? ''} ${report.contacts.office.email ?? ''}`.trim(),
    );
  }
  if (report.contacts.adjuster) {
    lines.push(
      `Adjuster: ${report.contacts.adjuster.name ?? 'n/a'} ${report.contacts.adjuster.phone ?? ''}`.trim(),
    );
  }
  if (report.drying) {
    lines.push(
      `Drying: ${report.drying.headline} (${report.drying.areasAtGoal}/${report.drying.openAreas + report.drying.areasAtGoal} areas at goal)`,
    );
  }
  if (report.milestones?.length) {
    lines.push(
      'Milestones: ' +
        report.milestones
          .slice(0, 8)
          .map((m) => `${m.label} due ${m.dueAt}${m.completedAt ? ' (done)' : ''}`)
          .join('; '),
    );
  }
  if (report.updates?.length) {
    const latest = report.updates[0]!;
    lines.push(`Latest customer update: ${latest.subject ?? '(no subject)'} — ${latest.body.slice(0, 400)}`);
  }
  return lines.join('\n');
}
