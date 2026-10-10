import { useState } from 'react';
import { ChevronRightIcon } from '../icons';

/**
 * The invite list both Share tabs use: live invites up top with a Revoke
 * button, everything revoked or expired folded under one toggle so the people
 * who can still get in stand out.
 */

export type InviteState = 'live' | 'expired' | 'revoked';

export interface InviteItem {
  id: string;
  title: string;
  meta: string;
  state: InviteState;
}

const STATE_STYLE: Record<InviteState, string> = {
  live: 'bg-success-50 text-success-600',
  expired: 'bg-paper-200/60 text-ink-500',
  revoked: 'bg-danger-50 text-danger-600',
};

export function InviteList({
  items,
  onRevoke,
  glass = true,
  heading = true,
  emptyText = 'Nobody has been invited yet.',
}: {
  items: InviteItem[] | null;
  onRevoke: (id: string) => void;
  /** Rows sit on a glass popup rather than a card. */
  glass?: boolean;
  /** Show the small "Invites" label above the list. */
  heading?: boolean;
  emptyText?: string;
}) {
  const [showPast, setShowPast] = useState(false);

  if (items === null) return <p className="mt-4 text-xs text-ink-500">Loading…</p>;
  if (items.length === 0) return <p className="mt-4 text-xs text-ink-500">{emptyText}</p>;

  const live = items.filter((i) => i.state === 'live');
  const past = items.filter((i) => i.state !== 'live');
  const pastLabel = past.every((i) => i.state === 'revoked') ? 'Revoked' : 'Past invites';

  const row = (item: InviteItem) => (
    <li
      key={item.id}
      className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 ${
        glass ? 'glass-row' : 'border border-line'
      }`}
    >
      <div className="min-w-0">
        <p
          className={`truncate text-sm font-medium ${item.state === 'live' ? 'text-ink-900' : 'text-ink-600'}`}
        >
          {item.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-500">{item.meta}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATE_STYLE[item.state]}`}
        >
          {item.state === 'live' ? (
            <span className="h-1.5 w-1.5 rounded-full bg-success-600" aria-hidden />
          ) : null}
          {item.state}
        </span>
        {item.state === 'live' && (
          <button
            type="button"
            onClick={() => onRevoke(item.id)}
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink-500 transition hover:bg-danger-50 hover:text-danger-600"
          >
            Revoke
          </button>
        )}
      </div>
    </li>
  );

  return (
    <div className={glass ? 'mt-6' : 'mt-3'}>
      {heading ? (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Invites
        </p>
      ) : null}
      {live.length > 0 ? (
        <ul className="space-y-2">{live.map(row)}</ul>
      ) : (
        <p className="text-xs text-ink-500">No live invites.</p>
      )}
      {past.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowPast(!showPast)}
            aria-expanded={showPast}
            className="inline-flex items-center gap-1 rounded-md py-1 text-xs font-medium text-ink-500 transition hover:text-ink-800"
          >
            <ChevronRightIcon
              width={14}
              height={14}
              className={`transition-transform ${showPast ? 'rotate-90' : ''}`}
              aria-hidden
            />
            {pastLabel} ({past.length})
          </button>
          {showPast ? <ul className="mt-2 space-y-2">{past.map(row)}</ul> : null}
        </div>
      ) : null}
    </div>
  );
}
