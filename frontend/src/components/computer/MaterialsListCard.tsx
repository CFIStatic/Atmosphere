import { uniqueSources, type MaterialsListRow, type MaterialsSourceChip } from '../../lib/materialsList';

/**
 * Structured materials list for Chat. Never shows raw markdown bullets.
 * Clip/timestamp sources use the same chip affordance as Ask citations.
 */

export function MaterialsListCard({
  rows,
  note,
  onOpenSource,
}: {
  rows: MaterialsListRow[];
  note?: string;
  onOpenSource?: (source: MaterialsSourceChip) => void;
}) {
  const showSpec = rows.some((r) => Boolean(r.spec && r.spec.trim()));
  return (
    <div data-testid="computer-materials-list" className="rounded-xl border border-line bg-paper-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Materials</p>
      <p className="mt-0.5 text-[15px] font-semibold text-ink-900">From this job file</p>
      {rows.length ? (
        <div className="mt-3 overflow-hidden rounded-lg border border-line bg-paper-0">
          <table className="w-full text-left text-[13px]" data-testid="materials-table">
            <thead className="bg-paper-50 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-2.5 py-2 font-semibold">Item</th>
                {showSpec ? <th className="px-2.5 py-2 font-semibold">Spec</th> : null}
                <th className="px-2.5 py-2 font-semibold">Qty</th>
                <th className="px-2.5 py-2 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.id} data-testid="materials-row">
                  <td className="px-2.5 py-2 font-medium text-ink-900">{row.item}</td>
                  {showSpec ? <td className="px-2.5 py-2 text-ink-700">{row.spec || '—'}</td> : null}
                  <td className="px-2.5 py-2 text-ink-800">
                    {row.quantity != null ? (
                      `${row.quantity}${row.unit ? ` ${row.unit}` : ''}`
                    ) : (
                      <span className="font-semibold text-caution-600" data-testid="qty-unknown">
                        Unknown
                      </span>
                    )}
                  </td>
                  <td className="px-2.5 py-2">
                    <div className="flex flex-wrap gap-1" data-testid="ask-source-chips">
                      {uniqueSources(row.sources).map((source) => (
                        <button
                          key={`${source.id}-${source.label}`}
                          type="button"
                          data-testid="ask-source-chip"
                          data-source-id={source.id}
                          onClick={() => onOpenSource?.(source)}
                          className="rounded-full border border-line bg-paper-50 px-2.5 py-0.5 text-[11px] font-medium text-brand-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800"
                        >
                          {source.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink-700">No materials found on file yet.</p>
      )}
      <p className="mt-2 text-xs text-ink-500">
        {note ||
          'Quantities come only from the evidence. Ask me to order these from Home Depot when you’re ready. Nothing is purchased until you Approve.'}
      </p>
    </div>
  );
}
