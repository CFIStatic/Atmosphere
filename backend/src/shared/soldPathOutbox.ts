/**
 * Sold-path outbox workers (verification + proof narration/transcript/analysis).
 *
 * Default: run inside the BFF (WORKER_ROLE=all). Set WORKER_ROLE=queue on a
 * second Railway service with the same image if you want a dedicated worker;
 * the API process then uses WORKER_ROLE=http and only writes outbox rows.
 */

import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { logger } from '../lib/logger.js';
import { getVerificationOrchestrator } from '../verification/factory.js';
import { DurableOutboxWorker, type ClaimStore, type OutboxRow } from './durableOutbox.js';
import {
  claimNextProofWork,
  claimNextVideoProcessingJob,
  listClaimableProofWork,
  listClaimableVideoProcessingJobs,
  type ProofWorkKind,
} from './outboxClaim.js';
import { queueNarration, queueProofAnalysis } from '../routes/proofOfWork.js';
import { queueProofTranscript } from '../audio/proofTranscript.js';

interface VerificationRow extends OutboxRow {
  org_id: string;
  video_id: string;
  attempt_count?: number;
}

interface ProofRow extends OutboxRow {
  kind: ProofWorkKind;
  org_id: string;
  job_id: string;
  party_id: string;
  phase: string;
  work_date: string;
}

const KINDS: ProofWorkKind[] = ['narration', 'transcript', 'analysis'];

function verificationStore(admin: { from: (t: string) => any; rpc?: (name: string, args: Record<string, unknown>) => any }): ClaimStore<VerificationRow> {
  return {
    async listClaimable(limit) {
      const rows = await listClaimableVideoProcessingJobs(admin, limit);
      return rows.map((r) => ({
        id: r.id,
        org_id: r.org_id,
        video_id: r.video_id,
        attempt_count: r.attempt_count,
      }));
    },
    async claim(id, owner) {
      const row = await claimNextVideoProcessingJob(admin, { owner, id });
      if (!row?.id) return null;
      return {
        id: String(row.id),
        org_id: String(row.org_id ?? ''),
        video_id: String(row.video_id ?? ''),
        attempt_count: Number(row.attempt_count ?? 0),
      };
    },
  };
}

function proofStore(
  admin: { from: (t: string) => any; rpc?: (name: string, args: Record<string, unknown>) => any },
  kind: ProofWorkKind,
): ClaimStore<ProofRow> {
  return {
    async listClaimable(limit) {
      const rows = await listClaimableProofWork(admin, kind, limit);
      return rows.map((r) => ({ ...r, kind }));
    },
    async claim(id, owner) {
      const row = await claimNextProofWork(admin, kind, { owner, id });
      if (!row?.id) return null;
      return {
        id: String(row.id),
        kind,
        org_id: String(row.org_id ?? ''),
        job_id: String(row.job_id ?? ''),
        party_id: String(row.party_id ?? ''),
        phase: String(row.phase ?? 'after'),
        work_date: String(row.work_date ?? ''),
      };
    },
  };
}

let verificationWorker: DurableOutboxWorker<VerificationRow> | null = null;
const proofWorkers: DurableOutboxWorker<ProofRow>[] = [];

export function startSoldPathOutboxWorkers(): void {
  const admin = unscopedAdminOrNull();
  if (!admin) return;
  if (!verificationWorker) {
    verificationWorker = new DurableOutboxWorker<VerificationRow>({
      store: verificationStore(admin),
      run: async (row, attempt) => {
        await getVerificationOrchestrator().executeClaimed(admin, row, attempt);
      },
    });
    verificationWorker.start();
  }
  if (proofWorkers.length === 0) {
    for (const kind of KINDS) {
      const worker = new DurableOutboxWorker<ProofRow>({
        store: proofStore(admin, kind),
        run: async (row) => {
          const party = { org_id: row.org_id, job_id: row.job_id, id: row.party_id };
          if (kind === 'narration') {
            await queueNarration(admin, party, row.id, row.phase, row.work_date);
          } else if (kind === 'transcript') {
            await queueProofTranscript(admin, row.id);
          } else {
            await queueProofAnalysis(admin, party, row.work_date, row.id);
          }
        },
      });
      worker.start();
      proofWorkers.push(worker);
    }
  }
  logger.info('sold_path_outbox_started', { verification: true, proofKinds: KINDS });
}

export function stopSoldPathOutboxWorkers(): void {
  verificationWorker?.stop();
  verificationWorker = null;
  for (const w of proofWorkers) w.stop();
  proofWorkers.length = 0;
}

export function pokeSoldPathOutboxWorkers(): void {
  verificationWorker?.poke();
  for (const w of proofWorkers) w.poke();
}
