import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { AlertIcon, BoltIcon, CheckIcon, PlusIcon, SpinnerIcon } from '../components/icons';
import {
  api,
  ApiError,
  LEDGER_LABELS,
  type BillingInterval,
  type BillingOverview,
  type Catalog,
  type LedgerEntry,
  type Plan,
} from '../lib/api';
import { formatCents, formatDate, formatRate, formatUsd, usedPct } from '../lib/money';

export function BillingPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const [customAmount, setCustomAmount] = useState('');

  const load = useCallback(async () => {
    try {
      const [c, o, l] = await Promise.all([api.getCatalog(), api.getBillingOverview(), api.getLedger(12)]);
      setCatalog(c);
      setOverview(o);
      setLedger(l.entries);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load billing.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Wraps a mutation with busy state, error surfacing and a reload. */
  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const message = await fn();
      await load();
      if (message) setNotice(message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  const canManage = overview?.canManage ?? false;

  async function buyPack(code: string, label: string) {
    await run(`pack:${code}`, async () => {
      const { purchase, requiresConfirmation } = await api.startPurchase({ packCode: code });
      if (requiresConfirmation) {
        const done = await api.confirmPurchase(purchase.id);
        return `Added ${formatUsd(done.creditedNanos)} in credits.`;
      }
      return `${label} purchase started — credits arrive once payment settles.`;
    });
  }

  async function buyCustom() {
    const dollars = Number(customAmount);
    if (!Number.isFinite(dollars) || dollars < 5) {
      setError('Enter an amount of $5 or more.');
      return;
    }
    await run('custom', async () => {
      const { purchase, requiresConfirmation } = await api.startPurchase({
        amountCents: Math.round(dollars * 100),
      });
      setCustomAmount('');
      if (requiresConfirmation) {
        const done = await api.confirmPurchase(purchase.id);
        return `Added ${formatUsd(done.creditedNanos)} in credits.`;
      }
      return 'Top-up started — credits arrive once payment settles.';
    });
  }

  if (loading) {
    return (
      <AppShell>
        <div className="grid place-items-center py-24 text-brand-300">
          <SpinnerIcon className="animate-spin" width={28} height={28} />
        </div>
      </AppShell>
    );
  }

  const sub = overview?.subscription;
  const balance = overview?.balance;
  const usage = overview?.periodUsage;

  return (
    <AppShell>
      <div className="animate-fade-in-up">
        <h1 className="text-3xl font-bold tracking-tight text-white">Plans &amp; billing</h1>
        <p className="mt-2 max-w-2xl text-gray-400">
          Your plan includes usage credits each month. Buy extra credits any time — they never
          expire, and they&apos;re only used once your monthly allowance runs out.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            <AlertIcon width={18} height={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="mt-6 flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
          >
            <CheckIcon width={18} height={18} className="mt-0.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {!canManage && (
          <p className="mt-6 rounded-xl border border-white/10 bg-ink-800/60 px-4 py-3 text-sm text-gray-400">
            You can view billing, but only an accountant, office manager or project manager can
            change the plan or buy credits.
          </p>
        )}

        {/* ---- Balance + current plan ---- */}
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-ink-800/60 p-5 backdrop-blur lg:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Credit balance</p>
            <p className="mt-1 text-4xl font-bold tracking-tight text-white">
              {formatUsd(balance?.totalNanos ?? 0)}
            </p>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-ink-700/50 px-3 py-2">
                <dt className="text-xs text-gray-500">Plan credits</dt>
                <dd className="mt-0.5 font-semibold text-gray-200">
                  {formatUsd(balance?.planNanos ?? 0)}
                </dd>
                <dd className="text-xs text-gray-500">
                  {balance?.nextExpiry ? `Expires ${formatDate(balance.nextExpiry)}` : 'No expiry'}
                </dd>
              </div>
              <div className="rounded-lg bg-ink-700/50 px-3 py-2">
                <dt className="text-xs text-gray-500">Purchased credits</dt>
                <dd className="mt-0.5 font-semibold text-gray-200">
                  {formatUsd(balance?.purchasedNanos ?? 0)}
                </dd>
                <dd className="text-xs text-gray-500">Never expire</dd>
              </div>
            </dl>

            {sub && usage && sub.includedCreditsNanos > 0 && (
              <div className="mt-5">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-gray-400">This period</span>
                  <span className="font-medium text-gray-200">
                    {formatUsd(usage.priceNanos)} of {formatUsd(sub.includedCreditsNanos)} allowance
                  </span>
                </div>
                <div
                  className="mt-2 h-2 overflow-hidden rounded-full bg-ink-700"
                  role="progressbar"
                  aria-valuenow={Math.round(usedPct(usage.priceNanos, sub.includedCreditsNanos))}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Monthly allowance used"
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300 transition-all"
                    style={{ width: `${usedPct(usage.priceNanos, sub.includedCreditsNanos)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Resets {formatDate(sub.periodEnd)} · {usage.events.toLocaleString('en-US')} requests
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-ink-800/60 p-5 backdrop-blur">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Current plan</p>
            <p className="mt-1 text-2xl font-bold text-white">{sub?.planName}</p>
            <p className="mt-1 text-sm text-gray-400">
              {sub?.monthlyPriceCents ? `${formatCents(sub.monthlyPriceCents)}/month` : 'No charge'}
              {sub?.seats && sub.seats > 1 ? ` · ${sub.seats} seats` : ''}
            </p>
            {sub?.cancelAtPeriodEnd && (
              <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Moves to Free on {formatDate(sub.periodEnd)}.
              </p>
            )}
            <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">
              <BoltIcon width={14} height={14} />
              {sub?.rateMultiplier}× base throughput
            </p>
          </div>
        </div>

        {/* ---- Buy credits ---- */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-white">Buy usage credits</h2>
          <p className="mt-1 text-sm text-gray-400">
            1 credit = $1 of usage. Purchased credits never expire and are used after your monthly
            allowance.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {catalog?.packs.map((pack) => (
              <button
                key={pack.code}
                onClick={() => buyPack(pack.code, pack.name)}
                disabled={!canManage || busy !== null}
                className="group rounded-xl border border-white/10 bg-ink-800/60 p-4 text-left transition hover:border-brand-500/50 hover:bg-ink-700/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <p className="text-lg font-semibold text-white">{formatCents(pack.priceCents)}</p>
                <p className="mt-0.5 text-sm text-gray-400">
                  {formatUsd(pack.creditsNanos)} in credits
                </p>
                {pack.bonusNanos > 0 && (
                  <p className="mt-1.5 inline-block rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                    +{formatUsd(pack.bonusNanos)} bonus
                  </p>
                )}
                {busy === `pack:${pack.code}` && (
                  <SpinnerIcon className="mt-2 animate-spin text-brand-300" width={16} height={16} />
                )}
              </button>
            ))}

            <div className="rounded-xl border border-dashed border-white/15 bg-ink-800/40 p-4">
              <label htmlFor="custom-amount" className="text-sm font-medium text-gray-300">
                Custom amount
              </label>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-gray-500">$</span>
                <input
                  id="custom-amount"
                  type="number"
                  min={5}
                  step={5}
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  disabled={!canManage || busy !== null}
                  placeholder="50"
                  className="w-full rounded-lg border border-white/10 bg-ink-900/60 px-2.5 py-1.5 text-sm text-white outline-none transition focus:border-brand-500 disabled:opacity-50"
                />
              </div>
              <button
                onClick={buyCustom}
                disabled={!canManage || busy !== null || !customAmount}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
              >
                {busy === 'custom' ? (
                  <SpinnerIcon className="animate-spin" width={15} height={15} />
                ) : (
                  <PlusIcon width={15} height={15} />
                )}
                Add credits
              </button>
            </div>
          </div>

          {catalog?.paymentProvider === 'manual' && (
            <p className="mt-3 text-xs text-gray-500">
              Purchases stay pending until your payment provider confirms them.
            </p>
          )}
        </section>

        {/* ---- Plans ---- */}
        <section className="mt-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Plans</h2>
            <div className="flex rounded-lg border border-white/10 bg-ink-800/60 p-1 text-sm">
              {(['monthly', 'annual'] as BillingInterval[]).map((i) => (
                <button
                  key={i}
                  onClick={() => setInterval(i)}
                  className={`rounded-md px-3 py-1.5 font-medium capitalize transition ${
                    interval === i ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {catalog?.plans.map((plan) => (
              <PlanCard
                key={plan.code}
                plan={plan}
                interval={interval}
                isCurrent={sub?.planCode === plan.code}
                disabled={!canManage || busy !== null}
                busy={busy === `plan:${plan.code}`}
                onSelect={() =>
                  run(`plan:${plan.code}`, async () => {
                    const result = await api.setPlan(plan.code, interval, plan.minSeats);
                    if (!result.changed) return 'You are already on that plan.';
                    if (result.cancelAtPeriodEnd) {
                      return `Your plan moves to Free on ${formatDate(result.effectiveAt)}.`;
                    }
                    return `Switched to ${plan.name}. ${formatUsd(result.grantedNanos)} in credits added.`;
                  })
                }
              />
            ))}
          </div>
        </section>

        {/* ---- Controls ---- */}
        <SpendControls
          overview={overview}
          canManage={canManage}
          busy={busy}
          onSave={(patch, label) => run(label, async () => {
            await api.updateBillingSettings(patch);
            return 'Saved.';
          })}
        />

        {/* ---- Rate card ---- */}
        <section className="mt-12">
          <h2 className="text-lg font-semibold text-white">Usage rates</h2>
          <p className="mt-1 text-sm text-gray-400">
            Price per million tokens. Cached reads are far cheaper than fresh input, and batch
            requests are discounted {catalog?.rateCard[0]?.batchDiscountPct ?? 50}%.
          </p>

          <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-ink-700/60 text-left text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Model</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Input</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Output</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Cache write 5m</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Cache write 1h</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Cache read</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {catalog?.rateCard.map((rate) => (
                  <tr key={rate.modelId} className="bg-ink-800/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{rate.displayName}</p>
                      <p className="text-xs text-gray-500">
                        {rate.contextWindow
                          ? `${(rate.contextWindow / 1000).toLocaleString('en-US')}k context`
                          : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">{formatRate(rate.inputPerMTok)}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{formatRate(rate.outputPerMTok)}</td>
                    <td className="px-4 py-3 text-right text-gray-400">{formatRate(rate.cacheWrite5mPerMTok)}</td>
                    <td className="px-4 py-3 text-right text-gray-400">{formatRate(rate.cacheWrite1hPerMTok)}</td>
                    <td className="px-4 py-3 text-right text-emerald-300">{formatRate(rate.cacheReadPerMTok)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ---- Ledger ---- */}
        <section className="mt-12">
          <h2 className="text-lg font-semibold text-white">Credit history</h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
            {ledger.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-500">No credit activity yet.</p>
            ) : (
              <ul className="divide-y divide-white/10">
                {ledger.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-4 bg-ink-800/40 px-5 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">
                        {LEDGER_LABELS[entry.entryType]}
                      </p>
                      <p className="text-xs text-gray-500">
                        {entry.description} · {formatDate(entry.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`font-mono text-sm font-medium ${
                        entry.amountNanos >= 0 ? 'text-emerald-300' : 'text-gray-400'
                      }`}
                    >
                      {entry.amountNanos >= 0 ? '+' : '−'}
                      {formatUsd(Math.abs(entry.amountNanos), { precise: true })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function PlanCard({
  plan,
  interval,
  isCurrent,
  disabled,
  busy,
  onSelect,
}: {
  plan: Plan;
  interval: BillingInterval;
  isCurrent: boolean;
  disabled: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  const priceCents =
    interval === 'annual' && plan.annualPriceCents !== null
      ? plan.annualPriceCents
      : plan.monthlyPriceCents;

  return (
    <div
      className={`flex flex-col rounded-xl border p-5 transition ${
        isCurrent
          ? 'border-brand-500/60 bg-brand-600/10'
          : 'border-white/10 bg-ink-800/60 hover:border-white/20'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-semibold text-white">{plan.name}</p>
          <p className="mt-0.5 text-sm text-gray-400">{plan.tagline}</p>
        </div>
        {isCurrent && (
          <span className="rounded-full bg-brand-500/20 px-2.5 py-1 text-xs font-medium text-brand-200">
            Current
          </span>
        )}
      </div>

      <p className="mt-4 text-3xl font-bold tracking-tight text-white">
        {plan.isContactSales ? 'Custom' : formatCents(priceCents)}
        {!plan.isContactSales && priceCents > 0 && (
          <span className="text-sm font-normal text-gray-500">
            /mo{plan.perSeat ? ' per seat' : ''}
          </span>
        )}
      </p>
      {interval === 'annual' && plan.annualPriceCents !== null && plan.annualPriceCents < plan.monthlyPriceCents && (
        <p className="mt-1 text-xs text-emerald-300">
          Save {formatCents((plan.monthlyPriceCents - plan.annualPriceCents) * 12)} a year
        </p>
      )}

      <ul className="mt-4 flex-1 space-y-2 text-sm text-gray-300">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <CheckIcon width={16} height={16} className="mt-0.5 shrink-0 text-brand-400" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={onSelect}
        disabled={disabled || isCurrent || plan.isContactSales}
        className={`mt-5 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
          isCurrent
            ? 'border border-white/10 bg-ink-700/60 text-gray-400'
            : 'bg-brand-600 text-white hover:bg-brand-500'
        }`}
      >
        {busy && <SpinnerIcon className="animate-spin" width={15} height={15} />}
        {isCurrent ? 'Your plan' : plan.isContactSales ? 'Contact sales' : `Choose ${plan.name}`}
      </button>
    </div>
  );
}

/** Auto-reload and the monthly spend cap. */
function SpendControls({
  overview,
  canManage,
  busy,
  onSave,
}: {
  overview: BillingOverview | null;
  canManage: boolean;
  busy: string | null;
  onSave: (patch: Parameters<typeof api.updateBillingSettings>[0], label: string) => void;
}) {
  const settings = overview?.settings;
  const [limit, setLimit] = useState('');
  const [reloadAmount, setReloadAmount] = useState('');

  useEffect(() => {
    if (!settings) return;
    setLimit(
      settings.monthlySpendLimitNanos === null
        ? ''
        : String(settings.monthlySpendLimitNanos / 1_000_000_000),
    );
    setReloadAmount(String(settings.autoReloadAmountNanos / 1_000_000_000));
  }, [settings]);

  if (!settings) return null;

  return (
    <section className="mt-12 grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-white/10 bg-ink-800/60 p-5">
        <h3 className="font-semibold text-white">Auto-reload</h3>
        <p className="mt-1 text-sm text-gray-400">
          Top up automatically when the balance drops below{' '}
          {formatUsd(settings.autoReloadThresholdNanos)}.
        </p>

        <label className="mt-4 flex items-center gap-3 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={settings.autoReloadEnabled}
            disabled={!canManage || busy !== null}
            onChange={(e) => onSave({ autoReloadEnabled: e.target.checked }, 'autoreload')}
            className="h-4 w-4 rounded border-white/20 bg-ink-900 text-brand-500 focus:ring-brand-500"
          />
          Enable auto-reload
        </label>

        <div className="mt-4 flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="reload-amount" className="text-xs text-gray-500">
              Reload amount ($)
            </label>
            <input
              id="reload-amount"
              type="number"
              min={5}
              value={reloadAmount}
              onChange={(e) => setReloadAmount(e.target.value)}
              disabled={!canManage || busy !== null}
              className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/60 px-3 py-1.5 text-sm text-white outline-none focus:border-brand-500 disabled:opacity-50"
            />
          </div>
          <button
            onClick={() =>
              onSave(
                { autoReloadAmountNanos: Math.round(Number(reloadAmount) * 1_000_000_000) },
                'reload-amount',
              )
            }
            disabled={!canManage || busy !== null || !reloadAmount}
            className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-1.5 text-sm text-gray-200 transition hover:bg-ink-600 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-ink-800/60 p-5">
        <h3 className="font-semibold text-white">Monthly spend limit</h3>
        <p className="mt-1 text-sm text-gray-400">
          Requests are refused once usage in a billing period reaches this cap. Leave blank for no
          limit.
        </p>

        <div className="mt-4 flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="spend-limit" className="text-xs text-gray-500">
              Limit ($)
            </label>
            <input
              id="spend-limit"
              type="number"
              min={0}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              disabled={!canManage || busy !== null}
              placeholder="No limit"
              className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900/60 px-3 py-1.5 text-sm text-white outline-none focus:border-brand-500 disabled:opacity-50"
            />
          </div>
          <button
            onClick={() =>
              onSave(
                {
                  monthlySpendLimitNanos:
                    limit.trim() === '' ? null : Math.round(Number(limit) * 1_000_000_000),
                },
                'limit',
              )
            }
            disabled={!canManage || busy !== null}
            className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-1.5 text-sm text-gray-200 transition hover:bg-ink-600 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </section>
  );
}
