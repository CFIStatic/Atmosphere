import type { AccountRow } from './types';

export function filterAccounts(accounts: AccountRow[], query: string): AccountRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return accounts;
  return accounts.filter((row) => {
    const haystack = [
      row.orgName,
      row.planName,
      row.planCode,
      row.status,
      row.billingInterval,
      row.topFeature ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

export type AccountSort = 'mrr' | 'usage' | 'recent' | 'name';

export function sortAccounts(accounts: AccountRow[], sort: AccountSort): AccountRow[] {
  const rows = [...accounts];
  if (sort === 'mrr') rows.sort((a, b) => b.mrrCents - a.mrrCents);
  if (sort === 'usage') rows.sort((a, b) => b.activeHours - a.activeHours);
  if (sort === 'recent') {
    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  if (sort === 'name') rows.sort((a, b) => a.orgName.localeCompare(b.orgName));
  return rows;
}
