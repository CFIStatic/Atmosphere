import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, humanize, type CrmAccount, type CrmContact } from '../lib/api';
import { AppShell, EmptyState, ErrorNote, PageHeader, PanelSpinner } from '../components/AppShell';
import { NewCustomerDialog } from '../components/sales/NewCustomerDialog';
import { AccountStructure, DuplicateAccounts } from '../components/crm/AccountStructure';
import { PlusIcon } from '../components/icons';

type Tab = 'accounts' | 'contacts';

/**
 * Customers: the CRM's accounts and contacts, read from the same tables the
 * sales agent works. Search is server-side — the same sanitized ILIKE the
 * API applies for every caller.
 */
export function CustomersPage() {
  const [tab, setTab] = useState<Tab>('accounts');
  const [search, setSearch] = useState('');
  const [accounts, setAccounts] = useState<CrmAccount[] | null>(null);
  const [contacts, setContacts] = useState<CrmContact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // A row click opens the structure rather than navigating: comparing two
  // accounts is the reason somebody is on this page, and a page transition per
  // account makes that a chore.
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setError(null);
      if (tab === 'accounts') {
        setAccounts(null);
        api
          .crmAccounts(search)
          .then(({ items }) => !cancelled && setAccounts(items))
          .catch((err) => {
            if (cancelled) return;
            setAccounts([]);
            setError(err instanceof Error ? err.message : 'Could not load accounts.');
          });
      } else {
        setContacts(null);
        api
          .crmContacts(search)
          .then(({ items }) => !cancelled && setContacts(items))
          .catch((err) => {
            if (cancelled) return;
            setContacts([]);
            setError(err instanceof Error ? err.message : 'Could not load contacts.');
          });
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, search, reloadKey]);

  const list = tab === 'accounts' ? accounts : contacts;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Delivery"
        title="Customers"
        description="Accounts and the people on them — the same records the sales agent reads and writes."
        action={
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400"
          >
            <PlusIcon width={15} height={15} />
            {tab === 'accounts' ? 'New account' : 'New contact'}
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg glass-card p-1">
          {(['accounts', 'contacts'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium capitalize transition ${
                tab === t ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${tab}…`}
          className="w-full max-w-xs rounded-lg glass-card px-3 py-2 text-sm text-ink-900 placeholder-ink-500 outline-none transition focus:border-brand-500"
        />
      </div>

      {tab === 'accounts' && (
        <div className="mb-4">
          <DuplicateAccounts onMerged={reload} />
        </div>
      )}

      {error && <div className="mb-4"><ErrorNote message={error} /></div>}
      {list === null && <PanelSpinner label="Loading customers" />}

      {tab === 'accounts' && accounts !== null && (
        accounts.length === 0 && !error ? (
          <EmptyState
            title={search ? 'No accounts match' : 'No accounts yet'}
            hint={search ? 'Try a shorter search.' : 'Accounts land here as leads convert and jobs open.'}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl glass-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <Th>Name</Th>
                  <Th>Kind</Th>
                  <Th>Phone</Th>
                  <Th>Email</Th>
                  <Th>City</Th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <Fragment key={a.id}>
                    <tr
                      onClick={() => setOpenId(openId === a.id ? null : a.id)}
                      className={`cursor-pointer border-b border-line last:border-b-0 transition ${
                        openId === a.id ? 'bg-brand-600/10' : 'hover:bg-paper-200'
                      }`}
                    >
                      <Td strong>{a.name}</Td>
                      <Td>{humanize(a.kind)}</Td>
                      <Td>{a.phone ?? '—'}</Td>
                      <Td>{a.email ?? '—'}</Td>
                      <Td>{[a.city, a.region].filter(Boolean).join(', ') || '—'}</Td>
                    </tr>
                    {openId === a.id && (
                      <tr>
                        <td colSpan={5} className="border-b border-line bg-paper-50/40 p-4">
                          <AccountStructure accountId={a.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'contacts' && contacts !== null && (
        contacts.length === 0 && !error ? (
          <EmptyState
            title={search ? 'No contacts match' : 'No contacts yet'}
            hint={search ? 'Try a shorter search.' : 'People attach here as accounts and jobs come in.'}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl glass-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <Th>Name</Th>
                  <Th>Company</Th>
                  <Th>Phone</Th>
                  <Th>Email</Th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-b-0 hover:bg-paper-200">
                    <Td strong>{[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}</Td>
                    <Td>{c.companyName ?? '—'}</Td>
                    <Td>{c.mobile ?? c.phone ?? '—'}</Td>
                    <Td>{c.email ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {creating && (
        <NewCustomerDialog
          mode={tab}
          accounts={accounts ?? []}
          onClose={() => setCreating(false)}
          onCreated={reload}
        />
      )}
    </AppShell>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
      {children}
    </th>
  );
}

function Td({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <td className={`px-4 py-3 ${strong ? 'font-semibold text-ink-900' : 'text-ink-700'}`}>
      {children}
    </td>
  );
}
