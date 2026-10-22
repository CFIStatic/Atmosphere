import { useEffect, useMemo, useState } from 'react';
import { api, type HomeownerPermissions, type ShareDelayHours } from '../../lib/api';
import { SpinnerIcon } from '../icons';

/**
 * Job settings → Homeowner permissions. The general contractor picks what
 * the invited homeowner may see and do on this job file. Everything is on
 * by default (the homeowner sees the same job file as the office). The
 * server enforces these; hiding here is only the reflection of that.
 *
 * Pay, disputes, internal and analyst notes, and anything that changes the
 * job are always hidden from homeowners and are not settings.
 */

type Key = keyof HomeownerPermissions;

/** Everything on: what homeowners get when the office has not changed anything. */
const ALL_ON: HomeownerPermissions = {
  seeVideos: true,
  seeTranscripts: true,
  seeAiSummaries: true,
  seeScope: true,
  seeEvidenceReport: true,
  seeAccessList: true,
  useChat: true,
  downloadFiles: true,
};

export const HOMEOWNER_PERMISSION_ROWS: Array<{ key: Key; label: string; help: string; group: 'see' | 'do' }> = [
  { key: 'seeVideos', label: 'Videos', help: 'Videos tab, Timeline clips and playback.', group: 'see' },
  { key: 'seeTranscripts', label: 'Transcripts', help: 'Word-for-word text of each video.', group: 'see' },
  { key: 'seeAiSummaries', label: 'AI summaries', help: 'AI notes on each video and day.', group: 'see' },
  { key: 'seeScope', label: 'Job details & scope', help: 'Brief and scope lines, never prices.', group: 'see' },
  { key: 'seeEvidenceReport', label: 'Evidence report', help: 'Evidence report tab and PDF.', group: 'see' },
  { key: 'seeAccessList', label: 'Who has access', help: 'Access tab: everyone on this job.', group: 'see' },
  { key: 'useChat', label: 'Chat', help: 'Ask questions about this job.', group: 'do' },
  { key: 'downloadFiles', label: 'Download videos', help: 'Download button on each video.', group: 'do' },
];

/** Same rule as the server: Chat and the report are built from the content; downloads need videos. */
export function effectiveHomeownerPermissions(p: HomeownerPermissions): HomeownerPermissions {
  const content = p.seeVideos && p.seeTranscripts && p.seeAiSummaries && p.seeScope;
  return {
    ...p,
    useChat: p.useChat && content,
    seeEvidenceReport: p.seeEvidenceReport && content,
    downloadFiles: p.downloadFiles && p.seeVideos,
  };
}

function dependencyNote(key: Key, p: HomeownerPermissions): string | null {
  if ((key === 'useChat' || key === 'seeEvidenceReport') && !(p.seeVideos && p.seeTranscripts && p.seeAiSummaries && p.seeScope)) {
    return 'Needs videos, transcripts, summaries, scope.';
  }
  if (key === 'downloadFiles' && !p.seeVideos) return 'Needs videos.';
  return null;
}

