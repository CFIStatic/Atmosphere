/**
 * Implicit revision acknowledgement for job-share invites.
 *
 * Opening the invite (or filing a recording) is the acceptance ceremony.
 * The office still gets a revision row; the sub does not type a name or tap Accept.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function acknowledgeShareRevision(input: {
  admin: any;
  orgId: string;
  jobId: string;
  partyId: string;
  revision: number | null | undefined;
  /** Display name stored on the ack row for the office record. */
  acknowledgedName: string;
}): Promise<number | null> {
  const revision = input.revision;
  if (revision == null || revision < 1) return null;
  const name = input.acknowledgedName.trim().slice(0, 160) || 'Opened invite';
  const { error } = await input.admin.from('job_acknowledgements').insert({
    org_id: input.orgId,
    job_id: input.jobId,
    party_id: input.partyId,
    revision,
    acknowledged_name: name,
  });
  // Unique (party_id, revision) — double-open is fine.
  if (error && error.code !== '23505') {
    console.warn(`[job-share] implicit ack failed: ${error.message}`);
    return null;
  }
  return revision;
}

export function ackDisplayName(party: {
  contact_name?: string | null;
  company?: string | null;
}): string {
  const contact = party.contact_name?.trim();
  if (contact) return contact;
  const company = party.company?.trim();
  if (company) return company;
  return 'Opened invite';
}
