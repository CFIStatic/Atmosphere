import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Mail, MessageSquare } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { count, dateTime, money } from '../lib/format';
import { humanize, relativeDay } from '../lib/customers';
import {
  addressOf,
  contactsFor,
  daysLabel,
  overdueTotals,
  phoneLabel,
  SMS_BODY_MAX,
  TEMPLATES,
  templateText,
  type OverdueAccount,
  type OverdueChannel,
  type OverdueContact,
  type OverdueResponse,
  type OverdueSendResult,
  type TemplateKey,
} from '../lib/overdue';
import { ErrorLine, KpiStrip, Loading, PageHeader, Section } from '../components/report';

function Pill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={`inline-block whitespace-nowrap border px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${tone}`}>
      {label}
    </span>
  );
}

const DANGER = 'border-danger-600/40 bg-danger-600/10 text-danger-600';
const CAUTION = 'border-caution-600/40 bg-caution-600/10 text-caution-600';

function daysTone(days: number | null): string {
  if (days === null) return 'text-ink-500';
  if (days >= 30) return 'font-semibold text-danger-600';
  if (days >= 14) return 'font-medium text-caution-600';
  return 'text-ink-800';
}

type Compose = { account: OverdueAccount; channel: OverdueChannel; to: OverdueContact | null };

export function OverduePage() {
  const [data, setData] = useState<OverdueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [compose, setCompose] = useState<Compose | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.overdue());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load accounts behind on payments.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    api
      .overdue()
      .then((d) => alive && setData(d))
      .catch((err: unknown) => alive && setError(err instanceof ApiError ? err.message : 'Could not load accounts behind on payments.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const totals = useMemo(() => overdueTotals(accounts), [accounts]);

  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };

  if (loading && !data) return <Loading label="Loading accounts behind on payments" />;

  return (
    <div>
      <PageHeader
        eyebrow="Growth & revenue"
        title="Behind on payments"
        subtitle="Workspaces with a failed or overdue Stripe invoice, and the people to contact about it. Internal staff only. Every email and text you send here is logged."
        asOfValue={data?.generatedAt ?? null}
        actions={
          <button type="button" className="btn-quiet" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      <KpiStrip
        items={[
          { label: 'Accounts behind', unit: 'workspaces', value: count(totals.accounts) },
          { label: 'Total owed', unit: 'USD, overdue invoices', value: data?.stripeChecked ? money(totals.owedCents) : '—' },
          { label: '30+ days', unit: 'workspaces', value: count(totals.over30) },
        ]}
      />

      {error && <ErrorLine message={error} onRetry={() => void load()} />}
      {data && !data.stripeChecked && (
        <p className="mt-4 border-l-2 border-caution-600 bg-paper-0 px-3 py-2 text-[13px] text-ink-700">
          Stripe could not be read ({data.stripeError ?? 'unknown error'}). Only workspaces our billing marks past due are listed, without amounts.
        </p>
      )}
      {data && (!data.emailReady || !data.smsReady) && (
        <p className="mt-3 text-[12.5px] text-ink-500">
          {!data.emailReady && 'Email is not set up on this server. '}
          {!data.smsReady && 'Texting is not set up yet (needs the Twilio settings on the API), so Text is turned off.'}
        </p>
      )}

      <Section
        title={`${count(accounts.length)} ${accounts.length === 1 ? 'workspace' : 'workspaces'} behind`}
        note={accounts.length ? 'Most owed first. Click a row for contacts, invoices and messages' : undefined}
      >
        <div className="overflow-x-auto">
          <table className="report-table min-w-[900px]">
            <thead>
              <tr>
                <th>Workspace</th>
                <th className="num">Owed</th>
                <th className="num">Overdue</th>
                <th className="num">Oldest invoice</th>
                <th>Contacts</th>
                <th className="num">Last message</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const expanded = open.has(a.orgId);
                const emails = contactsFor(a, 'email').length;
                const phones = contactsFor(a, 'sms').length;
                return (
                  <Fragment key={a.orgId}>
                    <tr
                      className={`cursor-pointer [&>td]:!py-2.5 ${expanded ? '[&>td]:!border-b-0 [&>td]:!bg-paper-50' : ''}`}
                      onClick={() => toggle(a.orgId)}
                      aria-expanded={expanded}
                    >
                      <td>
                        <div className="flex items-start gap-2.5">
                          {expanded ? (
                            <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-500" />
                          ) : (
                            <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-500" />
                          )}
                          <div>
                            <div className="font-semibold text-ink-900">{a.name}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <Pill label={humanize(a.billingStatus ?? 'overdue')} tone={(a.daysOverdue ?? 0) >= 14 ? DANGER : CAUTION} />
                              {a.planCode && <span className="text-[11.5px] text-ink-500">{humanize(a.planCode, true)}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="num font-semibold text-ink-900">{a.amountDueCents === null ? '—' : money(a.amountDueCents)}</td>
                      <td className={`num ${daysTone(a.daysOverdue)}`}>{daysLabel(a.daysOverdue)}</td>
                      <td className="num">{a.oldestDueAt ? dateTime(a.oldestDueAt) : <span className="text-ink-400">—</span>}</td>
                      <td>
                        <div className="whitespace-nowrap text-ink-800">
                          {count(emails)} email · {count(phones)} phone
                        </div>
                      </td>
                      <td className="num">
                        {a.lastMessageAt ? (
                          <div className="whitespace-nowrap">
                            <div className="text-ink-800">{dateTime(a.lastMessageAt)}</div>
                            <div className="mt-0.5 text-[11.5px] text-ink-500">{relativeDay(a.lastMessageAt)}</div>
                          </div>
                        ) : (
                          <span className="text-ink-400">Never</span>
                        )}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            className="btn-quiet inline-flex items-center gap-1"
                            disabled={emails === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCompose({ account: a, channel: 'email', to: null });
                            }}
                          >
                            <Mail className="h-3.5 w-3.5" /> Email
                          </button>
                          <button
                            type="button"
                            className="btn-quiet inline-flex items-center gap-1"
                            disabled={phones === 0 || !data?.smsReady}
                            title={!data?.smsReady ? 'Texting is not set up yet' : undefined}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCompose({ account: a, channel: 'sms', to: null });
                            }}
                          >
                            <MessageSquare className="h-3.5 w-3.5" /> Text
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="[&>td]:!bg-paper-50">
                        <td colSpan={7} className="!px-3 !pb-4 !pt-0">
                          <AccountDetail
                            account={a}
                            smsReady={Boolean(data?.smsReady)}
                            onCompose={(channel, to) => setCompose({ account: a, channel, to })}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-ink-500">
                    Nobody is behind on payments.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {compose && (
        <ComposeDialog
          compose={compose}
          onClose={() => setCompose(null)}
          onSent={() => void load()}
        />
      )}
    </div>
  );
}

