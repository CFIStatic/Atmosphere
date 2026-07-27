import { useState } from 'react';
import { Link } from 'react-router-dom';
import { timeAgo, type MemoryEvent } from '../lib/api';

/**
 * The record, rendered.
 *
 * Every entry shows who, what and when in one line. The field-level before and
 * after is kept behind a toggle rather than dropped: a feed that only says
 * "updated job JOB-0004" is a log, not a memory — but a feed that shows every
 * diff inline is unreadable. So the sentence is always visible and the detail is
 * always one click away.
 */

/** Groups the event families onto a colour so the feed is scannable. */
const FAMILY_STYLES: Record<string, string> = {
  job: 'bg-brand-500/15 text-brand-200 ring-brand-400/30',
  task: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30',
  assignment: 'bg-violet-500/15 text-violet-200 ring-violet-400/30',
  work_log: 'bg-amber-500/15 text-amber-200 ring-amber-400/30',
  auth: 'bg-sky-500/15 text-sky-200 ring-sky-400/30',
  export: 'bg-rose-500/15 text-rose-200 ring-rose-400/30',
};

const FAMILY_GLYPHS: Record<string, string> = {
  job: 'J',
  task: 'T',
  assignment: 'A',
  work_log: 'W',
  auth: '·',
  export: '↓',
};

function family(eventType: string): string {
  return eventType.split('.')[0] ?? 'job';
}

/** `in_progress` reads badly in a diff; `in progress` reads fine. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString();
    if (value === '') return '—';
    return value.replace(/_/g, ' ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const HIDDEN_FIELDS = new Set(['id', 'org_id', 'updated_at', 'seq_no']);

function EventRow({ event, showJob }: { event: MemoryEvent; showJob: boolean }) {
  const [open, setOpen] = useState(false);

  const fields = Object.entries(event.changes ?? {}).filter(([key]) => !HIDDEN_FIELDS.has(key));
  const fam = family(event.eventType);
  const who = event.actorEmail ?? 'Someone';

  return (
    <li className="flex gap-3 px-4 py-3.5 sm:px-5">
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ring-1 ${
          FAMILY_STYLES[fam] ?? 'bg-white/5 text-gray-300 ring-white/15'
        }`}
      >
        {FAMILY_GLYPHS[fam] ?? '•'}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-200">
          <span className="font-medium text-white">{who}</span>{' '}
          <span className="text-gray-300">{event.summary}</span>
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-gray-500">
          <time dateTime={event.occurredAt} title={new Date(event.occurredAt).toLocaleString()}>
            {timeAgo(event.occurredAt)}
          </time>
          {event.actorRole && <span>· {event.actorRole.replace(/_/g, ' ')}</span>}
          {showJob && event.job && (
            <>
              <span aria-hidden="true">·</span>
              <Link
                to={`/jobs/${event.job.id}`}
                className="font-medium text-brand-300 transition hover:text-brand-200"
              >
                {event.job.jobNumber}
              </Link>
            </>
          )}
          {fields.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <button
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="font-medium text-gray-400 underline-offset-2 transition hover:text-gray-200 hover:underline"
              >
                {open ? 'Hide' : `${fields.length} ${fields.length === 1 ? 'change' : 'changes'}`}
              </button>
            </>
          )}
        </div>

        {open && fields.length > 0 && (
          <dl className="mt-2.5 space-y-1.5 rounded-lg border border-white/10 bg-ink-900/60 p-3">
            {fields.map(([key, change]) => (
              <div key={key} className="grid gap-1 text-xs sm:grid-cols-[10rem_1fr] sm:gap-3">
                <dt className="font-medium text-gray-400">{key.replace(/_/g, ' ')}</dt>
                <dd className="flex flex-wrap items-center gap-2 text-gray-300">
                  <span className="text-gray-500 line-through">{renderValue(change.from)}</span>
                  <span aria-hidden="true" className="text-gray-600">
                    →
                  </span>
                  <span className="font-medium text-white">{renderValue(change.to)}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  );
}

export function MemoryFeed({
  events,
  showJob = true,
  emptyLabel = 'Nothing recorded yet.',
}: {
  events: MemoryEvent[];
  showJob?: boolean;
  emptyLabel?: string;
}) {
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 px-6 py-10 text-center">
        <p className="text-sm text-gray-500">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-ink-800/40">
      <ul className="divide-y divide-white/10">
        {events.map((event) => (
          <EventRow key={event.id} event={event} showJob={showJob} />
        ))}
      </ul>
    </div>
  );
}
