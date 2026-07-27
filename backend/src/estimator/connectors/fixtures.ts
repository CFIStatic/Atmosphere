import { deflateSync } from 'node:zlib';
import type { CrmConnector, CrmJobQuery, EstimateConnector, ScanConnector, ScanProjectSummary } from './ports.js';
import { parseMitigationEstimate } from '../estimate/mitigationImport.js';
import type { ConstructionEstimate, CrmJob, JobPhoto, MitigationEstimate, ScanProject } from '../types.js';

/**
 * Sandbox connectors.
 *
 * The estimator drives three third-party systems, and none of them can be
 * signed into from a test suite, a CI run, or a demo laptop. Without a stand-in
 * the only way to exercise matching, scoping, and pricing is against live
 * customer data — which is exactly what nobody should be doing while iterating
 * on a scope rule.
 *
 * These fixtures are a deliberately awkward scenario rather than a happy path:
 * two CRM jobs at nearly the same address (so the matcher has to actually
 * discriminate), a mitigation estimate that mixes rebuild-triggering removals
 * with dryout equipment that must not be carried over, and a room in the scan
 * that the job notes place out of scope.
 *
 * Photos are real, valid PNGs so the vision plumbing is genuinely exercised —
 * they are blank, so a correct model returns no findings from them. That is the
 * point: the sandbox proves the path works without inventing damage.
 */

/* ------------------------------------------------------------------ */
/* A minimal but valid PNG                                             */
/* ------------------------------------------------------------------ */

