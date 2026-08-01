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
  task: 'bg-success-50 text-success-600 ring-success-200',
  assignment: 'bg-paper-300 text-ink-700 ring-line-strong',
  work_log: 'bg-caution-50 text-caution-600 ring-caution-200',
  auth: 'bg-paper-200 text-[color:var(--pm-info)] ring-line-strong',
  export: 'bg-danger-50 text-danger-600 ring-danger-200',
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
          FAMILY_STYLES[fam] ?? 'bg-paper-200 text-ink-700 ring-line-strong'
        }`}
      >
        {FAMILY_GLYPHS[fam] ?? '•'}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-800">
          <span className="font-medium text-ink-900">{who}</span>{' '}
          <span className="text-ink-700">{event.summary}</span>
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-500">
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
                className="font-medium text-ink-600 underline-offset-2 transition hover:text-ink-800 hover:underline"
              >
                {open ? 'Hide' : `${fields.length} ${fields.length === 1 ? 'change' : 'changes'}`}
              </button>
            </>
          )}
        </div>

        {open && fields.length > 0 && (
          <dl className="mt-2.5 space-y-1.5 rounded-lg border border-line bg-paper-100/60 p-3">
            {fields.map(([key, change]) => (
              <div key={key} className="grid gap-1 text-xs sm:grid-cols-[10rem_1fr] sm:gap-3">
                <dt className="font-medium text-ink-600">{key.replace(/_/g, ' ')}</dt>
                <dd className="flex flex-wrap items-center gap-2 text-ink-700">
                  <span className="text-ink-500 line-through">{renderValue(change.from)}</span>
                  <span aria-hidden="true" className="text-ink-500">
                    →
                  </span>
                  <span className="font-medium text-ink-900">{renderValue(change.to)}</span>
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
      <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
        <p className="text-sm text-ink-500">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-paper-0">
      <ul className="divide-y divide-line">
        {events.map((event) => (
          <EventRow key={event.id} event={event} showJob={showJob} />
        ))}
      </ul>
    </div>
  );
}
