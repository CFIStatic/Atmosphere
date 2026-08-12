import { describe, expect, it } from 'vitest';
import { handoffFromApprove } from './intakeHandoff';
import type { IntakeApproveResult, IntakeProposal } from './api';

describe('handoffFromApprove', () => {
  it('builds a list summary and openable record for the job file', () => {
    const proposal: IntakeProposal = {
      title: 'Meridian water loss',
      workType: 'mitigation',
      address: '1842 Meridian Ave',
      city: 'Austin',
      postalCode: '78702',
      claimNumber: 'AM-1',
      briefNote: 'Start today',
      facts: { Gate: 'Side' },
      scope: [
        { title: 'Extract water', state: 'included' },
        { title: 'Demo cabinets', state: 'excluded', reason: 'No' },
      ],
      source: 'heuristic',
      summary: 'ok',
    };
    const res: IntakeApproveResult = {
      job: { id: 'job-new-1', title: 'Meridian water loss', jobNumber: 42 },
      briefRevision: 1,
      scopeSaved: 2,
      invites: [
        {
          id: 'pty-1',
          name: 'Alex',
          email: 'a@example.com',
          sharePath: '/shared/t',
          fieldCapturePath: '/fieldcapture/index.html?token=t',
          token: 't',
          external: false,
          emailed: true,
          recipientHasAccount: false,
          attachedToAccount: false,
        },
      ],
      party: { id: 'pty-1', company: 'Alex' },
      sharePath: '/shared/t',
      fieldCapturePath: '/fieldcapture/index.html?token=t',
      readiness: {
        level: 'ready',
        ceiling: 'full',
        headline: 'Ready',
        gaps: [],
        strengths: [],
        source: 'scope_document',
      },
    };

    const { summary, record } = handoffFromApprove(res, proposal, proposal.scope);
    expect(summary.jobId).toBe('job-new-1');
    expect(summary.title).toBe('Meridian water loss');
    expect(summary.exclusions).toBe(1);
    expect(record.job.id).toBe('job-new-1');
    expect(record.parties).toHaveLength(1);
    expect(record.scope).toHaveLength(2);
    expect(record.brief?.facts['Site address']).toContain('Meridian');
  });
});
