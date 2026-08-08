/**
 * Rights and dataset eligibility.
 *
 * No record enters the dataset layer without an auditable eligibility pass.
 */

export type RightsCategory =
  | 'operational_only'
  | 'internal_improvement'
  | 'evaluation_allowed'
  | 'training_allowed'
  | 'restricted'
  | 'pending_review'
  | 'revoked';

export type PrivacyStatus =
  | 'unknown'
  | 'pending'
  | 'clear'
  | 'findings_present'
  | 'redacted'
  | 'export_safe'
  | 'blocked'
  | 'review_required';

export interface RightsManifestInput {
  category: RightsCategory;
  operationalProcessing?: boolean;
  internalImprovement?: boolean;
  evaluationAllowed?: boolean;
  trainingAllowed?: boolean;
  thirdPartyTransfer?: boolean;
  derivativeAllowed?: boolean;
  deidentificationAllowed?: boolean;
  revokedAt?: string | null;
  policyVersion?: string;
}

export interface EligibilityInput {
  rights: RightsManifestInput;
  privacyStatus: PrivacyStatus;
  provenanceComplete: boolean;
  qualityScore: number;
  quarantined?: boolean;
  decisionStatus?: string;
  minQuality?: number;
  purpose?: 'evaluation' | 'training' | 'internal_improvement';
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  rightsCategory: RightsCategory;
  privacyStatus: PrivacyStatus;
  policyVersion: string;
}

const DEFAULT_MIN_QUALITY = 0.55;

export function evaluateDatasetEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: string[] = [];
  const purpose = input.purpose ?? 'training';
  const minQuality = input.minQuality ?? DEFAULT_MIN_QUALITY;
  const policyVersion = input.rights.policyVersion ?? 'v1';

  if (input.quarantined) reasons.push('quarantined');
  if (input.rights.revokedAt) reasons.push('rights_revoked');
  if (input.rights.category === 'revoked' || input.rights.category === 'restricted') {
    reasons.push(`rights_category:${input.rights.category}`);
  }
  if (input.rights.category === 'pending_review') reasons.push('rights_pending_review');
  if (input.rights.category === 'operational_only') reasons.push('operational_only');

  if (purpose === 'training' && !input.rights.trainingAllowed) {
    reasons.push('training_not_permitted');
  }
  if (purpose === 'evaluation' && !input.rights.evaluationAllowed && !input.rights.trainingAllowed) {
    reasons.push('evaluation_not_permitted');
  }
  if (purpose === 'internal_improvement' && !input.rights.internalImprovement && !input.rights.trainingAllowed) {
    reasons.push('internal_improvement_not_permitted');
  }

  if (!['clear', 'redacted', 'export_safe'].includes(input.privacyStatus)) {
    reasons.push(`privacy_status:${input.privacyStatus}`);
  }
  if (input.privacyStatus === 'blocked' || input.privacyStatus === 'review_required') {
    reasons.push('privacy_blocked');
  }

  if (!input.provenanceComplete) reasons.push('provenance_incomplete');
  if (input.qualityScore < minQuality) {
    reasons.push(`quality_below_threshold:${input.qualityScore}<${minQuality}`);
  }

  if (input.decisionStatus && ['uncertain', 'rejected', 'contradicted', 'needs_review'].includes(input.decisionStatus)) {
    // Uncertain/rejected can still be valuable as evaluation negatives when explicitly allowed.
    if (purpose === 'training' && input.decisionStatus !== 'partially_verified') {
      // Allow contradicted/rejected into training as negative examples only when training_allowed
      // and caller sets purpose training — still require explicit opt-in via rights.
      if (!['verified', 'likely_verified', 'human_verified', 'partially_verified', 'rejected', 'contradicted'].includes(input.decisionStatus)) {
        reasons.push(`decision_not_admissible:${input.decisionStatus}`);
      }
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    rightsCategory: input.rights.category,
    privacyStatus: input.privacyStatus,
    policyVersion,
  };
}

export async function upsertRightsManifest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: {
    orgId: string;
    jobId?: string | null;
    videoId?: string | null;
    resultId?: string | null;
    rights: RightsManifestInput;
  },
): Promise<string> {
  const row = {
    org_id: opts.orgId,
    job_id: opts.jobId ?? null,
    video_id: opts.videoId ?? null,
    result_id: opts.resultId ?? null,
    category: opts.rights.category,
    operational_processing: opts.rights.operationalProcessing ?? true,
    internal_improvement: opts.rights.internalImprovement ?? false,
    evaluation_allowed: opts.rights.evaluationAllowed ?? false,
    training_allowed: opts.rights.trainingAllowed ?? false,
    third_party_transfer: opts.rights.thirdPartyTransfer ?? false,
    derivative_allowed: opts.rights.derivativeAllowed ?? false,
    deidentification_allowed: opts.rights.deidentificationAllowed ?? false,
    policy_version: opts.rights.policyVersion ?? 'v1',
    revoked_at: opts.rights.revokedAt ?? null,
  };

  const { data, error } = await supabase
    .from('rights_manifests')
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function recordEligibilityDecision(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: {
    orgId: string;
    resultId: string;
    videoId?: string | null;
    decision: EligibilityResult;
  },
): Promise<void> {
  await supabase.from('eligibility_decisions').insert({
    org_id: opts.orgId,
    result_id: opts.resultId,
    video_id: opts.videoId ?? null,
    eligible: opts.decision.eligible,
    reasons: opts.decision.reasons,
    rights_category: opts.decision.rightsCategory,
    privacy_status: opts.decision.privacyStatus,
    policy_version: opts.decision.policyVersion,
  });
  await supabase
    .from('verification_results')
    .update({
      dataset_eligible: opts.decision.eligible,
      eligibility_reason: opts.decision.reasons.join(',') || null,
      privacy_status: opts.decision.privacyStatus,
    })
    .eq('id', opts.resultId)
    .eq('org_id', opts.orgId);
}
