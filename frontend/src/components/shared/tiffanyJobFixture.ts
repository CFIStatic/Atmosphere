/**
 * Stand-in records shaped like the Tiffany & Co. job
 * (d7fe1a01-4483-42c5-abb8-eaaa4c6988df).
 *
 * Fields follow the Ask eval catalog and the existing job-file APIs.
 * This is not a live fetch of production. Private transcript text is present
 * on the clips so tests can prove the timeline does not repeat it.
 */
import type {
  EvidenceShare,
  JobAccessPerson,
  JobCustodyExport,
  MemoryEvent,
  OfficeLiveSession,
  OrgMember,
  ProofResponse,
  ScopeDocument,
  SharedJobRecord,
} from '../../lib/api';
export const TIFFANY_JOB_ID = 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df';
export const EL_PRESIDENTE_ID = '111832c2-d6f9-4412-86ce-1fccc439eb40';
export const OFFICE_CLIP_ID = '00608802-140e-4897-9f02-1d5d0db88ecf';
export const TABLE_CLIP_ID = 'd088682f-b5c8-400f-ae51-fcbeed97258a';
export const WALK_CLIP_ID = 'c8d6e77f-6d86-4eee-8312-076038c15bac';

/** Stand-in still. Real jobs use a signed frame from the evidence library. */
export const TIFFANY_POSTER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#2a241e"/><rect x="18" y="28" width="70" height="40" rx="2" fill="#3d342c"/><rect x="96" y="36" width="46" height="28" rx="2" fill="#4a3b30"/><circle cx="40" cy="46" r="6" fill="#E8732A"/></svg>',
  );

export const tiffanyRecord: SharedJobRecord = {
  job: {
    id: TIFFANY_JOB_ID,
    jobNumber: 12,
    title: 'Project Tiffany & Co.',
    status: 'scheduled',
    claimNumber: null,
  },
  brief: {
    id: 'brief-tiffany',
    revision: 1,
    facts: {},
    note: null,
    createdAt: '2026-09-17T16:40:00.000Z',
  },
  revisions: [
    { revision: 1, note: null, createdAt: '2026-09-17T16:40:00.000Z' },
  ],
  currentRevision: 1,
  parties: [
    {
      id: 'party-el',
      company: 'Atmosphere',
      trade: 'office',
      contactName: 'El Presidente',
      email: 'el@atmosphereteam.com',
      phone: null,
      role: 'general_contractor',
      invited_at: '2026-09-17T16:45:00.000Z',
      last_seen_at: '2026-09-21T18:00:00.000Z',
      revoked_at: null,
      acknowledgedRevision: 1,
      clear: true,
      because: 'Accepted the current scope.',
      created_at: '2026-09-17T16:45:00.000Z',
    } as SharedJobRecord['parties'][number] & { created_at: string },
    {
      id: 'party-removed',
      company: 'Off Site Crew',
      trade: 'labor',
      contactName: 'Off Site',
      email: null,
      phone: null,
      role: 'subcontractor',
      invited_at: '2026-09-18T15:00:00.000Z',
      last_seen_at: null,
      revoked_at: '2026-09-19T15:12:00.000Z',
      acknowledgedRevision: null,
      clear: false,
      because: 'Removed from the job.',
      created_at: '2026-09-18T15:00:00.000Z',
    } as SharedJobRecord['parties'][number] & { created_at: string },
  ],
  scope: [
    {
      id: 'scope-dining',
      party_id: null,
      state: 'included',
      title: 'Protect the dining room floor',
      detail: null,
      amount: null,
      reason: null,
      revision: 1,
      decided_at: null,
      created_at: '2026-09-17T17:05:00.000Z',
    },
  ],
  money: { approved: 0, pending: 0, unpricedApprovals: 0 },
  messages: [
    {
      id: 'note-lockbox',
      party_id: null,
      author_label: 'El Presidente',
      body: 'The lockbox code is 4412.',
      scope_item_id: null,
      is_decision: false,
      created_at: '2026-09-17T18:00:00.000Z',
    },
  ],
  risks: [],
  access: 'org',
};