function AccountDetail({
  account,
  smsReady,
  onCompose,
}: {
  account: OverdueAccount;
  smsReady: boolean;
  onCompose: (channel: OverdueChannel, to: OverdueContact) => void;
}) {
  return (
    <div className="ml-[22px] grid gap-3 border-l-2 border-brand-500 bg-paper-0 p-3 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <p className="eyebrow px-1 pb-1.5">Billing contacts</p>
        {account.contacts.length === 0 ? (
          <p className="px-1 text-[13px] text-ink-500">No owner, admin or Stripe contact on file.</p>
        ) : (
          <ul className="divide-y divide-line border border-line">
            {account.contacts.map((c, i) => (
              <li key={`${c.email ?? c.phone}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2">
                <div className="min-w-[160px] flex-1">
                  <div className="font-medium text-ink-900">{c.name ?? c.email ?? phoneLabel(c.phone)}</div>
                  <div className="text-[11.5px] text-ink-500">{c.role}</div>
                </div>
                <div className="min-w-[200px] flex-1 text-[13px]">
                  {c.email ? (
                    <a className="text-ink-800 underline-offset-2 hover:underline" href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()}>
                      {c.email}
                    </a>
                  ) : (
                    <span className="text-ink-400">No email</span>
                  )}
                  <div>
                    {c.phone ? (
                      <a className="text-ink-800 underline-offset-2 hover:underline" href={`tel:${c.phone}`}>
                        {phoneLabel(c.phone)}
                      </a>
                    ) : (
                      <span className="text-ink-400">No phone</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" className="btn-quiet inline-flex items-center gap-1" disabled={!c.email} onClick={() => onCompose('email', c)}>
                    <Mail className="h-3.5 w-3.5" /> Email
                  </button>
                  <button
                    type="button"
                    className="btn-quiet inline-flex items-center gap-1"
                    disabled={!c.phone || !smsReady}
                    onClick={() => onCompose('sms', c)}
                  >
                    <MessageSquare className="h-3.5 w-3.5" /> Text
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="eyebrow px-1 pb-1.5">Overdue invoices</p>
        {account.invoices.length === 0 ? (
          <p className="px-1 text-[13px] text-ink-500">No overdue invoice found in Stripe. Billing marks this workspace past due.</p>
        ) : (
          <ul className="divide-y divide-line border border-line">
            {account.invoices.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                <div className="min-w-0">
                  <div className="truncate text-ink-900">{inv.description ?? inv.number ?? inv.id}</div>
                  <div className="text-[11.5px] text-ink-500">
                    {inv.number ?? inv.id} · {dateTime(inv.dueAt)} · {count(inv.attempts)} {inv.attempts === 1 ? 'charge attempt' : 'charge attempts'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-semibold tabular-nums text-ink-900">{money(inv.amountDueCents)}</span>
                  {inv.hostedInvoiceUrl && (
                    <a className="btn-quiet inline-flex items-center gap-1" href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                      Pay page <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="eyebrow px-1 pb-1.5">Messages sent</p>
        {account.messages.length === 0 ? (
          <p className="px-1 text-[13px] text-ink-500">Nothing sent from here yet.</p>
        ) : (
          <ul className="divide-y divide-line border border-line">
            {account.messages.map((m) => (
              <li key={m.id} className="px-3 py-2 text-[13px]">
                <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-500">
                  <span className="font-medium text-ink-800">{m.channel === 'email' ? 'Email' : 'Text'}</span>
                  <span>to {m.channel === 'sms' ? phoneLabel(m.recipient) : m.recipient}</span>
                  <span>· {dateTime(m.createdAt)}</span>
                  {m.sentByEmail && <span>· by {m.sentByEmail}</span>}
                  {m.status !== 'sent' && (
                    <Pill label={m.status === 'logged' ? 'Logged only' : 'Failed'} tone={m.status === 'failed' ? DANGER : CAUTION} />
                  )}
                </div>
                {m.subject && <div className="mt-0.5 font-medium text-ink-900">{m.subject}</div>}
                <div className="mt-0.5 line-clamp-2 whitespace-pre-line text-ink-700">{m.body}</div>
                {m.error && <div className="mt-0.5 text-[11.5px] text-danger-600">{m.error}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ComposeDialog({ compose, onClose, onSent }: { compose: Compose; onClose: () => void; onSent: () => void }) {
  const { account } = compose;
  const [channel, setChannel] = useState<OverdueChannel>(compose.channel);
  const options = contactsFor(account, channel);
  const [selected, setSelected] = useState<Set<string>>(() =>
    new Set(compose.to ? [addressOf(compose.to, compose.channel)] : contactsFor(account, compose.channel).slice(0, 1).map((c) => addressOf(c, compose.channel))),
  );
  const [template, setTemplate] = useState<TemplateKey>('reminder');
  const initial = templateText('reminder', compose.channel, account, compose.to ?? options[0]);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<OverdueSendResult[] | null>(null);

  const firstSelected = options.find((c) => selected.has(addressOf(c, channel)));
  const applyTemplate = (key: TemplateKey, ch: OverdueChannel = channel, to: OverdueContact | undefined = firstSelected) => {
    const t = templateText(key, ch, account, to);
    setTemplate(key);
    setSubject(t.subject);
    setBody(t.body);
  };
  const switchChannel = (ch: OverdueChannel) => {
    if (ch === channel) return;
    const next = contactsFor(account, ch);
    setChannel(ch);
    setSelected(new Set(next.slice(0, 1).map((c) => addressOf(c, ch))));
    applyTemplate(template, ch, next[0]);
    setResults(null);
  };
  const toggle = (address: string) => {
    const next = new Set(selected);
    if (next.has(address)) next.delete(address);
    else next.add(address);
    setSelected(next);
  };

  const tooLong = channel === 'sms' && body.trim().length > SMS_BODY_MAX;
  const canSend = !busy && selected.size > 0 && body.trim().length > 0 && (channel === 'sms' || subject.trim().length > 0) && !tooLong;
  const noun = channel === 'email' ? 'email' : 'text';

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.messageOverdue(account.orgId, {
        channel,
        recipients: [...selected],
        subject: channel === 'email' ? subject : null,
        body,
      });
      setResults(res.results);
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not send the ${noun}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="compose-title">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto border border-line bg-paper-0 p-5 shadow-xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          {account.amountDueCents ? `${money(account.amountDueCents)} past due · ` : ''}
          {daysLabel(account.daysOverdue)}
        </div>
        <h2 id="compose-title" className="mt-1 text-lg font-semibold text-ink-900">
          Message {account.name}
        </h2>

        {results ? (
          <div className="mt-4">
            <ul className="divide-y divide-line border border-line text-[13px]">
              {results.map((r) => (
                <li key={r.recipient} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-ink-800">{channel === 'sms' ? phoneLabel(r.recipient) : r.recipient}</span>
                  <span className={r.status === 'failed' ? 'text-danger-600' : r.status === 'logged' ? 'text-caution-600' : 'text-success-600'}>
                    {r.status === 'sent' ? 'Sent' : r.status === 'logged' ? 'Written to the mail log (not sent)' : `Failed: ${r.error ?? 'unknown error'}`}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-end">
              <button type="button" className="btn-quiet" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 flex" role="group" aria-label="Send as">
              {(['email', 'sms'] as const).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  aria-pressed={channel === ch}
                  onClick={() => switchChannel(ch)}
                  className={`-ml-px border px-3 py-[6px] text-[12.5px] font-medium first:ml-0 ${
                    channel === ch ? 'z-[1] border-ink-900 bg-ink-900 text-paper-0' : 'border-line-strong bg-paper-0 text-ink-700 hover:text-ink-900'
                  }`}
                >
                  {ch === 'email' ? 'Email' : 'Text'}
                </button>
              ))}
            </div>

            <fieldset className="mt-4">
              <legend className="text-[12px] font-medium text-ink-700">To</legend>
              {options.length === 0 ? (
                <p className="mt-1 text-[13px] text-ink-500">Nobody here has {channel === 'email' ? 'an email address' : 'a phone number'} on file.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {options.map((c) => {
                    const address = addressOf(c, channel);
                    return (
                      <li key={address}>
                        <label className="flex items-center gap-2 text-[13px] text-ink-800">
                          <input type="checkbox" checked={selected.has(address)} onChange={() => toggle(address)} />
                          <span className="font-medium">{c.name ?? address}</span>
                          <span className="text-ink-500">
                            {channel === 'sms' ? phoneLabel(address) : address} · {c.role}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </fieldset>

            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] font-medium text-ink-700">Start from</span>
              {TEMPLATES.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`btn-quiet ${template === key ? 'border-ink-900 text-ink-900' : ''}`}
                  onClick={() => applyTemplate(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {channel === 'email' && (
              <>
                <label htmlFor="compose-subject" className="mt-4 block text-[12px] font-medium text-ink-700">
                  Subject
                </label>
                <input id="compose-subject" className="field mt-1 w-full" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
              </>
            )}
            <label htmlFor="compose-body" className="mt-4 block text-[12px] font-medium text-ink-700">
              Message
            </label>
            <textarea
              id="compose-body"
              className="field mt-1 w-full font-[inherit]"
              rows={channel === 'email' ? 10 : 4}
              value={body}
              maxLength={channel === 'email' ? 5000 : undefined}
              onChange={(e) => setBody(e.target.value)}
            />
            {channel === 'sms' && (
              <p className={`mt-1 text-right text-[11.5px] ${tooLong ? 'text-danger-600' : 'text-ink-500'}`}>
                {count(body.trim().length)} / {count(SMS_BODY_MAX)}
              </p>
            )}
            <p className="mt-2 text-[12px] text-ink-500">
              Sent from Atmosphere ({channel === 'email' ? 'hello@invites.atmosphereteam.com, replies go to hello@atmosphereteam.com' : 'the Atmosphere texting number'}). Your
              name and the message are logged on this account.
            </p>

            {error && <p className="mt-3 text-[12.5px] text-danger-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-quiet" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-quiet border-ink-900 bg-ink-900 text-paper-0 hover:text-paper-0"
                onClick={() => void send()}
                disabled={!canSend}
              >
                {busy ? 'Sending…' : `Send ${noun} to ${count(selected.size)} ${selected.size === 1 ? 'person' : 'people'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
