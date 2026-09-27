-- Field Capture wrote the custody line for action = 'uploaded' without an
-- actor. The party was opened by the person in that Field Capture session,
-- and job_parties.created_by is that user. Copy it onto the upload row when
-- the creator is an active member of the same org. Rows with no creator, or
-- a creator outside the org, stay null — this does not guess across people.

update public.job_evidence_access as access
set actor_id = party.created_by
from public.job_proofs as proof
join public.job_parties as party on party.id = proof.party_id
where access.proof_id = proof.id
  and access.action = 'uploaded'
  and access.actor_id is null
  and party.created_by is not null
  and exists (
    select 1
    from public.org_members as member
    where member.org_id = access.org_id
      and member.user_id = party.created_by
      and member.status = 'active'
  );
