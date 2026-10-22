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

export const HOMEOWNER_PERMISSION_ROWS: Array<{ key: Key; label: string; help: string; group: 'see' | 'do' }> = [
  { key: 'seeVideos', label: 'Videos', help: 'The Videos tab, clips on the Timeline, and playback.', group: 'see' },
  { key: 'seeTranscripts', label: 'Transcripts', help: 'What was said on each video, word for word.', group: 'see' },
  { key: 'seeAiSummaries', label: 'AI summaries', help: 'AI descriptions of each video and day, and AI clip names.', group: 'see' },
  { key: 'seeScope', label: 'Job details & scope', help: 'The job brief and the scope lines (never prices).', group: 'see' },
  { key: 'seeEvidenceReport', label: 'Evidence report', help: 'The Evidence report tab and its PDF.', group: 'see' },
  { key: 'seeAccessList', label: 'Who has access', help: 'The Access tab listing everyone on this job file.', group: 'see' },
  { key: 'useChat', label: 'Chat', help: 'Ask questions about this job in Chat.', group: 'do' },
  { key: 'downloadFiles', label: 'Download videos', help: 'The Download button on each video.', group: 'do' },
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
    return 'Off while videos, transcripts, AI summaries or scope are hidden, because it is built from them.';
  }
  if (key === 'downloadFiles' && !p.seeVideos) return 'Off while videos are hidden.';
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

  useEffect(() => {
    let live = true;
    api
      .homeownerPermissions(jobId)
      .then((res) => {
        if (!live) return;
        setSaved(res.permissions);
        setDraft(res.permissions);
        setDefaults(res.defaults);
        setSavedDelay(res.shareDelayHours ?? 0);
        setDelay(res.shareDelayHours ?? 0);
      })
      .catch(() => live && setError('Could not load homeowner permissions.'));
    return () => {
      live = false;
    };
  }, [jobId]);

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
      setNotice('Saved. The homeowner sees the change the next time they open the job file.');
      onSaved?.();
    } catch {
      setError('Could not save homeowner permissions.');
    } finally {
      setBusy(false);
    }
  }

  if (!draft) {
    return (
      <section data-testid="homeowner-permissions" className="text-sm text-ink-600">
        {error ? <p role="alert" className="text-danger-600">{error}</p> : 'Loading…'}
      </section>
    );
  }

  const effective = effectiveHomeownerPermissions(draft);
  const group = (g: 'see' | 'do') =>
    HOMEOWNER_PERMISSION_ROWS.filter((r) => r.group === g).map((row) => {
      const note = dependencyNote(row.key, draft);
      const labelId = `homeowner-perm-${row.key}`;
      return (
        <li key={row.key} className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <p id={labelId} className="text-sm font-medium text-ink-900">{row.label}</p>
            <p className="mt-0.5 text-xs text-ink-500">{note ?? row.help}</p>
          </div>
          <Switch
            on={effective[row.key]}
            disabled={busy || Boolean(note)}
            labelId={labelId}
            testId={`homeowner-perm-switch-${row.key}`}
            onChange={() => setDraft((d) => (d ? { ...d, [row.key]: !d[row.key] } : d))}
          />
        </li>
      );
    });

  return (
    <section data-testid="homeowner-permissions" aria-labelledby="homeowner-perms-heading">
      <h3 id="homeowner-perms-heading" className="text-sm font-semibold text-ink-900">Homeowner permissions</h3>
      <p className="mt-1 text-xs text-ink-500">
        What the homeowner you invited can see and do on this job file. Pay, disputes and internal notes are always
        hidden from homeowners, and they can never change the job.
      </p>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Can see</p>
      <ul className="divide-y divide-line">{group('see')}</ul>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Can do</p>
      <ul className="divide-y divide-line">{group('do')}</ul>
      <div className="mt-3 flex items-start justify-between gap-4 border-t border-line pt-3">
        <div className="min-w-0">
          <label htmlFor="homeowner-share-delay" className="text-sm font-medium text-ink-900">
            Homeowner sharing delay
          </label>
          <p className="mt-0.5 text-xs text-ink-500">
            New videos, and their stills, transcripts and AI summaries, reach the homeowner this long after upload.
            Share or hold any video from the Videos tab. Chat and the Evidence report open for the homeowner once
            nothing is waiting.
          </p>
        </div>
        <select
          id="homeowner-share-delay"
          data-testid="homeowner-share-delay"
          value={delay}
          disabled={busy}
          onChange={(e) => setDelay(Number(e.target.value) as ShareDelayHours)}
          className="glass-field h-9 shrink-0 rounded-lg px-2 text-sm text-ink-900"
        >
          <option value={0}>None</option>
          <option value={24}>24 hours</option>
          <option value={48}>48 hours</option>
          <option value={72}>72 hours</option>
        </select>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-danger-600">{error}</p> : null}
      {notice ? <p role="status" className="mt-3 text-sm text-success-700">{notice}</p> : null}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={busy || !defaults}
          onClick={() => {
            if (defaults) setDraft({ ...defaults });
            setDelay(0);
          }}
          className="h-9 rounded-lg px-3 text-sm font-medium text-ink-600 transition hover:bg-ink-900/5 hover:text-ink-900 disabled:opacity-50"
        >
          Reset to default
        </button>
        <button
          type="button"
          data-testid="homeowner-perms-save"
          disabled={busy || !dirty}
          onClick={() => void save()}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink-900 px-4 text-sm font-semibold text-paper-0 shadow-xs transition hover:bg-ink-800 disabled:opacity-60"
        >
          {busy ? <SpinnerIcon className="animate-spin" width={14} /> : null}
          Save
        </button>
      </div>
    </section>
  );
}
