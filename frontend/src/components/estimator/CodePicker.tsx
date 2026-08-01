import { useEffect, useState } from 'react';
import { api, ApiError, type CodeSearchHit, usd } from '../../lib/api';
import { SpinnerIcon } from '../icons';

/**
 * Search the connected Xactimate account price list and pick a real selector.
 *
 * Knowledge profiles propose *what* to bill; this picker is how an estimator
 * chooses *which account code* — the only codes that exist are the ones on the
 * synced / uploaded price list.
 */
export function CodePicker({
  initialQuery = '',
  preferUnit,
  preferCategory,
  onPick,
  onCancel,
}: {
  initialQuery?: string;
  preferUnit?: string;
  preferCategory?: string;
  onPick: (hit: CodeSearchHit) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<CodeSearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void runSearch(query);
    }, 220);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, preferUnit, preferCategory]);

  async function runSearch(q: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.xactimateSearchCodes(q, {
        limit: 20,
        preferUnit,
        preferCategory,
      });
      setHits(result.hits);
      setMessage(result.message ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not search the price list.');
      setHits([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-brand-500/30 bg-ink-900 p-3 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Account catalog
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-500 transition hover:text-gray-300"
        >
          Close
        </button>
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search Xactimate code or description…"
        className="mt-2 w-full rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
      />
      {busy && (
        <p className="mt-2 flex items-center gap-2 text-xs text-gray-500">
          <SpinnerIcon className="animate-spin" width={12} height={12} /> Searching…
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      {message && !error && <p className="mt-2 text-xs text-amber-300">{message}</p>}
      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
        {hits.map((hit) => (
          <li key={`${hit.code}-${hit.description}`}>
            <button
              type="button"
              onClick={() => onPick(hit)}
              className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-ink-700"
            >
              <span>
                <span className="font-mono text-xs text-brand-300">{hit.code}</span>
                <span className="mt-0.5 block text-xs text-gray-400">{hit.description}</span>
              </span>
              <span className="shrink-0 text-right text-xs text-gray-500">
                {hit.unit}
                <span className="block tabular-nums text-gray-400">{usd(hit.unitPrice)}</span>
              </span>
            </button>
          </li>
        ))}
        {!busy && query.trim() && hits.length === 0 && !error && !message && (
          <li className="px-2 py-2 text-xs text-gray-500">No matching codes on this price list.</li>
        )}
      </ul>
    </div>
  );
}
