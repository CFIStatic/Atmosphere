import { COMPUTER_ACTION_LABEL, type ComputerTaskApproval } from '../../lib/computer';

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * The one place a person lets Computer submit, send, pay, delete, sign,
 * accept terms or upload. Shows the page as it is now and every filled
 * field with its value and where that value came from (checked in code).
 */
export function ComputerApprovalCard({
  approval,
  busy,
  onApprove,
  onTakeControl,
  onCancel,
}: {
  approval: ComputerTaskApproval;
  busy?: boolean;
  onApprove: () => void;
  onTakeControl: () => void;
  onCancel: () => void;
}) {
  const host = hostOf(approval.pageUrl);
  const unverified = approval.fields.filter((f) => !f.verified).length;
  return (
    <div className="space-y-3 rounded-xl border border-caution-600/40 bg-caution-50 p-3" data-testid="computer-approval-card">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-caution-600">
          Needs your approval · {COMPUTER_ACTION_LABEL[approval.actionKind]}
        </p>
        <p className="mt-0.5 text-[15px] font-semibold text-ink-900">Click “{approval.buttonLabel}”{host ? ` on ${host}` : ''}?</p>
        <p className="mt-1 text-sm text-ink-700">{approval.summary}</p>
      </div>
      {approval.screenshot ? (
        <img
          src={approval.screenshot}
          alt={`The page before clicking ${approval.buttonLabel}`}
          className="mx-auto max-h-64 w-auto max-w-full rounded-lg border border-line bg-paper-0 object-contain"
          data-testid="computer-approval-screenshot"
        />
      ) : null}
      {approval.fields.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-paper-0" aria-label="Filled fields">
          {approval.fields.map((f, i) => (
            <li
              key={`${f.label}-${i}`}
              className="grid gap-x-3 gap-y-0.5 px-2.5 py-2 text-[13px] sm:grid-cols-[minmax(7rem,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)]"
              data-testid="computer-approval-field"
            >
              <span className="text-[12px] text-ink-600 sm:text-[13px]">{f.label}</span>
              <span className="break-words font-medium text-ink-900">{f.value}</span>
              <span className={`text-[12px] ${f.verified ? 'text-success-600' : 'font-semibold text-danger-600'}`}>
                {f.verified ? '✓ ' : '⚠ '}
                {f.source}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-600">Computer did not list any filled fields.</p>
      )}
      {unverified ? (
        <p className="text-[12px] font-medium text-danger-600">
          {unverified === 1 ? '1 value' : `${unverified} values`} did not come from this job or your message. Check before approving, or take control and fix it.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          className="rounded-full bg-brand-600 px-3.5 py-1.5 text-[13px] font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
        >
          Approve “{approval.buttonLabel}”
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onTakeControl}
          className="rounded-full border border-line bg-paper-0 px-3.5 py-1.5 text-[13px] font-semibold text-ink-800 transition hover:border-brand-200 disabled:opacity-50"
        >
          Take control
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-full border border-line bg-paper-0 px-3.5 py-1.5 text-[13px] font-medium text-ink-600 transition hover:border-danger-600/40 hover:text-danger-600 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      <p className="text-[11px] text-ink-500">One approval covers one click. Nothing is submitted until you approve.</p>
    </div>
  );
}
