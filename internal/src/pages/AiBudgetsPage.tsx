import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { count, nanosToMoney, percent } from '../lib/format';
import { ErrorLine, Loading, PageHeader, Section } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';
import { nanosToUsd } from '../lib/excel';

type BudgetRow = {
  orgId: string;
  orgName: string | null;
  state: string;
  paused: boolean;
  usedNanos: number;
  allowanceNanos: number;
  usedFraction: number;
  creditBalanceNanos: number;
  resetAt: string | null;
};

export function AiBudgetsPage() {
  const [rows, setRows] = useState<BudgetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState('');
  const [dollars, setDollars] = useState('25');
  const [note, setNote] = useState('');
  const [grantMessage, setGrantMessage] = useState<string | null>(null);

  function load() {
    setError(null);
    api
      .aiBudgets()
      .then((payload) => setRows(payload.budgets))
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
        subtitle="Provider spend against each account's included allowance. Staff can grant credits that roll over until used."
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
                  { header: 'State' },
                  { header: 'Paused' },
                  { header: 'Used, USD', type: 'usd', format: '"$"#,##0.0000' },
                  { header: 'Allowance, USD', type: 'usd' },
                  { header: 'Used of allowance', type: 'percent' },
                  { header: 'Credits, USD', type: 'usd' },
                  { header: 'Resets', type: 'date' },
                ],
                rows: list.map((row) => [
                  row.orgName || 'Untitled',
                  row.orgId,
                  row.state,
                  row.paused,
                  nanosToUsd(row.usedNanos),
                  nanosToUsd(row.allowanceNanos),
                  row.usedFraction * 100,
                  nanosToUsd(row.creditBalanceNanos),
                  row.resetAt,
                ]),
              },
            ]}
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="report-table min-w-[720px]">
            <thead>
              <tr>
                <th>Organization</th>
                <th>State</th>
                <th className="num">Used</th>
                <th className="num">Allowance</th>
                <th className="num">Used %</th>
                <th className="num">Credits</th>
                <th className="num">Resets</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-ink-500">
                    No organizations have an AI allowance yet.
                  </td>
                </tr>
              ) : (
                list.map((row) => (
                  <tr key={row.orgId}>
                    <td>
                      <div className="font-medium text-ink-900">{row.orgName || 'Untitled'}</div>
                      <div className="text-[11px] text-ink-400">{row.orgId}</div>
                    </td>
                    <td>{row.paused ? 'Paused' : row.state}</td>
                    <td className="num">{nanosToMoney(row.usedNanos)}</td>
                    <td className="num">{nanosToMoney(row.allowanceNanos)}</td>
                    <td className="num">{percent(row.usedFraction * 100, 0)}</td>
                    <td className="num">{nanosToMoney(row.creditBalanceNanos)}</td>
                    <td className="num whitespace-nowrap">{row.resetAt ? row.resetAt.slice(0, 10) : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
