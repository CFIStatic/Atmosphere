import { composeDataRights } from '../rights/compose.js';
import type { PhysicalWorkRecord } from '../types.js';

export function gateTrainingExport(record: PhysicalWorkRecord): { allowed: boolean; reasons: string[] } {
  const composed = composeDataRights({
    workDataRights: record.rights.dataRights,
    workerConsent: record.rights.workerConsent,
  });
  return { allowed: composed.trainingAllowed, reasons: composed.reasons };
}
