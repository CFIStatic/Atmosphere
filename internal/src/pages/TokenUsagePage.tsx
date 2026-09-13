import { useEffect, useMemo, useState } from 'react';
import { api, tokenUsageRange, type TokenUsageWindow } from '../lib/api';
import type { TokenUsageAnalyticsPayload } from '../lib/types';
import { count, nanosToMoney, tokens } from '../lib/format';
import { EmptyState, SectionHeading, StatTile } from '../components/ui';

const WINDOWS: { id: TokenUsageWindow; label: string }[] = [
  { id: '30d', label: 'Last 30 days' },
  { id: 'all', label: 'All time' },
];

const FEATURE_LABELS: Record<string, string> = {
  video_analysis: 'Video analysis',
  chat: 'Chat',
  ask: 'Ask',
  other: 'Other',
};

export function TokenUsagePage() {
  const [windowId, setWindowId] = useState<TokenUsageWindow>('30d');
  const range = useMemo(() => tokenUsageRange(windowId), [windowId]);
  const [data, setData] = useState<TokenUsageAnalyticsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .tokenUsage(range)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setData(null);
          setError(err instanceof Error ? err.message : 'Could not load token usage');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const totals = data?.totals;
  const empty = !loading && !error && (totals?.eventCount ?? 0) === 0;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Token usage</h1>
          <p className="mt-1 text-sm text-ink-500">
            Global AI tokens from the durable ledger (<code className="text-xs">token_usage_events</code>
            ) — org, user, and model per call. Metering remains the cost view.
          </p>
        </div>
        <div className="flex rounded-lg border border-line bg-paper-0 p-0.5" role="tablist" aria-label="Usage window">
          {WINDOWS.map((option) => {
            const active = windowId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setWindowId(option.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  active ? 'bg-paper-200 text-ink-900' : 'text-ink-600 hover:text-ink-900'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-danger-600">{error}</p>}
      {loading && !data && <p className="mt-6 text-sm text-ink-500">Loading token usage…</p>}

      {totals && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Total tokens"
            value={tokens(totals.totalTokens)}
            footnote={`${count(totals.eventCount)} metered calls`}
          />
          <StatTile
            label="Input / output"
            value={`${tokens(totals.inputTokens)} / ${tokens(totals.outputTokens)}`}
            footnote={totals.cacheTokens ? `${tokens(totals.cacheTokens)} cached` : 'No cache hits'}
          />
          <StatTile label="Customers" value={count(totals.distinctOrgs)} footnote="Orgs with usage" />
          <StatTile
            label="Users / models"
            value={`${count(totals.distinctUsers)} / ${count(totals.distinctModels)}`}
            footnote={`Billable ${nanosToMoney(totals.priceNanos)}`}
          />
        </div>
      )}

      {empty && (
        <div className="mt-10">
          <EmptyState
            title="No token usage in this window"
            body="The ledger is empty for this range. New model calls (video analysis, Ask) write org, user, and model going forward — history before logging stays blank."
          />
        </div>
      )}

      {!empty && (
        <>
          <SectionHeading title="By customer" hint="Organizations ranked by tokens" />
          <div className="overflow-hidden rounded-xl border border-line bg-paper-0">
            <table className="w-full text-sm">
              <thead className="bg-paper-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3 text-right">Events</th>
                  <th className="px-4 py-3 text-right">Tokens</th>
                  <th className="px-4 py-3 text-right">Users</th>
                  <th className="px-4 py-3 text-right">Models</th>
                  <th className="px-4 py-3 text-right">Billable</th>
                </tr>
              </thead>
              <tbody>
                {(data?.byCustomer ?? []).map((row) => (
                  <tr key={row.orgId} className="border-t border-line">
                    <td className="px-4 py-3 font-medium">{row.orgName}</td>
                    <td className="px-4 py-3 text-right font-mono">{count(row.eventCount)}</td>
                    <td className="px-4 py-3 text-right font-mono">{tokens(row.totalTokens)}</td>
                    <td className="px-4 py-3 text-right font-mono">{count(row.distinctUsers)}</td>
                    <td className="px-4 py-3 text-right font-mono">{count(row.distinctModels)}</td>
                    <td className="px-4 py-3 text-right font-mono">{nanosToMoney(row.priceNanos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionHeading title="By user" hint="Attributed teammates across orgs" />
          <div className="overflow-hidden rounded-xl border border-line bg-paper-0">
            <table className="w-full text-sm">
              <thead className="bg-paper-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3 text-right">Events</th>
                  <th className="px-4 py-3 text-right">Tokens</th>
                  <th className="px-4 py-3 text-right">Billable</th>
                </tr>
              </thead>
              <tbody>
                {(data?.byUser ?? []).map((row) => (
                  <tr key={`${row.userId}-${row.orgId}`} className="border-t border-line">
                    <td className="px-4 py-3">
                      <div className="font-medium">{row.userName}</div>
                      {row.email && <div className="text-xs text-ink-500">{row.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-ink-600">{row.orgName}</td>
                    <td className="px-4 py-3 text-right font-mono">{count(row.eventCount)}</td>
                    <td className="px-4 py-3 text-right font-mono">{tokens(row.totalTokens)}</td>
                    <td className="px-4 py-3 text-right font-mono">{nanosToMoney(row.priceNanos)}</td>
                  </tr>
                ))}
                {(data?.byUser ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-ink-500">
                      No user-attributed events in this window (system / background calls only).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <SectionHeading title="By model" hint="Model id recorded on each call" />
          <div className="overflow-hidden rounded-xl border border-line bg-paper-0">
            <table className="w-full text-sm">
              <thead className="bg-paper-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3 text-right">Events</th>
                  <th className="px-4 py-3 text-right">Tokens</th>
                  <th className="px-4 py-3 text-right">Orgs</th>
                  <th className="px-4 py-3 text-right">Users</th>
                  <th className="px-4 py-3 text-right">Billable</th>
                </tr>
              </thead>
              <tbody>
                {(data?.byModel ?? []).map((row) => (
                  <tr key={row.model} className="border-t border-line">
                    <td className="px-4 py-3 font-mono text-sm">{row.model}</td>
                    <td className="px-4 py-3 text-right font-mono">{count(row.eventCount)}</td>
                    <td className="px-4 py-3 text-right font-mono">{tokens(row.totalTokens)}</td>
                    <td className="px-4 py-3 text-right font-mono">{count(row.distinctOrgs)}</td>
                    <td className="px-4 py-3 text-right font-mono">{count(row.distinctUsers)}</td>
                    <td className="px-4 py-3 text-right font-mono">{nanosToMoney(row.priceNanos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(data?.byFeature?.length ?? 0) > 0 && (
            <>
              <SectionHeading title="By feature" hint="video_analysis · ask · chat · other" />
              <div className="overflow-hidden rounded-xl border border-line bg-paper-0">
                <table className="w-full text-sm">
                  <thead className="bg-paper-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-4 py-3">Feature</th>
                      <th className="px-4 py-3 text-right">Events</th>
                      <th className="px-4 py-3 text-right">Tokens</th>
                      <th className="px-4 py-3 text-right">Billable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.byFeature ?? []).map((row) => (
                      <tr key={row.feature} className="border-t border-line">
                        <td className="px-4 py-3 font-medium">
                          {FEATURE_LABELS[row.feature] ?? row.feature}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{count(row.eventCount)}</td>
                        <td className="px-4 py-3 text-right font-mono">{tokens(row.totalTokens)}</td>
                        <td className="px-4 py-3 text-right font-mono">{nanosToMoney(row.priceNanos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
