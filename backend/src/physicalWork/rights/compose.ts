/**
 * Compose operational episode rights with rights_manifests.
 * This is not a second consent system.
 */

export type WorkDataRights = 'job_only' | 'org_analytics' | 'licensable';
export type ConsentState = 'granted' | 'declined' | 'not_asked';

export interface RightsManifestBits {
  trainingAllowed?: boolean;
  evaluationAllowed?: boolean;
  category?: string;
  revokedAt?: string | null;
}

export function composeDataRights(input: {
  workDataRights?: string | null;
  workerConsent?: string | null;
  manifest?: RightsManifestBits | null;
}): {
  workDataRights: WorkDataRights;
  workerConsent: ConsentState;
  trainingAllowed: boolean;
  evaluationAllowed: boolean;
  operationalOnly: boolean;
  reasons: string[];
} {
  const workDataRights = (input.workDataRights ?? 'job_only') as WorkDataRights;
  const workerConsent = (input.workerConsent ?? 'not_asked') as ConsentState;
  const reasons: string[] = [];
  const manifest = input.manifest;

  if (workDataRights === 'job_only') reasons.push('job_only');
  if (workerConsent !== 'granted') reasons.push(`consent:${workerConsent}`);
  if (manifest?.revokedAt) reasons.push('manifest_revoked');
  if (manifest?.category === 'operational_only') reasons.push('manifest_operational_only');
  if (manifest?.category === 'revoked' || manifest?.category === 'restricted') {
    reasons.push(`manifest_category:${manifest.category}`);
  }
  if (manifest && !manifest.trainingAllowed) reasons.push('manifest_training_not_permitted');

  const trainingAllowed =
    reasons.length === 0 && workDataRights === 'licensable' && workerConsent === 'granted';
  const evaluationAllowed =
    workerConsent === 'granted' &&
    workDataRights !== 'job_only' &&
    (manifest ? Boolean(manifest.evaluationAllowed || manifest.trainingAllowed) : workDataRights === 'licensable');

  return {
    workDataRights,
    workerConsent,
    trainingAllowed,
    evaluationAllowed,
    operationalOnly: !trainingAllowed,
    reasons,
  };
}