export const tiffanyProofs: ProofResponse = {
  job: { id: TIFFANY_JOB_ID, number: 12, name: 'Project Tiffany & Co.' },
  days: [
    {
      partyId: 'party-el',
      company: 'Atmosphere',
      workDate: '2026-09-21',
      hasBefore: true,
      hasAfter: true,
      checks: [],
      contradicted: false,
      summary: 'Dining room clips filed. One is still being read.',
      payable: false,
      payableBecause: '',
      accepted: false,
      rejected: false,
      aiSummary: null,
      aiFindings: null,
      analysisStatus: 'running',
      proofIds: [TABLE_CLIP_ID, WALK_CLIP_ID],
    },
    {
      partyId: 'party-el',
      company: 'Atmosphere',
      workDate: '2026-09-17',
      hasBefore: true,
      hasAfter: true,
      checks: [],
      contradicted: false,
      summary: 'Office recording read.',
      payable: false,
      payableBecause: '',
      accepted: false,
      rejected: false,
      aiSummary: 'A seated man in a small office, with a RESTORE 365 binder behind him.',
      aiFindings: null,
      analysisStatus: 'done',
      proofIds: [OFFICE_CLIP_ID],
    },
  ],
  videos: [
    {
      id: OFFICE_CLIP_ID,
      partyId: 'party-el',
      company: 'Atmosphere',
      person: 'El Presidente',
      workDate: '2026-09-17',
      phase: 'before',
      durationSeconds: 86,
      capturedAt: '2026-09-17T16:50:00.000Z',
      receivedAt: '2026-09-17T16:52:00.000Z',
      analysisStatus: 'done',
      narrationStatus: 'done',
      transcriptStatus: 'done',
      transcriptError: null,
      aiSummary: 'A seated man in a small office, with a RESTORE 365 binder behind him.',
      transcriptText: 'The tarp came off the north slope. The lockbox code is 4412.',
      heardOnMic: 'The tarp came off the north slope. The lockbox code is 4412.',
      conversation: { conversationRooms: ['office'] },
      privacyRedactions: {
        version: 1,
        ranges: [{ startSec: 11, endSec: 15, reason: 'private', confidence: 0.9, source: 'vision' }],
      },
    },
    {
      id: TABLE_CLIP_ID,
      partyId: 'party-el',
      company: 'Atmosphere',
      person: 'El Presidente',
      workDate: '2026-09-21',
      phase: 'before',
      durationSeconds: 34,
      capturedAt: '2026-09-21T17:04:00.000Z',
      receivedAt: '2026-09-21T17:06:00.000Z',
      analysisStatus: 'running',
      narrationStatus: 'running',
      transcriptStatus: 'queued',
      transcriptError: null,
      aiSummary: 'A phone video of a whitewashed dining table.',
      transcriptText: "It's all on paper.",
      heardOnMic: "It's all on paper.",
      conversation: { conversationRooms: ['dining room'] },
    },
    {
      id: WALK_CLIP_ID,
      partyId: 'party-el',
      company: 'Atmosphere',
      person: 'El Presidente',
      workDate: '2026-09-21',
      phase: 'after',
      durationSeconds: 48,
      capturedAt: '2026-09-21T18:10:00.000Z',
      receivedAt: '2026-09-21T18:12:00.000Z',
      analysisStatus: 'done',
      narrationStatus: 'done',
      transcriptStatus: 'done',
      transcriptError: null,
      aiSummary: 'A toddler said hello in the hallway.',
      transcriptText: 'her entire life.',
      heardOnMic: 'her entire life.',
      conversation: { conversationRooms: ['hallway'] },
      childPrivacyRedactions: {
        version: 1,
        category: 'child_privacy',
        ranges: [
          {
            startSec: 18,
            endSec: 22,
            reason: 'child present',
            confidence: 0.9,
            source: 'vision',
            category: 'child_privacy',
          },
        ],
      },
    },
  ],
  counts: {
    days: 2,
    videos: 3,
    payable: 0,
    contradicted: 0,
    awaitingAfter: 0,
    analysing: 1,
  },
  siteKnown: true,
};

export const tiffanyMemory: MemoryEvent[] = [
  {
    id: '18346820-5594-43cf-9e8b-a13aed56ac95',
    seq: 12,
    actorId: EL_PRESIDENTE_ID,
    actorEmail: 'el@atmosphereteam.com',
    actorRole: 'global_admin',
    eventType: 'job.created',
    entityType: 'job',
    entityId: TIFFANY_JOB_ID,
    jobId: TIFFANY_JOB_ID,
    summary: 'opened job #12 — Project Tiffany & Co.',
    changes: {},
    snapshot: { title: 'Project Tiffany & Co.', job_number: 12 },
    source: 'trigger',
    occurredAt: '2026-09-17T16:37:28.774Z',
  },
  {
    id: 'mem-rename',
    seq: 18,
    actorId: EL_PRESIDENTE_ID,
    actorEmail: 'el@atmosphereteam.com',
    actorRole: 'global_admin',
    eventType: 'job.updated',
    entityType: 'job',
    entityId: TIFFANY_JOB_ID,
    jobId: TIFFANY_JOB_ID,
    summary: 'updated job #12 (title)',
    changes: { title: { from: 'Tiffany walkthrough', to: 'Project Tiffany & Co.' } },
    snapshot: { title: 'Project Tiffany & Co.' },
    source: 'trigger',
    occurredAt: '2026-09-17T16:42:00.000Z',
  },
];

