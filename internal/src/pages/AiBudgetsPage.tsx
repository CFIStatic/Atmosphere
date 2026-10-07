import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { count, money, nanosToMoney, percent } from '../lib/format';
import { ErrorLine, Footnotes, Loading, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';
import { centsToUsd, nanosToUsd } from '../lib/excel';
import type { AiBudgetRow, AiBudgetsPayload } from '../lib/types';
import { BILLING_LABEL, allowanceLabel, resetLabel } from '../lib/aiBudgets';

type BudgetRow = AiBudgetRow;

export function AiBudgetsPage() {
  const [rows, setRows] = useState<BudgetRow[] | null>(null);
  const [meta, setMeta] = useState<Omit<AiBudgetsPayload, 'budgets'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState('');
  const [dollars, setDollars] = useState('25');
  const [note, setNote] = useState('');
  const [grantMessage, setGrantMessage] = useState<string | null>(null);

  function load() {
    setError(null);
    api
      .aiBudgets()
      .then((payload) => {
        const { budgets, ...rest } = payload;
        setRows(budgets);
        setMeta(rest);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load AI budgets'));
  }

  useEffect(() => {
    load();
  }, []);

  async function grant(event: FormEvent) {
    event.preventDefault();
    setGrantMessage(null);
    const amount = Number(dollars);
    if (!orgId.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError('Enter an organization and a credit amount.');
      return;
    }
    try {
      const result = await api.grantAiCredits(orgId.trim(), amount, note.trim() || undefined);
      setGrantMessage(`Granted ${nanosToMoney(amount * 1_000_000_000)}. Balance ${nanosToMoney(result.balanceNanos)}.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not grant credits');
    }
  }

  if (!rows && !error) return <Loading label="Loading AI budgets" />;
  const list = rows ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="AI cost & usage"
        title="AI budgets"
        subtitle={`AI provider cost this month against each org's allowance: ${Math.round((meta?.allowanceFraction ?? 0.1) * 100)}% of what the org actually pays. Display only; staff can grant credits that roll over until used.`}
      />
      {error && <ErrorLine message={error} />}

      <Section title="Grant credits" note="Credits roll over until used">
        <form onSubmit={(event) => void grant(event)} className="flex flex-wrap items-end gap-3">
          <label className="text-[12px] font-medium text-ink-700">
            Organization
            <input value={orgId} onChange={(event) => setOrgId(event.target.value)} placeholder="Org id" className="field mt-1 block w-72" />
          </label>
          <label className="text-[12px] font-medium text-ink-700">
            Dollars
            <input value={dollars} onChange={(event) => setDollars(event.target.value)} inputMode="decimal" className="field mt-1 block w-24" />
          </label>
          <label className="text-[12px] font-medium text-ink-700">
            Note
            <input value={note} onChange={(event) => setNote(event.target.value)} className="field mt-1 block w-56" />
          </label>
          <button type="submit" className="btn-primary">
            Grant credits
          </button>
        </form>
        {grantMessage && <p className="mt-3 text-[13px] text-success-600">{grantMessage}</p>}
      </Section>

      <Section
        title="Allowance by organization"
        note={`${count(list.length)} organizations`}
        actions={
          <DownloadButton
            table="ai-budgets"
            label="AI budgets"
            disabled={list.length === 0}
            sheets={() => [
              {
                name: 'AI budgets',
                columns: [
                  { header: 'Organization' },
                  { header: 'Org id' },
                  { header: 'Billing' },
                  { header: 'Pays per month, USD', type: 'usd' },
                  { header: 'Price source' },
                  { header: 'AI cost this month (UTC), USD', type: 'usd', format: '"$"#,##0.0000' },
                  { header: 'Allowance' },
                  { header: 'Allowance, USD', type: 'usd' },
                  { header: 'AI cost of allowance', type: 'percent' },
                  { header: 'Credits, USD', type: 'usd' },
                  { header: 'Resets' },
                  { header: 'Enforcement state' },
                  { header: 'Paused' },
                  { header: 'Internal / test / comp' },
                ],
                rows: list.map((row) => [
                  row.orgName || 'Untitled',
                  row.orgId,
                  row.staff ? BILLING_LABEL[row.staff.billingClass] : '',
                  centsToUsd(row.staff?.paidMonthlyCents ?? null),
                  row.staff?.paidSource ?? '',
                  nanosToUsd(row.staff?.aiCostNanos ?? row.usedNanos),
                  allowanceLabel(row),
                  row.staff?.allowanceMonthlyNanos == null ? null : nanosToUsd(row.staff.allowanceMonthlyNanos),
                  row.staff?.usedOfAllowancePct ?? null,
                  nanosToUsd(row.creditBalanceNanos),
                  resetLabel(row.staff, row.resetAt),
                  row.state,
                  row.paused,
                  row.internal ? 'yes' : '',
                ]),
              },
            ]}
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table min-w-[860px]">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Billing</th>
                <th className="num">Pays / month</th>
                <th className="num">AI cost, month</th>
                <th className="num">Allowance</th>
                <th className="num">Of allowance</th>
                <th className="num">Credits</th>
                <th className="num">Resets</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-ink-500">
                    No customer organizations yet. Internal, test and comp orgs are hidden unless the toggle is on.
                  </td>
                </tr>
              ) : (
                list.map((row) => (
                  <tr key={row.orgId}>
                    <td>
                      <div className="font-medium text-ink-900">
                        {row.orgName || 'Untitled'}
                        {row.internal && (
                          <span className="ml-2 text-[10.5px] font-semibold uppercase tracking-wide text-caution-600">internal</span>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-400">{row.orgId}</div>
                    </td>
                    <td>
                      {row.staff ? BILLING_LABEL[row.staff.billingClass] : '—'}
                      {row.paused && <span className="ml-1 text-[11px] text-danger-600">· paused</span>}
                    </td>
                    <td className="num">
                      {row.staff ? money(row.staff.paidMonthlyCents) : '—'}
                      {row.staff?.paidSource === 'catalog' && (
                        <span className="ml-1 text-[10.5px] text-ink-400" title="No Stripe amount stored yet; catalog price">
                          catalog
                        </span>
                      )}
                    </td>
                    <td className="num">{nanosToMoney(row.staff?.aiCostNanos ?? row.usedNanos)}</td>
                    <td className="num">{allowanceLabel(row)}</td>
                    <td className="num">
                      {row.staff ? (row.staff.usedOfAllowancePct == null ? '—' : percent(row.staff.usedOfAllowancePct, 0)) : percent(row.usedFraction * 100, 0)}
                    </td>
                    <td className="num">{nanosToMoney(row.creditBalanceNanos)}</td>
                    <td className="num whitespace-nowrap">{resetLabel(row.staff, row.resetAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Footnotes
        notes={[
          `Allowance: ${Math.round((meta?.allowanceFraction ?? 0.1) * 100)}% of what the org actually pays per month: the Stripe amount stored by the webhook (net of discounts, annual ÷ 12, tax excluded), else the catalog price. Only live active or past-due subscriptions pay; trialing, canceled, test-mode and no-subscription orgs show $0. Comp orgs show "comp".`,
          `AI cost: provider cost from token_usage_events for the current calendar month, UTC${meta?.costWindow ? ` (${meta.costWindow.from.slice(0, 10)} to ${meta.costWindow.to.slice(0, 10)})` : ''}. Display only: this page writes nothing, and enforcement (paused / warning) is unchanged.`,
          'Resets: billing periods ending more than 400 days out (comp terms ending in 2126) show "No reset"; periods that already ended show "awaiting renewal" instead of a date in the past.',
        ]}
      />
    </div>
  );
}
