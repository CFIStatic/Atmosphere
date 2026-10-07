import { useEffect, useMemo, useState } from 'react';
import { api, tokenUsageRange, type TokenUsageWindow } from '../lib/api';
import type { TokenUsageAnalyticsPayload } from '../lib/types';
import { count, nanosToMoney, tokens } from '../lib/format';
import { EmptyState } from '../components/ui';
import { FEATURE_LABELS, mergeAskIntoChat } from '../lib/tokenFeatures';
import { ErrorLine, KpiStrip, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';
import { nanosToUsd } from '../lib/excel';


const WINDOWS: { id: TokenUsageWindow; label: string }[] = [
  { id: '30d', label: 'Last 30 days' },
  { id: 'all', label: 'All time' },
];

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

  const windowSlug = windowId === 'all' ? 'all-time' : 'last-30-days';
  const byCustomer = data?.byCustomer ?? [];
  const byUser = data?.byUser ?? [];
  const byModel = data?.byModel ?? [];
  const byFeature = mergeAskIntoChat(data?.byFeature);
  const usdFine = '"$"#,##0.0000';

  return (
    <div>
      <PageHeader
        eyebrow="AI cost & usage"
        title="Token usage"
        subtitle={
          <>
            Global AI tokens from the durable ledger (<code className="text-[12px]">token_usage_events</code>): org, user,
            and model per call. Metering remains the cost view.
          </>
        }
        actions={
          <div className="flex border border-line bg-paper-0 p-0.5" role="tablist" aria-label="Usage window">
            {WINDOWS.map((option) => {
              const active = windowId === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setWindowId(option.id)}
                  className={`px-3 py-1 text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    active ? 'bg-ink-900 text-paper-0' : 'text-ink-600 hover:text-ink-900'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        }
      />

      {data?.window && (
        <p className="mt-3 text-[12px] text-ink-600" data-testid="token-usage-window">
          <span className="font-semibold text-ink-800">{data.window.label}</span>
          {' · '}
          {new Date(data.window.from).toISOString().slice(0, 10)} to {new Date(data.window.to).toISOString().slice(0, 10)}
          {' · '}Billable = provider cost × markup, the same rule as Settings › Billing
          {data.pricing?.rateCardVerifiedAt ? ` · rate card verified ${data.pricing.rateCardVerifiedAt}` : ''}
        </p>
      )}

      {data?.health && !data.health.ok && (
        <div
          role="alert"
          data-testid="token-usage-unpriced"
          className="mt-4 border-l-2 border-danger-600 bg-danger-50 px-3 py-2 text-[13px] text-danger-600"
        >
          <span className="font-semibold">
            {count(data.health.unpricedEvents)} AI call{data.health.unpricedEvents === 1 ? '' : 's'} with tokens but no price.
          </span>{' '}
          No rate-card entry for{' '}
          {data.health.unpricedModels.map((m) => `${m.model} (${count(m.events)})`).join(', ')}. These are not billed
          until the model is priced.
        </div>
      )}
      {data?.health && data.health.ok && data.health.repricedEvents > 0 && (
        <p className="mt-3 text-[12px] text-ink-500" data-testid="token-usage-repriced">
          {count(data.health.repricedEvents)} call{data.health.repricedEvents === 1 ? ' was' : 's were'} stored at $0 and{' '}
          {data.health.repricedEvents === 1 ? 'is' : 'are'} priced here from the official rate card.
        </p>
      )}

      {error && <ErrorLine message={error} />}
      {loading && !data && <p className="mt-6 text-[13px] text-ink-500">Loading token usage…</p>}

      {totals && (
        <KpiStrip
          download={{ table: `token-usage-totals-${windowSlug}`, label: 'token usage totals' }}
          items={[
            {
              label: 'Total tokens',
              unit: `${count(totals.eventCount)} metered calls`,
              value: tokens(totals.totalTokens),
              raw: totals.totalTokens,
              rawType: 'integer',
            },
            {
              label: 'Input / output',
              unit: totals.cacheTokens ? `${tokens(totals.cacheTokens)} cached` : 'No cache hits',
              value: `${tokens(totals.inputTokens)} / ${tokens(totals.outputTokens)}`,
              raw: totals.inputTokens,
              rawUnit: 'input tokens',
              note: `${count(totals.outputTokens)} output tokens`,
            },
            { label: 'Customers', unit: 'Orgs with usage', value: count(totals.distinctOrgs), raw: totals.distinctOrgs, rawType: 'integer' },
            {
              label: 'Users / models',
              unit: `Billable ${nanosToMoney(totals.priceNanos)}`,
              value: `${count(totals.distinctUsers)} / ${count(totals.distinctModels)}`,
              raw: nanosToUsd(totals.priceNanos),
              rawUnit: 'USD billable',
            },
          ]}
        />
      )}

      {empty && (
        <div className="mt-10">
          <EmptyState
            title="No token usage in this window"
            body="The ledger is empty for this range. New model calls (video analysis, chat) write org, user, and model going forward — history before logging stays blank."
          />
        </div>
      )}

      {!empty && data && (
        <>
          <Section
            title="By customer"
            note="Organizations ranked by tokens"
            actions={
              <DownloadButton
                table={`token-usage-by-customer-${windowSlug}`}
                label="token usage by customer"
                disabled={byCustomer.length === 0}
                sheets={() => [
                  {
                    name: 'By customer',
                    columns: [
                      { header: 'Organization' },
                      { header: 'Org id' },
                      { header: 'Events', type: 'integer' },
                      { header: 'Input tokens', type: 'integer' },
                      { header: 'Output tokens', type: 'integer' },
                      { header: 'Cache tokens', type: 'integer' },
                      { header: 'Total tokens', type: 'integer' },
                      { header: 'Users', type: 'integer' },
                      { header: 'Models', type: 'integer' },
                      { header: 'Billable, USD', type: 'usd', format: usdFine },
                    ],
                    rows: byCustomer.map((r) => [
                      r.orgName,
                      r.orgId,
                      r.eventCount,
                      r.inputTokens,
                      r.outputTokens,
                      r.cacheTokens,
                      r.totalTokens,
                      r.distinctUsers,
                      r.distinctModels,
                      nanosToUsd(r.priceNanos),
                    ]),
                  },
                ]}
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="report-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th className="num">Events</th>
                    <th className="num">Tokens</th>
                    <th className="num">Users</th>
                    <th className="num">Models</th>
                    <th className="num">Billable</th>
                  </tr>
                </thead>
                <tbody>
                  {byCustomer.map((row) => (
                    <tr key={row.orgId}>
                      <td className="font-medium text-ink-900">{row.orgName}</td>
                      <td className="num">{count(row.eventCount)}</td>
                      <td className="num">{tokens(row.totalTokens)}</td>
                      <td className="num">{count(row.distinctUsers)}</td>
                      <td className="num">{count(row.distinctModels)}</td>
                      <td className="num">{nanosToMoney(row.priceNanos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            title="By user"
            note="Attributed teammates across orgs"
            actions={
              <DownloadButton
                table={`token-usage-by-user-${windowSlug}`}
                label="token usage by user"
                disabled={byUser.length === 0}
                sheets={() => [
                  {
                    name: 'By user',
                    columns: [
                      { header: 'User' },
                      { header: 'Email' },
                      { header: 'User id' },
                      { header: 'Organization' },
                      { header: 'Org id' },
                      { header: 'Events', type: 'integer' },
                      { header: 'Input tokens', type: 'integer' },
                      { header: 'Output tokens', type: 'integer' },
                      { header: 'Cache tokens', type: 'integer' },
                      { header: 'Total tokens', type: 'integer' },
                      { header: 'Billable, USD', type: 'usd', format: usdFine },
                    ],
                    rows: byUser.map((r) => [
                      r.userName,
                      r.email,
                      r.userId,
                      r.orgName,
                      r.orgId,
                      r.eventCount,
                      r.inputTokens,
                      r.outputTokens,
                      r.cacheTokens,
                      r.totalTokens,
                      nanosToUsd(r.priceNanos),
                    ]),
                  },
                ]}
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="report-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Organization</th>
                    <th className="num">Events</th>
                    <th className="num">Tokens</th>
                    <th className="num">Billable</th>
                  </tr>
                </thead>
                <tbody>
                  {byUser.map((row) => (
                    <tr key={`${row.userId}-${row.orgId}`}>
                      <td>
                        <div className="font-medium text-ink-900">{row.userName}</div>
                        {row.email && <div className="text-[11.5px] text-ink-500">{row.email}</div>}
                      </td>
                      <td className="text-ink-600">{row.orgName}</td>
                      <td className="num">{count(row.eventCount)}</td>
                      <td className="num">{tokens(row.totalTokens)}</td>
                      <td className="num">{nanosToMoney(row.priceNanos)}</td>
                    </tr>
                  ))}
                  {byUser.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-ink-500">
                        No user-attributed events in this window (system / background calls only).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            title="By model"
            note="Model id recorded on each call"
            actions={
              <DownloadButton
                table={`token-usage-by-model-${windowSlug}`}
                label="token usage by model"
                disabled={byModel.length === 0}
                sheets={() => [
                  {
                    name: 'By model',
                    columns: [
                      { header: 'Model' },
                      { header: 'Events', type: 'integer' },
                      { header: 'Input tokens', type: 'integer' },
                      { header: 'Output tokens', type: 'integer' },
                      { header: 'Cache tokens', type: 'integer' },
                      { header: 'Total tokens', type: 'integer' },
                      { header: 'Orgs', type: 'integer' },
                      { header: 'Users', type: 'integer' },
                      { header: 'Billable, USD', type: 'usd', format: usdFine },
                    ],
                    rows: byModel.map((r) => [
                      r.model,
                      r.eventCount,
                      r.inputTokens,
                      r.outputTokens,
                      r.cacheTokens,
                      r.totalTokens,
                      r.distinctOrgs,
                      r.distinctUsers,
                      nanosToUsd(r.priceNanos),
                    ]),
                  },
                ]}
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="report-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="num">Events</th>
                    <th className="num">Tokens</th>
                    <th className="num">Orgs</th>
                    <th className="num">Users</th>
                    <th className="num">Billable</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map((row) => (
                    <tr key={row.model}>
                      <td className="text-ink-800">{row.model}</td>
                      <td className="num">{count(row.eventCount)}</td>
                      <td className="num">{tokens(row.totalTokens)}</td>
                      <td className="num">{count(row.distinctOrgs)}</td>
                      <td className="num">{count(row.distinctUsers)}</td>
                      <td className="num">{nanosToMoney(row.priceNanos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {byFeature.length > 0 && (
            <Section
              title="By feature"
              note="Video analysis · Chat · Web search · Other"
              actions={
                <DownloadButton
                  table={`token-usage-by-feature-${windowSlug}`}
                  label="token usage by feature"
                  sheets={() => [
                    {
                      name: 'By feature',
                      columns: [
                        { header: 'Feature' },
                        { header: 'Feature key' },
                        { header: 'Events', type: 'integer' },
                        { header: 'Total tokens', type: 'integer' },
                        { header: 'Billable, USD', type: 'usd', format: usdFine },
                      ],
                      rows: byFeature.map((r) => [
                        FEATURE_LABELS[r.feature] ?? r.feature,
                        r.feature,
                        r.eventCount,
                        r.totalTokens,
                        nanosToUsd(r.priceNanos),
                      ]),
                    },
                  ]}
                />
              }
            >
              <div className="max-w-3xl overflow-x-auto">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Feature</th>
                      <th className="num">Events</th>
                      <th className="num">Tokens</th>
                      <th className="num">Billable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byFeature.map((row) => (
                      <tr key={row.feature}>
                        <td className="font-medium text-ink-900">{FEATURE_LABELS[row.feature] ?? row.feature}</td>
                        <td className="num">{count(row.eventCount)}</td>
                        <td className="num">{tokens(row.totalTokens)}</td>
                        <td className="num">{nanosToMoney(row.priceNanos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
