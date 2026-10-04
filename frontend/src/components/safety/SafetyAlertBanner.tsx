import { useState } from 'react';
import type { SafetyDismissCategory, SafetyIncident } from '../../lib/api';

/**
 * Open safety alerts on a job. The office must Acknowledge, or Dismiss WITH a
 * reason (the reason feeds false-alarm tuning: a TV / podcast playing, a
 * joke, acting…). "Unconfirmed" alerts — the automatic check could not tell
 * whether it is real — point straight at the live view.
 */

export const DISMISS_REASONS: Array<{ value: SafetyDismissCategory; label: string }> = [
  { value: 'false_alarm_media', label: 'False alarm: TV / video / podcast playing' },
  { value: 'joking', label: 'False alarm: joking' },
  { value: 'staged', label: 'False alarm: staged / acting' },
  { value: 'not_an_emergency', label: 'Not an emergency' },
  { value: 'handled', label: 'Real — handled' },
  { value: 'duplicate', label: 'Duplicate alert' },
  { value: 'other', label: 'Other (say why)' },
];

function clock(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function realityLabel(reality: SafetyIncident['reality']): string | null {
  switch (reality) {
    case 'real':
      return 'Checked: looks real';
    case 'unclear':
      return 'Checked: could not tell if real';
    default:
      return null;
  }
}

export function shouldShowSafetyIncident(i: SafetyIncident): boolean {
  return i.status === 'open' && (i.severity === 'critical' || i.category === 'silent_panic_wellness');
}

function IncidentRow({
  incident,
  onAck,
  onDismiss,
  onOpenLive,
}: {
  incident: SafetyIncident;
  onAck: (id: string) => Promise<unknown>;
  onDismiss: (id: string, category: SafetyDismissCategory, note?: string) => Promise<unknown>;
  onOpenLive?: () => void;
}) {
  const [dismissing, setDismissing] = useState(false);
  const [category, setCategory] = useState<SafetyDismissCategory | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const unconfirmed = incident.confirmation === 'unconfirmed';
  const title = incident.title.replace(/^Unconfirmed: check live view\s*[—-]\s*/i, '');
  const needsNote = category === 'other' && note.trim().length < 3;
  const reality = realityLabel(incident.reality);

  return (
    <li
      className={`rounded-lg border p-3 text-sm ${
        unconfirmed ? 'border-amber-500/50 bg-amber-500/10' : 'border-red-500/40 bg-white/60 dark:bg-transparent'
      }`}
      data-testid="safety-incident"
      data-confirmation={incident.confirmation ?? ''}
    >
      <div className="flex flex-wrap items-center gap-2">
        {unconfirmed ? (
          <span className="rounded bg-amber-600 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
            Unconfirmed — check live view
          </span>
        ) : (
          <span className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
            {incident.severity}
            {incident.confirmation === 'confirmed' ? ' · confirmed' : ''}
          </span>
        )}
        {incident.source === 'live_stream' && (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">Live</span>
        )}
        <span className="text-xs text-ink-500">{clock(incident.createdAt)}</span>
      </div>
      <p className="mt-1 font-semibold text-ink-900">{title}</p>
      {incident.description && <p className="mt-0.5 text-xs text-ink-600">{incident.description}</p>}
      <p className="mt-1 text-xs text-ink-500">
        {[reality, incident.clipTimestampSeconds != null ? `${Math.round(incident.clipTimestampSeconds)}s into the recording` : null]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {incident.workerOkAt && (
        <p className="mt-1 text-xs font-semibold text-emerald-700" data-testid="safety-worker-ok">
          Worker tapped “I’m OK” at {clock(incident.workerOkAt)}
        </p>
      )}

      {!dismissing ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {onOpenLive && (
            <button
              type="button"
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
              onClick={onOpenLive}
            >
              Open live view
            </button>
          )}
          <button
            type="button"
            className="rounded-md bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onAck(incident.id).finally(() => setBusy(false));
            }}
          >
            Acknowledge
          </button>
          <button
            type="button"
            className="rounded-md border border-line px-3 py-1.5 text-xs"
            onClick={() => setDismissing(true)}
          >
            Dismiss…
          </button>
        </div>
      ) : (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!category || needsNote) return;
            setBusy(true);
            void onDismiss(incident.id, category, note.trim() || undefined).finally(() => setBusy(false));
          }}
        >
          <label className="block text-xs font-medium text-ink-700" htmlFor={`dismiss-${incident.id}`}>
            Why are you dismissing this alert?
          </label>
          <select
            id={`dismiss-${incident.id}`}
            className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-sm dark:bg-transparent"
            value={category}
            onChange={(e) => setCategory(e.target.value as SafetyDismissCategory)}
            required
          >
            <option value="">Choose a reason…</option>
            {DISMISS_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-sm dark:bg-transparent"
            placeholder={category === 'other' ? 'Say why (required)' : 'Note (optional)'}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Dismiss note"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              disabled={!category || needsNote || busy}
            >
              Dismiss alert
            </button>
            <button type="button" className="rounded-md border border-line px-3 py-1.5 text-xs" onClick={() => setDismissing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export function SafetyAlertBanner({
  incidents,
  onAck,
  onDismiss,
  onOpenLive,
}: {
  incidents: SafetyIncident[];
  onAck: (id: string) => Promise<unknown>;
  onDismiss: (id: string, category: SafetyDismissCategory, note?: string) => Promise<unknown>;
  onOpenLive?: () => void;
}) {
  const open = incidents.filter(shouldShowSafetyIncident);
  if (!open.length) return null;
  return (
    <section
      className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4"
      data-testid="job-safety-alert-banner"
      role="alert"
    >
      <p className="text-sm font-semibold text-red-700 dark:text-red-300">Safety / wellness alert on this job</p>
      <p className="mt-0.5 text-xs text-ink-600">
        Acknowledge, or dismiss with a reason. Atmosphere never calls 911 — if someone is in danger, call emergency services yourself.
      </p>
      <ul className="mt-2 space-y-2">
        {open.map((incident) => (
          <IncidentRow key={incident.id} incident={incident} onAck={onAck} onDismiss={onDismiss} onOpenLive={onOpenLive} />
        ))}
      </ul>
    </section>
  );
}