function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** A solid mid-grey square — small, valid, and free of anything to report. */
function blankPng(size = 64): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // colour type: truecolour
  // bytes 10–12 stay zero: deflate compression, adaptive filtering, no interlace

  // One filter byte (0 = none) per scanline, then RGB triplets.
  const raw = Buffer.alloc(size * (1 + size * 3), 0x9a);
  for (let row = 0; row < size; row += 1) raw[row * (1 + size * 3)] = 0;

  return Buffer.concat([
    header,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* Fixture data                                                        */
/* ------------------------------------------------------------------ */

const FIXTURE_PROJECT_ID = 'ds-10482';

const FIXTURE_PROJECT: ScanProject = {
  id: FIXTURE_PROJECT_ID,
  name: 'Alvarado Residence — supply line failure',
  claimNumber: 'CLM-88213-A',
  policyNumber: 'HO-4471902',
  insuredName: 'Marcus Alvarado',
  address: {
    street: '1420 Birchwood Lane',
    city: 'Cedar Falls',
    state: 'IA',
    postalCode: '50613',
  },
  lossDate: '2026-06-14',
  capturedAt: '2026-06-16T14:20:00Z',
  rooms: [
    {
      id: 'room-living',
      name: 'Living Room',
      roomType: 'living room',
      floorAreaSqFt: 288,
      ceilingAreaSqFt: 288,
      wallAreaSqFt: 544,
      perimeterLf: 68,
      ceilingHeightFt: 8,
      level: 'Main Level',
      openings: [
        { kind: 'door', width: 3, height: 6.67 },
        { kind: 'cased_opening', width: 5, height: 7, sharedWithRoomId: 'room-hall' },
        { kind: 'window', width: 5, height: 4 },
        { kind: 'window', width: 5, height: 4 },
      ],
    },
    {
      id: 'room-hall',
      name: 'Hallway',
      roomType: 'hallway',
      floorAreaSqFt: 72,
      ceilingAreaSqFt: 72,
      wallAreaSqFt: 352,
      perimeterLf: 44,
      ceilingHeightFt: 8,
      level: 'Main Level',
      openings: [
        { kind: 'door', width: 3, height: 6.67 },
        { kind: 'door', width: 3, height: 6.67 },
        { kind: 'cased_opening', width: 5, height: 7 },
      ],
    },
    {
      id: 'room-master',
      name: 'Master Bedroom',
      roomType: 'bedroom',
      floorAreaSqFt: 224,
      ceilingAreaSqFt: 224,
      wallAreaSqFt: 480,
      perimeterLf: 60,
      ceilingHeightFt: 8,
      level: 'Main Level',
      openings: [
        { kind: 'door', width: 3, height: 6.67, sharedWithRoomId: 'room-hall' },
        { kind: 'window', width: 4, height: 4 },
      ],
    },
    {
      id: 'room-office',
      name: 'Office',
      roomType: 'office',
      floorAreaSqFt: 130,
      ceilingAreaSqFt: 130,
      wallAreaSqFt: 368,
      perimeterLf: 46,
      ceilingHeightFt: 8,
      level: 'Main Level',
      openings: [{ kind: 'door', width: 3, height: 6.67, sharedWithRoomId: 'room-hall' }],
    },
  ],
  photos: [
    {
      id: 'photo-1',
      roomId: 'room-living',
      caption: 'Living room, north wall after flood cut',
      takenAt: '2026-06-16T14:22:00Z',
      url: 'fixture://photo-1',
      contentType: 'image/png',
    },
    {
      id: 'photo-2',
      roomId: 'room-hall',
      caption: 'Hallway looking toward the master bedroom',
      takenAt: '2026-06-16T14:26:00Z',
      url: 'fixture://photo-2',
      contentType: 'image/png',
    },
    {
      id: 'photo-3',
      roomId: 'room-master',
      caption: 'Master bedroom, carpet removed',
      takenAt: '2026-06-16T14:31:00Z',
      url: 'fixture://photo-3',
      contentType: 'image/png',
    },
  ],
};

/**
 * Two candidates on purpose. The decoy shares a street and a surname but is a
 * different claim at a different house number — the case a naive matcher gets
 * wrong.
 */
const FIXTURE_JOBS: CrmJob[] = [
  {
    id: 'job-55120',
    jobNumber: 'J-55120',
    claimNumber: 'CLM-88213-A',
    policyNumber: 'HO-4471902',
    insuredName: 'Marcus Alvarado',
    address: {
      street: '1420 Birchwood Ln',
      city: 'Cedar Falls',
      state: 'IA',
      postalCode: '50613',
    },
    lossType: 'Water — supply line',
    lossDate: '2026-06-14',
    carrier: 'Meridian Mutual',
    status: 'Mitigation complete',
    notes: [
      {
        id: 'note-1',
        author: 'D. Okafor (PM)',
        createdAt: '2026-06-15T09:10:00Z',
        body: 'Cat 1 loss, supply line to the upstairs bath let go overnight. Water tracked down the hall wall into the living room and master. Mitigation crew on site 6/14 evening.',
      },
      {
        id: 'note-2',
        author: 'D. Okafor (PM)',
        createdAt: '2026-06-16T16:40:00Z',
        body: 'Adjuster approved a 2 ft flood cut in the living room, hallway, and master. Carpet and pad pulled in the master. Living room is LVP throughout the main level.',
      },
      {
        id: 'note-3',
        author: 'S. Whitfield (Adjuster)',
        createdAt: '2026-06-17T11:02:00Z',
        body: 'Office was not affected — homeowner confirms the door was closed and the floor is dry. Leave the office out of scope. Replace like for like elsewhere.',
      },
    ],
    documents: [
      {
        id: 'doc-mit-1',
        name: 'Alvarado — mitigation estimate.csv',
        contentType: 'text/csv',
        url: 'fixture://doc-mit-1',
      },
    ],
  },
  {
    id: 'job-55008',
    jobNumber: 'J-55008',
    claimNumber: 'CLM-87740-B',
    insuredName: 'Marcus Alvarado',
    address: {
      street: '1424 Birchwood Ln',
      city: 'Cedar Falls',
      state: 'IA',
      postalCode: '50613',
    },
    lossType: 'Water — roof leak',
    lossDate: '2026-02-02',
    carrier: 'Meridian Mutual',
    status: 'Closed',
    notes: [
      {
        id: 'note-d1',
        author: 'D. Okafor (PM)',
        createdAt: '2026-02-03T08:00:00Z',
        body: 'Roof leak over the garage. Closed out in March.',
      },
    ],
    documents: [],
  },
];

/**
 * A realistic mitigation export: removals that imply a rebuild, mixed with
 * dryout equipment and monitoring that must not be carried into a construction
 * estimate. Exercising the exclusion rules is the point.
 */
const FIXTURE_MITIGATION_CSV = `Claim,CLM-88213-A
Insured,Marcus Alvarado

Room,Code,Description,Quantity,Unit
Living Room,WTR DRY2,"Remove drywall - up to 2' - walls",68.00,LF
Living Room,DMO BB,"Remove baseboard",62.00,LF
Living Room,DMO LVP,"Remove luxury vinyl plank flooring",288.00,SF
Living Room,WTR AMV,"Air mover (per 24 hour period)",12.00,DA
Living Room,WTR DHM,"Dehumidifier - large - per day",4.00,DA
Hallway,WTR DRY2,"Remove drywall - up to 2' - walls",44.00,LF
Hallway,DMO BB,"Remove baseboard",33.00,LF
Hallway,DMO INS,"Remove batt insulation",88.00,SF
Master Bedroom,DMO CRPT,"Remove carpet",224.00,SF
Master Bedroom,DMO PAD,"Remove carpet pad",224.00,SF
Master Bedroom,WTR DRY2,"Remove drywall - up to 2' - walls",60.00,LF
Master Bedroom,DMO BB,"Remove baseboard",54.00,LF
Master Bedroom,WTR MON,"Moisture monitoring - per visit",3.00,EA
General,WTR ANTI,"Apply antimicrobial agent",584.00,SF
General,WTR LAB,"Water damage technician - per hour",16.00,HR
`;

/* ------------------------------------------------------------------ */
/* Connectors                                                          */
/* ------------------------------------------------------------------ */

export class FixtureScanConnector implements ScanConnector {
  readonly name = 'DocuSketch (sandbox)';

  async verify(): Promise<void> {
    /* Always available — the sandbox holds no credentials to check. */
  }

  async listProjects(): Promise<ScanProjectSummary[]> {
    return [
      {
        id: FIXTURE_PROJECT.id,
        name: FIXTURE_PROJECT.name,
        address: FIXTURE_PROJECT.address.street,
        claimNumber: FIXTURE_PROJECT.claimNumber,
        capturedAt: FIXTURE_PROJECT.capturedAt,
      },
    ];
  }

  async getProject(projectId: string): Promise<ScanProject> {
    if (projectId !== FIXTURE_PROJECT_ID) {
      throw new Error(
        `Sandbox mode only has project "${FIXTURE_PROJECT_ID}". Configure live DocuSketch credentials to read real projects.`,
      );
    }
    // Deep copy: callers annotate rooms and photos, and a shared fixture that
    // mutates between runs is a debugging nightmare.
    return structuredClone(FIXTURE_PROJECT);
  }

  async downloadPhoto(_photo: JobPhoto): Promise<{ bytes: Buffer; contentType: string }> {
    return { bytes: blankPng(), contentType: 'image/png' };
  }
}

export class FixtureCrmConnector implements CrmConnector {
  readonly name = 'Dash (sandbox)';

  async verify(): Promise<void> {
    /* Nothing to check. */
  }

  async searchJobs(query: CrmJobQuery): Promise<CrmJob[]> {
    // Return both candidates whenever anything about the loss matches, so the
    // matcher has to do its job rather than being handed a single answer.
    const haystack = `${query.claimNumber ?? ''} ${query.address ?? ''} ${query.insuredName ?? ''} ${query.postalCode ?? ''}`.toLowerCase();
    const relevant = ['alvarado', 'birchwood', '50613', 'clm-88213', 'clm-87740'].some((token) =>
      haystack.includes(token),
    );
    return relevant ? structuredClone(FIXTURE_JOBS) : [];
  }

  async getJob(jobId: string): Promise<CrmJob> {
    const job = FIXTURE_JOBS.find((candidate) => candidate.id === jobId);
    if (!job) throw new Error(`Sandbox has no job "${jobId}".`);
    return structuredClone(job);
  }

  async downloadDocument(
    _jobId: string,
    documentId: string,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    if (documentId !== 'doc-mit-1') throw new Error(`Sandbox has no document "${documentId}".`);
    return { bytes: Buffer.from(FIXTURE_MITIGATION_CSV, 'utf8'), contentType: 'text/csv' };
  }
}

export class FixtureEstimateConnector implements EstimateConnector {
  readonly name = 'Xactimate (sandbox)';

  async verify(): Promise<void> {
    /* Nothing to check. */
  }

  async createEstimate(estimate: ConstructionEstimate): Promise<{ reference: string }> {
    // Deliberately writes nothing. The sandbox exists so this step can be
    // rehearsed without an estimate appearing on a real claim.
    return { reference: `SANDBOX-${estimate.claimNumber ?? estimate.jobId}` };
  }

  async fetchMitigationEstimate(claimNumber: string): Promise<MitigationEstimate | null> {
    if (claimNumber !== FIXTURE_PROJECT.claimNumber) return null;
    return parseMitigationEstimate(FIXTURE_MITIGATION_CSV, {
      source: 'sandbox mitigation estimate',
      format: 'csv',
    });
  }
}

/** Exposed for tests, so scope rules can be exercised against a known scenario. */
export const FIXTURES = {
  project: FIXTURE_PROJECT,
  jobs: FIXTURE_JOBS,
  mitigationCsv: FIXTURE_MITIGATION_CSV,
};
