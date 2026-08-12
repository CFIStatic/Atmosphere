import type {
  IntakeApproveResult,
  IntakeCaptureInvite,
  IntakeProposal,
  SharedJobRecord,
  SharedJobSummary,
} from './api';

/** Build list + detail payloads so the job record can paint before the GET returns. */
export function handoffFromApprove(
  res: IntakeApproveResult,
  proposal: IntakeProposal,
  scope: IntakeProposal['scope'],
): {
  summary: SharedJobSummary;
  record: SharedJobRecord;
  invites: IntakeCaptureInvite[];
} {
  const now = new Date().toISOString();
  const revision = res.briefRevision ?? 1;
  const invites = res.invites ?? [];
  const summary: SharedJobSummary = res.jobFile ?? {
    jobId: res.job.id,
    jobNumber: res.job.jobNumber ?? null,
    title: res.job.title,
    status: 'scheduled',
    parties: invites.length,
    currentRevision: revision,
    behind: 0,
    awaiting: invites.length,
    exclusions: scope.filter((s) => s.state === 'excluded').length,
  };

  const facts = { ...(proposal.facts ?? {}) };
  const site = [proposal.address, proposal.city, proposal.postalCode].filter(Boolean).join(', ');
  if (site && !facts['Site address']) facts['Site address'] = site;

  const record: SharedJobRecord = {
    job: {
      id: res.job.id,
      jobNumber: res.job.jobNumber ?? null,
      title: res.job.title,
      status: 'scheduled',
      claimNumber: null,
    },
    brief: {
      id: `local-${res.job.id}`,
      revision,
      facts,
      note: proposal.briefNote ?? null,
      created_at: now,
    },
    revisions: [{ revision, note: proposal.briefNote ?? 'Intake approved.', createdAt: now }],
    currentRevision: revision,
    parties: invites.map((inv) => ({
      id: inv.id,
      company: inv.name,
      trade: inv.external ? 'subcontractor' : 'field_capture',
      contactName: inv.name,
      email: inv.email,
      phone: null,
      role: 'subcontractor' as const,
      invited_at: now,
      last_seen_at: null,
      revoked_at: null,
      acknowledgedRevision: null,
      clear: false,
      because: 'Just invited from intake — waiting for them to accept the brief.',
    })),
    scope: scope.map((line, i) => ({
      id: `local-scope-${i}`,
      party_id: null,
      state: line.state,
      title: line.title,
      detail: null,
      amount: null,
      reason: line.reason ?? null,
      revision,
      decided_at: null,
      created_at: now,
    })),
    money: { approved: 0, pending: 0, unpricedApprovals: 0 },
    messages: [],
    risks: [],
  };

  return { summary, record, invites };
}
