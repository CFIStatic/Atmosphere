import { useEffect, useState } from 'react';
import { api, type AccountStructure as Structure, type DuplicatePair } from '../../lib/api';
import { SpinnerIcon } from '../icons';

/**
 * What a customer is actually attached to.
 *
 * A flat account list makes a property management company with forty HOAs look
 * like forty unrelated wins, so nobody notices that losing one relationship
 * loses all forty. This is the other view: the tree, the relationships that are
 * not ownership, the people, and the duplicates.
 *
 * Two things on this panel are destructive and both preview first. Reparenting
 * can make a loop that hangs every rollup; merging repoints hundreds of records
 * with no one-click way back. Neither is hidden behind a confirm dialogue that
 * says "are you sure" — they say what will happen, in counts, and then ask.
 */

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const LINK_LABEL: Record<string, string> = {
  insures: 'Insures',
  manages: 'Manages',
  owns: 'Owns',
  subcontracts_to: 'Subcontracts to',
  refers: 'Refers',
  vendor_to: 'Supplies',
  related: 'Connected',
};

export function AccountStructure({ accountId }: { accountId: string }) {
  const [data, setData] = useState<Structure | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setData(await api.accountStructure(accountId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this account.');
    }
  }

  useEffect(() => {
    setData(null);
    setError(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  if (error) {
    return (
      <p role="alert" className="text-sm text-danger-600">
        {error}
      </p>
    );
  }
  if (!data) return <p className="text-sm text-ink-600">Loading…</p>;

  const { rollup } = data;
  // The shape this feature exists for: a parent with nothing of its own and
  // everything underneath. Reporting zero for it was the bug.
  const isHolding = rollup.ownJobs === 0 && rollup.jobs > 0;

  return (
    <div className="space-y-4">
      {data.account.mergedIntoId && (
        <p className="rounded-lg border border-caution-200 bg-caution-50 px-4 py-2.5 text-xs text-caution-600">
          This record was merged into another account. It is kept so old links still resolve —
          everything now lives on the surviving one.
        </p>
      )}

      {/* Where it sits. */}
      <section className="rounded-xl glass-card p-4">
        <h3 className="text-sm font-semibold text-ink-900">Where this sits</h3>

        {data.ancestors.length > 0 ? (
          <p className="mt-1.5 text-xs text-ink-600">
            {[...data.ancestors].reverse().map((a) => (
              <span key={a.id}>
                {a.name}
                <span className="mx-1 text-ink-400">›</span>
              </span>
            ))}
            <span className="font-semibold text-ink-900">{data.account.name}</span>
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-ink-500">
            Top level — nothing sits above this account.
          </p>
        )}

        {data.children.length > 0 && (
          <ul className="mt-3 space-y-1">
            {data.children.map((child) => (
              <li
                key={child.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5"
              >
                <span className="text-xs text-ink-800">{child.name}</span>
                <span className="text-[10.5px] text-ink-500">{child.type?.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* What the relationship is worth, which is the whole point of the tree. */}
      <section className="rounded-xl glass-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink-900">
            {rollup.accounts > 1 ? `Across all ${rollup.accounts} accounts` : 'This account'}
          </h3>
          {isHolding && (
            <span className="text-[11px] text-ink-500">
              nothing booked directly — all of it sits underneath
            </span>
          )}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Jobs" value={String(rollup.jobs)} />
          <Tile label="Open" value={String(rollup.openJobs)} />
          <Tile label="Contracted" value={money(rollup.contractTotal)} />
          <Tile label="Paid" value={money(rollup.paidTotal)} />
        </div>
      </section>

      {/* Relationships that are not ownership. */}
      <section className="rounded-xl glass-card p-4">
        <h3 className="text-sm font-semibold text-ink-900">Related companies</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          Carriers, managers, referral partners — connections that are not ownership.
        </p>
        {data.links.length === 0 ? (
          <p className="mt-2 text-xs text-ink-500">None recorded.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {data.links.map((link) => (
              <li
                key={link.id}
                className={`rounded-lg border px-3 py-2 ${
                  link.endedOn ? 'border-line opacity-60' : 'border-line'
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-xs text-ink-800">
                    <span className="font-medium">{LINK_LABEL[link.kind] ?? link.kind}</span>
                    {' — '}
                    {/* Read from this account's side, so it says something true
                        rather than an enum the reader has to orient. */}
                    {data.account.name} {link.reads}
                  </span>
                  {link.endedOn && (
                    <span className="text-[10.5px] text-ink-500">
                      ended {new Date(link.endedOn).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {link.note && <p className="mt-0.5 text-[11px] text-ink-500">{link.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* People, across the whole tree — a director at the parent is a contact
          for every child, and hiding that is how a call goes to the wrong
          person. */}
      <section className="rounded-xl glass-card p-4">
        <h3 className="text-sm font-semibold text-ink-900">People</h3>
        {data.people.length === 0 ? (
          <p className="mt-2 text-xs text-ink-500">
            Nobody attached yet. A contact can hold a role at more than one company — a facilities
            director often sits on two boards.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {data.people.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-ink-800">
                    {person.name}
                    {person.isPrimary && (
                      <span className="ml-1.5 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
                        primary
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-ink-500">
                    {person.role}
                    {person.title ? ` · ${person.title}` : ''}
                    {person.email ? ` · ${person.email}` : ''}
                  </span>
                </span>
                {person.endedOn && (
                  <span className="shrink-0 text-[10.5px] text-ink-400">no longer there</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.mergedIn.length > 0 && (
        <section className="rounded-xl glass-card p-4">
          <h3 className="text-sm font-semibold text-ink-900">Merged into this account</h3>
          <ul className="mt-2 space-y-1">
            {data.mergedIn.map((merge) => (
              <li key={merge.id} className="text-[11px] text-ink-600">
                <span className="text-ink-800">{merge.loserName}</span> —{' '}
                {Object.entries(merge.moved ?? {})
                  .filter(([, n]) => Number(n) > 0)
                  .map(([what, n]) => `${n} ${what}`)
                  .join(', ') || 'nothing attached'}{' '}
                · {new Date(merge.mergedAt).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums text-ink-900">{value}</p>
    </div>
  );
}

/**
 * Likely duplicates, and the merge.
 *
 * Suggestions only. "Cedar Ridge" and "Cedar Grove" are two streets apart and
 * two different customers, so nothing merges off a name comparison — the list
 * is ordered by likeness and a person reads it.
 *
 * The merge previews first and shows counts, because it repoints hundreds of
 * records and there is no one-click way back. "Are you sure?" is not a warning;
 * "this moves 41 jobs and 12 contacts" is.
 */
export function DuplicateAccounts({ onMerged }: { onMerged?: () => void }) {
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null);
  const [preview, setPreview] = useState<Record<string, { total: number; moved: Record<string, number> }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.duplicateAccounts();
      setPairs(res.pairs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check for duplicates.');
      setPairs([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const key = (pair: DuplicatePair) => `${pair.a.id}|${pair.b.id}`;

  async function check(pair: DuplicatePair) {
    setBusy(key(pair));
    setError(null);
    try {
      const loser = pair.suggestedWinner === pair.a.id ? pair.b.id : pair.a.id;
      const res = await api.mergeAccounts({ winnerId: pair.suggestedWinner, loserId: loser });
      setPreview((prev) => ({ ...prev, [key(pair)]: { total: res.total, moved: res.moved } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check that merge.');
    } finally {
      setBusy(null);
    }
  }

  async function merge(pair: DuplicatePair) {
    setBusy(key(pair));
    try {
      const loser = pair.suggestedWinner === pair.a.id ? pair.b.id : pair.a.id;
      const res = await api.mergeAccounts({
        winnerId: pair.suggestedWinner,
        loserId: loser,
        confirm: true,
      });
      setDone(`Merged. ${res.total} record${res.total === 1 ? '' : 's'} moved.`);
      setPreview({});
      await load();
      onMerged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not merge those.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl glass-card p-4">
      <h3 className="text-sm font-semibold text-ink-900">Possible duplicates</h3>
      <p className="mt-0.5 text-xs text-ink-500">
        The same customer often arrives twice — once from a web form, once from a carrier portal.
        Nothing here merges on its own; two streets apart is two customers.
      </p>

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger-600">
          {error}
        </p>
      )}
      {done && <p className="mt-2 text-xs text-success-600">{done}</p>}

      {pairs === null ? (
        <p className="mt-2 text-xs text-ink-600">Checking…</p>
      ) : pairs.length === 0 ? (
        <p className="mt-2 text-xs text-ink-500">Nothing looks duplicated.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {pairs.map((pair) => {
            const k = key(pair);
            const shown = preview[k];
            const winner = pair.suggestedWinner === pair.a.id ? pair.a : pair.b;
            const loser = pair.suggestedWinner === pair.a.id ? pair.b : pair.a;
            return (
              <li key={k} className="rounded-lg border border-line px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-xs text-ink-800">
                    <span className="font-medium">{winner.name}</span>
                    <span className="text-ink-500"> keeps · </span>
                    <span className="line-through decoration-ink-400">{loser.name}</span>
                    <span className="text-ink-500"> folds in</span>
                  </span>
                  <span className="text-[10.5px] text-ink-400">{pair.score}% alike</span>
                </div>
                <p className="mt-0.5 text-[11px] text-ink-500">
                  {winner.attached} record{winner.attached === 1 ? '' : 's'} on the one kept,{' '}
                  {loser.attached} on the one folding in.
                </p>

                {shown && (
                  <p className="mt-2 rounded-lg border border-caution-200 bg-caution-50 px-2.5 py-1.5 text-[11px] text-caution-600">
                    This moves {shown.total} record{shown.total === 1 ? '' : 's'}
                    {Object.entries(shown.moved).filter(([, n]) => n > 0).length > 0 && (
                      <>
                        {' — '}
                        {Object.entries(shown.moved)
                          .filter(([, n]) => n > 0)
                          .map(([what, n]) => `${n} ${what}`)
                          .join(', ')}
                      </>
                    )}
                    . There is no one-click way back.
                  </p>
                )}

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => void check(pair)}
                    disabled={busy === k}
                    className="flex items-center gap-1.5 rounded-lg glass-card px-2.5 py-1 text-[11px] font-medium text-ink-700 disabled:opacity-50"
                  >
                    {busy === k && <SpinnerIcon className="animate-spin" width={11} height={11} />}
                    See what would move
                  </button>
                  {/* Only reachable after the preview. The count is the warning. */}
                  {shown && (
                    <button
                      onClick={() => void merge(pair)}
                      disabled={busy === k}
                      className="rounded-lg bg-brand-600 px-2.5 py-1 text-[11px] font-semibold text-ink-900 disabled:opacity-50"
                    >
                      Merge them
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