export const tiffanyCustody: JobCustodyExport = {
  schema: 'atmosphere.job_custody.v1',
  exportedAt: '2026-09-22T15:00:00.000Z',
  job: { id: TIFFANY_JOB_ID, number: 12, name: 'Project Tiffany & Co.' },
  clips: [
    {
      schema: 'atmosphere.clip_custody.v1',
      exportedAt: '2026-09-22T15:00:00.000Z',
      job: { id: TIFFANY_JOB_ID, number: 12, name: 'Project Tiffany & Co.' },
      clip: {
        id: OFFICE_CLIP_ID,
        phase: 'before',
        workDate: '2026-09-17',
        filmedBy: { partyId: 'party-el', company: 'Atmosphere', person: 'El Presidente' },
        filmedAt: '2026-09-17T16:50:00.000Z',
        receivedAt: '2026-09-17T16:52:00.000Z',
        device: null,
        integrity: { algorithm: 'sha256', contentHash: null, verdict: 'unknown', checks: [] },
        location: null,
        durationSeconds: 86,
        byteSize: null,
      },
      chainOfCustody: [
        {
          action: 'uploaded',
          by: 'El Presidente',
          role: 'global_admin',
          detail: 'before · 2026-09-17',
          at: '2026-09-17T16:52:10.000Z',
        },
        {
          action: 'analysed',
          by: 'El Presidente',
          role: null,
          detail: null,
          at: '2026-09-17T17:20:00.000Z',
        },
        {
          action: 'viewed',
          by: 'El Presidente',
          role: 'global_admin',
          detail: 'before · 2026-09-17',
          at: '2026-09-18T13:05:00.000Z',
        },
        {
          action: 'exported',
          by: 'El Presidente',
          role: 'global_admin',
          detail: 'proof-pack.pdf · full job',
          at: '2026-09-20T19:30:00.000Z',
        },
      ],
    },
  ],
};

export const tiffanyShares: EvidenceShare[] = [
  {
    id: 'share-ho',
    jobId: TIFFANY_JOB_ID,
    label: 'Homeowner',
    kind: 'progress',
    recipientEmail: 'homeowner@example.com',
    path: '/progress/tiffany',
    createdAt: '2026-09-18T20:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    lastOpenedAt: null,
    openCount: 0,
    state: 'live',
  },
];

export const tiffanyAccess: JobAccessPerson[] = [
  {
    id: 'share:share-ho',
    kind: 'homeowner',
    name: 'Homeowner',
    email: 'homeowner@example.com',
    accessType: 'Homeowner',
    role: 'homeowner',
    displayLabel: 'Homeowner',
    displayName: 'Homeowner',
    grantedByName: 'El Presidente',
    grantedByEmail: 'el@atmosphereteam.com',
    grantedAt: '2026-09-18T20:00:00.000Z',
    lastAccessedAt: null,
    state: 'live',
  },
];

export const tiffanyScopeDoc: ScopeDocument = {
  id: 'doc-1',
  filename: 'tiffany-scope.pdf',
  mediaType: 'application/pdf',
  byteSize: 12000,
  status: 'confirmed',
  extracted: null,
  extractionError: null,
  confirmedAt: '2026-09-17T17:10:00.000Z',
  createdAt: '2026-09-17T17:02:00.000Z',
};

export const tiffanyLive: OfficeLiveSession[] = [
  {
    clipId: 'live-dining',
    partyId: 'party-el',
    workDate: '2026-09-28',
    phase: 'before',
    mimeType: 'video/webm',
    extension: 'webm',
    storagePath: 'live/dining',
    startedAt: '2026-09-28T15:10:00.000Z',
    lastPartAt: '2026-09-28T15:12:00.000Z',
    lastMintIndex: 2,
    status: 'live',
    latencyNote: '',
    privacyNote: '',
  },
];

export const tiffanyMembers: OrgMember[] = [
  {
    userId: EL_PRESIDENTE_ID,
    email: 'el@atmosphereteam.com',
    fullName: 'El Presidente',
    role: 'global_admin',
    workType: 'mitigation',
    usageIntents: [],
    status: 'active',
    avatarUrl: null,
  },
];

export const tiffanyPosters = [
  { id: TABLE_CLIP_ID, jobId: TIFFANY_JOB_ID, posterUrl: TIFFANY_POSTER, title: 'Sep 21 tabletop close-up' },
  { id: OFFICE_CLIP_ID, jobId: TIFFANY_JOB_ID, posterUrl: TIFFANY_POSTER, title: 'Sep 17 office recording' },
  { id: WALK_CLIP_ID, jobId: TIFFANY_JOB_ID, posterUrl: null, title: 'Sep 21 home walkthrough' },
];
