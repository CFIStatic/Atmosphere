import { useEffect, useState } from 'react';
import { api, type OutreachPerson, type OutreachHistory } from '../lib/api';
import { SpinnerIcon } from './icons';

/**
 * Who the platform is writing to on your behalf.
 *
 * This product sends mail. Weather campaigns fire on a forecast, job updates go
 * out mid-delivery, and both leave under the customer's own domain. Somebody
 * has to be able to answer "who are we emailing?" without reading a database,
 * and until now nobody could.
 *
 * One list across both kinds on purpose. A recipient does not experience "a
 * campaign" and "a job update" as two systems — they experience mail from this
 * company, and if it is too much, it is too much. Splitting the view would let
 * each half look reasonable while the total was not.
 *
 * Opt-outs are shown as prominently as sends. A page that displayed volume and
 * hid the people who asked it to stop would be the wrong instrument entirely:
 * the number worth watching is not how many were reached, it is how many
 * bounced or left.
 */
export function CommunicationsPanel() {
  const [people, setPeople] = useState<OutreachPerson[] | null>(null);
  const [totals, setTotals] = useState({ people: 0, messages: 0, bounced: 0, optedOut: 0 });
  const [openEmail, setOpenEmail] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, OutreachHistory>>({});
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .outreachPeople()
      .then((res) => {
        if (!live) return;
        setPeople(res.people);
        setTotals(res.totals);
      })
      .catch((err) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : 'Could not load communications.');
        setPeople([]);
      });
    return () => {
      live = false;
    };
  }, []);

  async function open(email: string) {
    const next = openEmail === email ? null : email;
    setOpenEmail(next);
    if (!next || history[next]) return;
    setLoadingHistory(true);
    try {
      const res = await api.outreachHistory(next);
      setHistory((prev) => ({ ...prev, [next]: res }));
    } catch {
      // The row stays open showing what the list knows, which beats collapsing
      // and looking like the click did nothing.
    } finally {
      setLoadingHistory(false);
    }
  }

  const ago = (iso: string) => {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (!Number.isFinite(days)) return '';
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 31) return `${days}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <section className="rounded-xl glass-card lg:col-span-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold text-ink-900">Who we're reaching out to</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Every message the platform has sent — campaigns and job updates together. Click anyone
            to read the history.
          </p>
        </div>
        <div className="flex gap-4 text-xs tabular-nums">
          <span className="text-ink-600">
            <span className="font-semibold text-ink-900">{totals.people}</span> people
          </span>
          <span className="text-ink-600">
            <span className="font-semibold text-ink-900">{totals.messages}</span> messages
          </span>
          {totals.bounced > 0 && (
            <span className="text-danger-600">
              <span className="font-semibold">{totals.bounced}</span> bounced
            </span>
          )}
          {totals.optedOut > 0 && (
            <span className="text-caution-600">
              <span className="font-semibold">{totals.optedOut}</span> opted out
            </span>
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="px-5 py-4 text-sm text-danger-600">
          {error}
        </p>
      )}

      {people === null ? (
        <p className="px-5 py-8 text-sm text-ink-500">Loading…</p>
      ) : people.length === 0 ? (
        <p className="px-5 py-8 text-sm text-ink-500">
          Nothing has been sent yet. Campaigns and job updates both appear here once they go out.
        </p>
      ) : (
        <ul className="max-h-[26rem] overflow-y-auto">
          {people.map((person) => {
            const on = openEmail === person.email;
            const stopped = person.unsubscribed || person.suppressed;
            const entries = history[person.email]?.messages ?? [];
            return (
              <li key={person.email} className="border-b border-line last:border-b-0">
                <button
                  onClick={() => void open(person.email)}
                  aria-expanded={on}
                  className={`flex w-full items-center gap-3 px-5 py-3 text-left transition ${
                    on ? 'bg-paper-200/50' : 'hover:bg-paper-200/40'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{person.email}</p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {person.campaignMessages > 0 && (
                        <>
                          {person.campaignMessages} campaign
                          {person.campaignMessages === 1 ? '' : 's'}
                        </>
                      )}
                      {person.campaignMessages > 0 && person.updateMessages > 0 && ' · '}
                      {person.updateMessages > 0 && (
                        <>
                          {person.updateMessages} job update
                          {person.updateMessages === 1 ? '' : 's'}
                        </>
                      )}
                      {' · last '}
                      {ago(person.lastAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {person.bounced > 0 && (
                      <span className="rounded-full bg-danger-50 px-2 py-0.5 text-[10.5px] font-semibold text-danger-600">
                        bounced
                      </span>
                    )}
                    {/* The most important badge here. Somebody who asked to stop
                        should be visibly off the list, not quietly filtered. */}
                    {stopped && (
                      <span className="rounded-full bg-caution-50 px-2 py-0.5 text-[10.5px] font-semibold text-caution-600">
                        {person.unsubscribed ? 'unsubscribed' : 'suppressed'}
                      </span>
                    )}
                  </div>
                </button>

                {on && (
                  <div className="border-t border-line bg-paper-50/50 px-5 py-3">
                    {stopped && (
                      <p className="mb-2 text-[11px] text-caution-600">
                        Nothing further will be sent to this address. Pick up the phone instead.
                      </p>
                    )}
                    {entries.length === 0 && loadingHistory ? (
                      <p className="flex items-center gap-2 text-xs text-ink-500">
                        <SpinnerIcon className="animate-spin" width={13} height={13} />
                        Loading the history…
                      </p>
                    ) : entries.length === 0 ? (
                      <p className="text-xs text-ink-500">No messages found.</p>
                    ) : (
                      <ol className="space-y-2">
                        {entries.map((message) => (
                          <li key={message.id} className="flex gap-2.5">
                            <span
                              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                                message.state === 'sent'
                                  ? 'bg-success-600'
                                  : message.state === 'bounced'
                                    ? 'bg-danger-600'
                                    : message.state === 'blocked'
                                      ? 'bg-caution-600'
                                      : 'bg-ink-400'
                              }`}
                              aria-hidden="true"
                            />
                            <span className="min-w-0">
                              <span className="block text-xs text-ink-800">
                                {message.subject ?? '(no subject)'}
                              </span>
                              <span className="block text-[11px] text-ink-500">
                                {message.kind === 'campaign' ? 'Campaign' : 'Job update'}
                                {message.about ? ` · ${message.about}` : ''}
                                {' · '}
                                {message.state}
                                {/* Why it did not go is the whole reason
                                    somebody opens this: "why didn't Marcia get
                                    this?" is the question that gets asked. */}
                                {message.blockedReason
                                  ? ` (${message.blockedReason.replace(/_/g, ' ')})`
                                  : ''}
                                {' · '}
                                {ago(message.at)}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
