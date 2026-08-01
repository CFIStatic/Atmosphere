import type { DamageFinding, MitigationRequirement } from '../../lib/api';

/**
 * What's wrong with the property, and what rules oblige the crew to do about it.
 *
 * Findings come from photo captions and field notes. Requirements come from
 * IICRC practice, insurance documentation expectations, construction/health
 * obligations, and carrier SLA terms. Scope is supposed to fulfill the
 * requirements the findings support.
 */

const AUTHORITY_LABEL: Record<MitigationRequirement['authority'], string> = {
  iicrc: 'IICRC',
  insurance: 'Insurance',
  construction_code: 'Code / health',
  carrier_sla: 'Carrier SLA',
};

export function FindingsPanel({
  findings = [],
  requirements = [],
}: {
  findings?: DamageFinding[];
  requirements?: MitigationRequirement[];
}) {
  if (findings.length === 0 && requirements.length === 0) return null;

  const unmet = requirements.filter((r) => !r.addressed);
  const met = requirements.filter((r) => r.addressed);

  return (
    <div className="space-y-4">
      {findings.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-ink-800/60 p-5">
          <h2 className="text-lg font-semibold text-white">
            What&apos;s wrong ({findings.length})
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Identified from photo captions and field notes — the observational record of the loss.
          </p>
          <ul className="mt-3 space-y-2">
            {findings.map((finding) => (
              <li
                key={finding.id}
                className="rounded-lg border border-white/5 bg-ink-900/40 px-3 py-2 text-sm text-gray-300"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium text-white">{finding.summary}</span>
                  <span className="text-[11px] uppercase tracking-wide text-gray-600">
                    {finding.kind.replace(/_/g, ' ')} · {finding.confidence}
                  </span>
                </div>
                {(finding.roomName || finding.material) && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {[finding.roomName, finding.material?.replace(/_/g, ' ')].filter(Boolean).join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {requirements.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-ink-800/60 p-5">
          <h2 className="text-lg font-semibold text-white">
            Required mitigation ({requirements.length})
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Obligations from IICRC practice, insurance documentation rules, construction/health
            expectations, and carrier program terms.
          </p>
          <ul className="mt-3 space-y-2">
            {unmet.map((req) => (
              <RequirementRow key={req.id} req={req} />
            ))}
            {met.map((req) => (
              <RequirementRow key={req.id} req={req} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RequirementRow({ req }: { req: MitigationRequirement }) {
  const tone = req.addressed
    ? 'border-emerald-500/20 bg-emerald-500/5'
    : req.status === 'undetermined'
      ? 'border-amber-500/25 bg-amber-500/5'
      : 'border-red-500/20 bg-red-500/5';

  return (
    <li className={`rounded-lg border px-3 py-2.5 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-white">{req.title}</p>
        <span className="text-[11px] uppercase tracking-wide text-gray-500">
          {AUTHORITY_LABEL[req.authority]}
          {req.addressed ? ' · covered' : ` · ${req.status.replace(/_/g, ' ')}`}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-gray-400">{req.detail}</p>
      {!req.addressed && (
        <p className="mt-1.5 text-xs text-brand-300">→ {req.action}</p>
      )}
    </li>
  );
}