function Switch({ on, disabled, onChange, labelId, testId }: { on: boolean; disabled?: boolean; onChange: () => void; labelId: string; testId: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelId}
      data-testid={testId}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? 'bg-brand-600' : 'bg-paper-300 ring-1 ring-line'
      }`}
    >
      <span className="sr-only">{on ? 'On' : 'Off'}</span>
      <span
        aria-hidden="true"
        className={`inline-block h-4 w-4 rounded-full bg-paper-0 shadow transition ${on ? 'translate-x-6' : 'translate-x-1'}`}
      />
    </button>
  );
}

export function HomeownerPermissionsSettings({ jobId, onSaved }: { jobId: string; onSaved?: () => void }) {
  const [saved, setSaved] = useState<HomeownerPermissions | null>(null);
  const [draft, setDraft] = useState<HomeownerPermissions | null>(null);
  const [defaults, setDefaults] = useState<HomeownerPermissions | null>(null);
  const [savedDelay, setSavedDelay] = useState<ShareDelayHours>(0);
  const [delay, setDelay] = useState<ShareDelayHours>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Settings could not be loaded (older server, network). Show the defaults
  // read-only with a calm note and Retry instead of a red error.
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .homeownerPermissions(jobId)
      .then((res) => {
        if (!live) return;
        setUnavailable(false);
        setSaved(res.permissions);
        setDraft(res.permissions);
        setDefaults(res.defaults);
        setSavedDelay(res.shareDelayHours ?? 0);
        setDelay(res.shareDelayHours ?? 0);
      })
      .catch(() => {
        if (!live) return;
        setUnavailable(true);
        setSaved({ ...ALL_ON });
        setDraft({ ...ALL_ON });
        setSavedDelay(0);
        setDelay(0);
      });
    return () => {
      live = false;
    };
  }, [jobId, attempt]);

  const dirty = useMemo(
    () =>
      delay !== savedDelay ||
      Boolean(saved && draft && (Object.keys(saved) as Key[]).some((k) => saved[k] !== draft[k])),
    [saved, draft, delay, savedDelay],
  );

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.saveHomeownerPermissions(jobId, draft, delay);
      setSaved(res.permissions);
      setDraft(res.permissions);
      setSavedDelay(res.shareDelayHours ?? 0);
      setDelay(res.shareDelayHours ?? 0);
      setNotice('Saved. The homeowner sees it next time they open the job.');
      onSaved?.();
    } catch {
      setError('Could not save homeowner permissions.');
    } finally {
      setBusy(false);
    }
  }

  if (!draft) {
    return (
      <section data-testid="homeowner-permissions" className="px-6 pb-6 text-sm text-ink-600">
        Loading…
      </section>
    );
  }

  const effective = effectiveHomeownerPermissions(draft);
  const group = (g: 'see' | 'do') =>
    HOMEOWNER_PERMISSION_ROWS.filter((r) => r.group === g).map((row) => {
      const note = dependencyNote(row.key, draft);
      const labelId = `homeowner-perm-${row.key}`;
      return (
        <li key={row.key} className="flex items-center justify-between gap-4 py-1.5">
          <div className="min-w-0">
            <p id={labelId} className="text-sm font-medium text-ink-900">{row.label}</p>
            <p className="mt-0.5 truncate text-xs text-ink-500" title={note ?? row.help}>{note ?? row.help}</p>
          </div>
          <Switch
            on={effective[row.key]}
            disabled={busy || unavailable || Boolean(note)}
            labelId={labelId}
            testId={`homeowner-perm-switch-${row.key}`}
            onChange={() => setDraft((d) => (d ? { ...d, [row.key]: !d[row.key] } : d))}
          />
        </li>
      );
    });

  const labelOf = (k: Key) => HOMEOWNER_PERMISSION_ROWS.find((r) => r.key === k)?.label ?? k;
  const seeOn = HOMEOWNER_PERMISSION_ROWS.filter((r) => r.group === 'see' && effective[r.key]).map((r) => labelOf(r.key));
  const doOn = HOMEOWNER_PERMISSION_ROWS.filter((r) => r.group === 'do' && effective[r.key]).map((r) => labelOf(r.key));
  const delayLabel = delay === 0 ? 'None' : `${delay} hours`;

  return (
    <section
      data-testid="homeowner-permissions"
      aria-labelledby="homeowner-perms-heading"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-3">
        <h3 id="homeowner-perms-heading" className="sr-only">Homeowner permissions</h3>
        <p
          data-testid="homeowner-perms-summary"
          className="rounded-lg border border-line bg-paper-50 px-3 py-1.5 text-xs leading-5 text-ink-700"
        >
          <span className="font-semibold text-ink-900">Homeowner can see:</span> {seeOn.length ? seeOn.join(', ') : 'Nothing'}
          <span className="px-1.5 text-ink-400">·</span>
          <span className="font-semibold text-ink-900">Can do:</span> {doOn.length ? doOn.join(', ') : 'Nothing'}
          <span className="px-1.5 text-ink-400">·</span>
          <span className="font-semibold text-ink-900">Delay:</span> {delayLabel}
        </p>
        {unavailable ? (
          <div
            data-testid="homeowner-perms-unavailable"
            className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-line bg-paper-50 px-3 py-2 text-xs text-ink-600"
          >
            <span>Homeowner settings aren’t available right now. Showing the defaults: the homeowner sees everything below.</span>
            <button
              type="button"
              data-testid="homeowner-perms-retry"
              onClick={() => setAttempt((n) => n + 1)}
              className="h-8 shrink-0 rounded-lg px-3 text-xs font-semibold text-ink-900 ring-1 ring-line transition hover:bg-ink-900/5"
            >
              Retry
            </button>
          </div>
        ) : null}
        <div className="mt-2.5 grid gap-x-8 gap-y-3 md:grid-cols-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Can see</p>
            <ul className="divide-y divide-line">{group('see')}</ul>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Can do</p>
            <ul className="divide-y divide-line">{group('do')}</ul>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Sharing delay</p>
            <div className="flex items-start justify-between gap-4 py-2">
              <div className="min-w-0">
                <label htmlFor="homeowner-share-delay" className="text-sm font-medium text-ink-900">
                  Homeowner sharing delay
                </label>
                <p className="mt-0.5 text-xs text-ink-500">
                  How long after upload new videos reach them.
                </p>
              </div>
              <select
                id="homeowner-share-delay"
                data-testid="homeowner-share-delay"
                value={delay}
                disabled={busy || unavailable}
                onChange={(e) => setDelay(Number(e.target.value) as ShareDelayHours)}
                className="glass-field h-9 shrink-0 rounded-lg px-2 text-sm text-ink-900"
              >
                <option value={0}>None</option>
                <option value={24}>24 hours</option>
                <option value={48}>48 hours</option>
                <option value={72}>72 hours</option>
              </select>
            </div>
            <p className="mt-3 text-xs text-ink-500">
              Share or hold any single video from the Videos tab. Pay, disputes and internal notes are always hidden,
              and homeowners can never change the job.
            </p>
          </div>
        </div>
      </div>
      <div
        data-testid="homeowner-perms-footer"
        className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-6 py-2.5"
      >
        <button
          type="button"
          disabled={busy || unavailable || !defaults}
          onClick={() => {
            if (defaults) setDraft({ ...defaults });
            setDelay(0);
          }}
          className="h-9 rounded-lg px-3 text-sm font-medium text-ink-600 transition hover:bg-ink-900/5 hover:text-ink-900 disabled:opacity-50"
        >
          Reset to default
        </button>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          {error ? <p role="alert" className="text-sm text-danger-600">{error}</p> : null}
          {notice ? <p role="status" className="truncate text-sm text-success-700">{notice}</p> : null}
          <button
            type="button"
            data-testid="homeowner-perms-save"
            disabled={busy || unavailable || !dirty}
            onClick={() => void save()}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-ink-900 px-4 text-sm font-semibold text-paper-0 shadow-xs transition hover:bg-ink-800 disabled:opacity-60"
          >
            {busy ? <SpinnerIcon className="animate-spin" width={14} /> : null}
            Save
          </button>
        </div>
      </div>
    </section>
  );
}
