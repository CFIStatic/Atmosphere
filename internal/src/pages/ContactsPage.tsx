import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { count, shortDate } from '../lib/format';
import { downloadCsv, toCsv } from '../lib/csv';
import { STATUSES, STATUS_LABEL, planLabel, planOptions, searchContacts } from '../lib/contacts';
import type { Contact, ContactSourceId, ContactStatus } from '../lib/types';
import { ErrorLine, Footnotes, KpiStrip, Loading, PageHeader, Section, Tag } from '../components/report';
import { DownloadButton } from '../components/DownloadButton';
import type { ExportSheet } from '../lib/excel';

function statusTone(status: ContactStatus): 'good' | 'bad' | 'accent' | 'neutral' {
  if (status === 'active') return 'good';
  if (status === 'past_due') return 'bad';
  if (status === 'trialing') return 'accent';
  return 'neutral';
}

export function ContactsPage() {
  // "Refresh from Stripe" bypasses the five-minute server cache once.
  const bypassCache = useRef(false);
  const { data, error, loading, reload } = useApi(() => {
    const refresh = bypassCache.current;
    bypassCache.current = false;
    return api.contacts(refresh);
  }, []);
  const [query, setQuery] = useState('');
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState<ContactStatus | ''>('');
  const [source, setSource] = useState<ContactSourceId | ''>('');
  const [hideSuppressed, setHideSuppressed] = useState(false);

  const contacts = useMemo(() => data?.contacts ?? [], [data]);
  const filtered = useMemo(() => {
    return searchContacts(contacts, query).filter(
      (c) =>
        (!plan || (c.plan ?? 'none').toLowerCase() === plan) &&
        (!status || c.status === status) &&
        (!source || c.sources.includes(source)) &&
        (!hideSuppressed || !c.suppressed),
    );
  }, [contacts, query, plan, status, source, hideSuppressed]);

  const byStatus = (s: ContactStatus) => contacts.filter((c) => c.status === s).length;

  function exportCsv() {
    const csv = toCsv(
      ['Name', 'Email', 'Company', 'Plan', 'Subscription status', 'Created', 'Source', 'Unsubscribed'],
      filtered.map((c: Contact) => [
        c.name ?? '',
        c.email,
        c.company ?? '',
        planLabel(c.plan),
        STATUS_LABEL[c.status],
        c.createdAt ? c.createdAt.slice(0, 10) : '',
        c.sources.map((s) => (s === 'stripe' ? 'Stripe' : 'CRM')).join('; '),
        c.suppressed ? 'yes' : 'no',
      ]),
    );
    downloadCsv(`atmosphere-contacts-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  function contactsSheet(): ExportSheet {
    return {
      name: 'Contacts',
      columns: [
        { header: 'Name' },
        { header: 'Email' },
        { header: 'Company' },
        { header: 'Org id' },
        { header: 'Plan' },
        { header: 'Subscription status' },
        { header: 'Created', type: 'date' },
        { header: 'Source' },
        { header: 'Unsubscribed' },
      ],
      rows: filtered.map((c) => [
        c.name,
        c.email,
        c.company,
        c.orgId,
        planLabel(c.plan),
        STATUS_LABEL[c.status],
        c.createdAt,
        c.sources.map((s) => (s === 'stripe' ? 'Stripe' : 'CRM')).join('; '),
        c.suppressed,
      ]),
    };
  }

  if (loading && !data) return <Loading label="Loading contacts from Stripe" />;

  return (
    <div>
      <PageHeader
        eyebrow="Contacts & campaigns"
        title="Contacts"
        subtitle="Customer contacts read from Stripe on the server, merged by email address. Staff only; nothing here is visible to customers."
        asOfValue={data?.fetchedAt ?? null}
        actions={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                bypassCache.current = true;
                void reload();
              }}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh from Stripe'}
            </button>
            <Link to="/campaigns/new" className="btn-primary">
              New campaign
            </Link>
          </>
        }
      />
      {error && <ErrorLine message={error} onRetry={() => void reload()} />}

      {data && (
        <>
          <KpiStrip
            download={{ table: 'contacts-summary', label: 'contact counts' }}
            items={[
              { label: 'Contacts', unit: 'unique emails, all sources', value: count(contacts.length), raw: contacts.length, rawType: 'integer' },
              { label: 'Active subscription', unit: 'count', value: count(byStatus('active')), raw: byStatus('active'), rawType: 'integer' },
              { label: 'Trialing', unit: 'count', value: count(byStatus('trialing')), raw: byStatus('trialing'), rawType: 'integer' },
              { label: 'Past due', unit: 'count', value: count(byStatus('past_due')), raw: byStatus('past_due'), rawType: 'integer' },
              {
                label: 'Canceled or none',
                unit: 'count',
                value: count(byStatus('canceled') + byStatus('none')),
                raw: byStatus('canceled') + byStatus('none'),
                rawType: 'integer',
              },
              { label: 'Unsubscribed', unit: 'never emailed', value: count(data.suppressedCount), raw: data.suppressedCount, rawType: 'integer' },
            ]}
          />

          <Section title="Sources" note="Contacts are de-duplicated by email across sources">
            <ul className="flex flex-wrap gap-x-8 gap-y-2 text-[13px]" data-testid="contact-sources">
              {data.sources.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    disabled
                    readOnly
                    aria-label={`${s.label} source`}
                    className="accent-[rgb(var(--brand-500))]"
                  />
                  <span className={s.enabled ? 'font-medium text-ink-900' : 'text-ink-400'}>
                    {s.id === 'crm' ? 'CRM (coming soon)' : s.label}
                  </span>
                  <span className="text-[12px] text-ink-500">
                    {s.enabled
                      ? `${count(s.count)} records${s.truncated ? ', first 5,000 only' : ''}`
                      : s.reason}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Directory"
            note={`${count(filtered.length)} of ${count(contacts.length)} contacts shown`}
            actions={
              <DownloadButton
                table="contacts"
                label="filtered contacts"
                disabled={filtered.length === 0}
                sheets={() => [contactsSheet()]}
              />
            }
          >
            <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto_auto] lg:items-center">
              <input
                type="search"
                className="field"
                placeholder="Search name, email, company or plan"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search contacts"
              />
              <select className="field" value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan">
                <option value="">All plans</option>
                {planOptions(contacts).map((p) => (
                  <option key={p} value={p}>
                    {planLabel(p === 'none' ? null : p)}
                  </option>
                ))}
              </select>
              <select
                className="field"
                value={status}
                onChange={(e) => setStatus(e.target.value as ContactStatus | '')}
                aria-label="Subscription status"
              >
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <select
                className="field"
                value={source}
                onChange={(e) => setSource(e.target.value as ContactSourceId | '')}
                aria-label="Source"
              >
                <option value="">All sources</option>
                <option value="stripe">Stripe</option>
                <option value="crm" disabled>
                  CRM (coming soon)
                </option>
              </select>
              <label className="flex items-center gap-2 whitespace-nowrap text-[12.5px] text-ink-700">
                <input
                  type="checkbox"
                  checked={hideSuppressed}
                  onChange={(e) => setHideSuppressed(e.target.checked)}
                  className="accent-[rgb(var(--brand-500))]"
                />
                Hide unsubscribed
              </label>
              <button type="button" className="btn-quiet" onClick={exportCsv} disabled={filtered.length === 0}>
                Export CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="report-table min-w-[880px]">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Company</th>
                    <th>Plan</th>
                    <th>Subscription</th>
                    <th className="num">Created</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-ink-500">
                        {contacts.length === 0 ? 'Stripe returned no customers with an email address.' : 'No contacts match these filters.'}
                      </td>
                    </tr>
                  ) : (
                    filtered.slice(0, 500).map((c) => (
                      <tr key={c.email}>
                        <td className="font-medium text-ink-900">{c.name ?? <span className="text-ink-400">—</span>}</td>
                        <td>
                          {c.email}
                          {c.suppressed && (
                            <span className="ml-2">
                              <Tag>Unsubscribed</Tag>
                            </span>
                          )}
                        </td>
                        <td>{c.company ?? <span className="text-ink-400">—</span>}</td>
                        <td>{planLabel(c.plan)}</td>
                        <td>
                          <Tag tone={statusTone(c.status)}>{STATUS_LABEL[c.status]}</Tag>
                        </td>
                        <td className="num whitespace-nowrap">{shortDate(c.createdAt)}</td>
                        <td className="text-ink-600">{c.sources.map((s) => (s === 'stripe' ? 'Stripe' : 'CRM')).join(', ')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {filtered.length > 500 && (
              <p className="mt-2 text-[12px] text-ink-500">
                Showing the first 500 rows. Download (Excel) and Export CSV include all {count(filtered.length)}.
              </p>
            )}
          </Section>
        </>
      )}

      <Footnotes
        asOfValue={data?.fetchedAt ?? null}
        notes={[
          'Source: Stripe customers (customers.list with subscriptions), read server-side with the existing Stripe key and cached for five minutes. Deleted customers and customers without an email are skipped. The first 5,000 customers are read.',
          'Company: the Atmosphere organization named in the customer’s org_id metadata. Plan and status: the most engaged subscription (active, then trialing, past due, canceled).',
          'Unsubscribed: the address is on the campaign suppression list (unsubscribe link, bounce, complaint or manual) and is never included in a send.',
          'Download (Excel .xlsx) and CSV export contain every filtered row, not just the 500 on screen. In the Excel file every cell is stored as text, a number or a date, never a formula; in the CSV, cells that begin with =, +, −, @ are prefixed so spreadsheets do not run them as formulas.',
        ]}
      />
    </div>
  );
}
