import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { nanosToMoney } from '../lib/format';

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

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">AI budgets</h1>
      <p className="mt-1 text-sm text-ink-500">
        Provider spend against each account&apos;s included allowance. Staff can grant credits that roll over until used.
      </p>
      {error && <p className="mt-4 text-sm text-danger-600">{error}</p>}
      <form onSubmit={(event) => void grant(event)} className="mt-6 flex flex-wrap items-end gap-3">
        <label className="text-sm text-ink-600">
          Organization
          <input
            value={orgId}
            onChange={(event) => setOrgId(event.target.value)}
            placeholder="Org id"
            className="mt-1 block w-72 rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm text-ink-600">
          Dollars
          <input
            value={dollars}
            onChange={(event) => setDollars(event.target.value)}
            className="mt-1 block w-24 rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm text-ink-600">
          Note
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-1 block w-56 rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm"
          />
        </label>
        <button type="submit" className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-paper-0">
          Grant credits
        </button>
      </form>
      {grantMessage && <p className="mt-3 text-sm text-success-700">{grantMessage}</p>}
      <div className="mt-6 overflow-hidden rounded-xl border border-line bg-paper-0">
        <table className="w-full text-sm">
          <thead className="bg-paper-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3 text-right">Used</th>
              <th className="px-4 py-3 text-right">Allowance</th>
              <th className="px-4 py-3 text-right">Credits</th>
              <th className="px-4 py-3">Resets</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row) => (
              <tr key={row.orgId} className="border-t border-line">
                <td className="px-4 py-3">
                  <div className="font-medium">{row.orgName || 'Untitled'}</div>
                  <div className="font-mono text-[11px] text-ink-400">{row.orgId}</div>
                </td>
                <td className="px-4 py-3">{row.paused ? 'Paused' : row.state}</td>
                <td className="px-4 py-3 text-right font-mono">{nanosToMoney(row.usedNanos)}</td>
                <td className="px-4 py-3 text-right font-mono">{nanosToMoney(row.allowanceNanos)}</td>
                <td className="px-4 py-3 text-right font-mono">{nanosToMoney(row.creditBalanceNanos)}</td>
                <td className="px-4 py-3">{row.resetAt ? row.resetAt.slice(0, 10) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
