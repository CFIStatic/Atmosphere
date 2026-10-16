-- Patch room bounds onto ai_findings without replacing the object.
--
-- Room refresh used to read ai_findings, set roomSegments, and write the
-- whole JSON back. A people, privacy, or conversation update that landed
-- after that read was dropped. jsonb_set changes only roomSegments.

create or replace function public.set_proof_room_segments(p_proof_id uuid, p_segments jsonb)
returns void
language sql
set search_path = public, pg_temp
as $$
  update public.job_proofs
  set ai_findings = jsonb_set(
    case
      when jsonb_typeof(ai_findings) = 'object' then ai_findings
      else '{}'::jsonb
    end,
    '{roomSegments}',
    case
      when jsonb_typeof(p_segments) = 'array' then p_segments
      else '[]'::jsonb
    end,
    true
  )
  where id = p_proof_id;
$$;

revoke all on function public.set_proof_room_segments(uuid, jsonb) from public;
revoke all on function public.set_proof_room_segments(uuid, jsonb) from anon;
revoke all on function public.set_proof_room_segments(uuid, jsonb) from authenticated;
grant execute on function public.set_proof_room_segments(uuid, jsonb) to service_role;

comment on function public.set_proof_room_segments(uuid, jsonb) is
  'Set job_proofs.ai_findings.roomSegments. Other findings keys are left as they are.';
