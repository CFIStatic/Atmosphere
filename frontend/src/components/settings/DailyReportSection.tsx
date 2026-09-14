import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { isGlobalAdmin } from '../../domain/productRoles';
import { api, type DailyReportSettings } from '../../lib/api';

const INPUT =
  'w-full rounded-lg glass-card px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 disabled:opacity-60';

export function DailyReportSection() {
  const { membership } = useAuth();
  const canEdit = isGlobalAdmin(membership?.role);

  const [settings, setSettings] = useState<DailyReportSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [timezone, setTimezone] = useState('America/New_York');
  const [sendHour, setSendHour] = useState(18);
  const [channel, setChannel] = useState<DailyReportSettings['channel']>('email');
  const [extraEmails, setExtraEmails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getDailyReportSettings();
        if (cancelled) return;
        setSettings(res.settings);
        setEnabled(res.settings.enabled);
        setTimezone(res.settings.timezone);
        setSendHour(res.settings.sendHour);
        setChannel(res.settings.channel);
        setExtraEmails(res.settings.extraEmails.join(', '));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load daily report settings.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const emails = extraEmails
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await api.updateDailyReportSettings({
        enabled,
        timezone,
        sendHour,
        channel,
        extraEmails: emails,
      });
      setSettings(res.settings);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass-card rounded-xl border p-5 sm:p-6" data-testid="daily-report-settings">
      <h2 className="text-base font-semibold text-ink-900">Auto daily job report</h2>
      <p className="mt-1 text-sm text-ink-600">
        At end of day we email the homeowner and project manager a Glance summary of that day’s
        clips. Off by default. Privacy-protected moments stay redacted.
      </p>

      <form className="mt-5 space-y-4" onSubmit={onSave}>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={enabled}
            disabled={!canEdit || busy || !settings}
            onChange={(e) => setEnabled(e.target.checked)}
            data-testid="daily-report-enabled"
          />
          <span className="text-sm text-ink-800">
            <span className="font-medium">Send end-of-day Glance reports</span>
            <span className="mt-0.5 block text-xs text-ink-500">
              Opt-in. Uses your org timezone and send hour.
            </span>
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink-700">Timezone</span>
          <input
            className={`${INPUT} mt-1.5`}
            value={timezone}
            disabled={!canEdit || busy}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="America/Chicago"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink-700">Send hour (local)</span>
          <input
            type="number"
            min={0}
            max={23}
            className={`${INPUT} mt-1.5`}
            value={sendHour}
            disabled={!canEdit || busy}
            onChange={(e) => setSendHour(Number(e.target.value))}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink-700">Channel</span>
          <select
            className={`${INPUT} mt-1.5`}
            value={channel}
            disabled={!canEdit || busy}
            onChange={(e) => setChannel(e.target.value as DailyReportSettings['channel'])}
          >
            <option value="email">Email (Resend)</option>
            <option value="sms">SMS (falls back to email until SMS is wired)</option>
            <option value="email_and_sms">Email + SMS (SMS skipped until wired)</option>
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink-700">Extra emails</span>
          <input
            className={`${INPUT} mt-1.5`}
            value={extraEmails}
            disabled={!canEdit || busy}
            onChange={(e) => setExtraEmails(e.target.value)}
            placeholder="ops@example.com, pm@example.com"
          />
          <span className="mt-1.5 block text-xs text-ink-500">
            Optional. Comma-separated, beyond homeowner + PM.
          </span>
        </label>

        {error ? (
          <p role="alert" className="text-sm text-danger-600">
            {error}
          </p>
        ) : null}
        {saved ? <p className="text-sm text-success-600">Saved</p> : null}

        {canEdit ? (
          <button
            type="submit"
            disabled={busy || !settings}
            className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-ink-900 shadow-card transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save daily report'}
          </button>
        ) : (
          <p className="text-xs text-ink-500">Only a Global Admin can change this.</p>
        )}
      </form>
    </section>
  );
}
