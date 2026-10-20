/**
 * The verification pipeline (verification_videos) can fail while the proof's
 * own columns still say "done". Lists must show that failure, so attach the
 * latest verification status to each proof row before deriving its label.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function attachVerificationStatus(client: any, orgId: string, proofs: any[]): Promise<void> {
  const ids = [...new Set(proofs.map((p) => p?.id).filter((id) => typeof id === 'string' && id))];
  if (!ids.length) return;
  try {
    const { data, error } = await client
      .from('verification_videos')
      .select('proof_id, status, updated_at')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .in('proof_id', ids);
    if (error || !Array.isArray(data)) return;
    const latest = new Map<string, { status: string; at: string }>();
    for (const row of data as any[]) {
      if (!row?.proof_id) continue;
      const prev = latest.get(row.proof_id);
      if (!prev || String(row.updated_at ?? '') > prev.at) {
        latest.set(row.proof_id, { status: String(row.status ?? ''), at: String(row.updated_at ?? '') });
      }
    }
    for (const proof of proofs) {
      const hit = proof?.id ? latest.get(proof.id) : undefined;
      if (hit) proof.verification_status = hit.status;
    }
  } catch {
    // A missing status must never break the list.
  }
}
