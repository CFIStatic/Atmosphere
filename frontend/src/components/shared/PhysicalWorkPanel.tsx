import type { PhysicalWorkRecord } from '../../lib/api';

/**
 * The structured day, shown under Proof of work.
 *
 * Footage stays above this. This block is the record: what the place was,
 * what a body did, with which tools, and what the model thought at the end
 * of the day — labelled as not an inspector.
 */

const OUTCOME_WORDS: Record<string, string> = {
  appears_complete: 'looks finished',
  in_progress: 'still under way',
  not_visible: 'not in shot',
  mixed: 'mixed across the scope',
  changed: 'the area changed',
  unknown: 'not settled',
};

function list(items: string[], empty = 'None recorded') {
  if (!items.length) return empty;
  return items.join('; ');
}

export function PhysicalWorkPanel({ record }: { record: PhysicalWorkRecord }) {
  const outcomeWord = record.outcome
    ? (OUTCOME_WORDS[record.outcome.status] ?? record.outcome.status)
    : null;

  return (
    <div className="mt-3 rounded-lg border border-line bg-paper-50/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        Structured work record
      </p>
      <p className="mt-1 text-[11px] text-ink-500">
        Tier {record.tier}
        {record.goal.taskName ? ` · ${record.goal.taskName}` : record.goal.trade ? ` · ${record.goal.trade}` : ''}
        {' · '}
        {record.rights.trainingEligible ? 'training-eligible' : 'this job only'}
      </p>

      {(record.before?.summary || record.after?.summary) && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">Before</p>
            <p className="mt-0.5 text-[11px] text-ink-700">
              {record.before?.summary ?? 'No before reading yet.'}
            </p>
          </div>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">After</p>
            <p className="mt-0.5 text-[11px] text-ink-700">
              {record.after?.summary ?? 'No after reading yet.'}
            </p>
            {record.after?.changes.length ? (
              <p className="mt-0.5 text-[11px] text-ink-500">Changed: {list(record.after.changes)}</p>
            ) : null}
          </div>
        </div>
      )}

      {record.actions.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-line pt-2">
          {record.actions.slice(0, 8).map((action) => (
            <li key={`${action.sequence}-${action.action}`} className="text-[11px] text-ink-600">
              <span className="font-medium text-ink-800">{action.action}</span>
              {action.objectLabel ? ` · ${action.objectLabel}` : ''}
              {action.toolLabel ? ` · ${action.toolLabel}` : ''}
              {action.purpose ? ` — ${action.purpose}` : ''}
            </li>
          ))}
        </ul>
      )}

      {(record.tools.length > 0 || record.materials.length > 0) && (
        <p className="mt-1.5 text-[11px] text-ink-500">
          {record.tools.length ? `Tools: ${list(record.tools.map((t) => t.name))}` : ''}
          {record.tools.length && record.materials.length ? ' · ' : ''}
          {record.materials.length ? `Materials: ${list(record.materials.map((m) => m.name))}` : ''}
        </p>
      )}

      {record.outcome && (
        <p className="mt-2 text-[11px] text-ink-700">
          End of day (AI, not an inspector): {outcomeWord}
          {record.outcome.materialChange ? ` · ${record.outcome.materialChange} change` : ''}
        </p>
      )}
    </div>
  );
}
