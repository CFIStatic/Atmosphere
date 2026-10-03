import { useEffect, useState } from 'react';
import { api, type AiAutoRecharge } from '../../lib/api';
import { formatCents } from '../../lib/money';

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

const STATUS_LABEL: Record<AiAutoRecharge['recent'][number]['status'], string> = {
  succeeded: 'Charged',
  failed: 'Failed',
  pending: 'Processing',
};

function packOf(settings: AiAutoRecharge, code: string) {
  return settings.packs.find((pack) => pack.code === code) ?? null;
}

/**
 * Auto-recharge: off by default. When an owner turns it on, the server buys
 * one credit pack with the saved card each time AI credits run out. Turning
 * it on asks for explicit agreement to automatic charges.
 */
export function AutoRechargeSection({
  initial,
  onError,
}: {
  /** Tests and stories pass settings; the page loads them. */
  initial?: AiAutoRecharge | null;
  onError?: (message: string | null) => void;
}) {
  const [settings, setSettings] = useState<AiAutoRecharge | null>(initial ?? null);
  const [confirming, setConfirming] = useState(false);
  const [packCode, setPackCode] = useState<string>(initial?.packCode ?? 'ai_10');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial !== undefined) return;
    let live = true;
    api
      .getAutoRecharge()
      .then((next) => {
        if (!live) return;
        setSettings(next);
        setPackCode(next.packCode);
      })
      .catch(() => {
        // Older servers have no auto-recharge; the manual flow still works.
      });
    return () => {
      live = false;
    };
  }, [initial]);

  if (!settings) return null;

  const configuredPacks = settings.packs.filter((pack) => pack.priceConfigured);
  const selected = packOf(settings, packCode) ?? configuredPacks[0] ?? settings.packs[0];
  const active = packOf(settings, settings.packCode) ?? selected;
  const amount = selected ? formatCents(selected.cents) : '';
  const activeAmount = active ? formatCents(active.cents) : '';
  const canToggle = settings.canManage && (settings.enabled || settings.available) && !busy;

  async function save(input: { enabled: boolean; packCode?: string; consent?: boolean }) {
    setBusy(true);
    setError(null);
    onError?.(null);
    try {
      const next = await api.updateAutoRecharge(input);
      setSettings(next);
      setPackCode(next.packCode);
      setConfirming(false);
      setAgreed(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update auto-recharge.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function onSwitch() {
    if (!canToggle) return;
    if (settings!.enabled) {
      void save({ enabled: false });
      return;
    }
    setError(null);
    setAgreed(false);
    setConfirming(true);
  }

  return (
    <section id="auto-recharge" className="rounded-xl glass-card p-5 sm:p-6" data-testid="auto-recharge">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink-900" id="auto-recharge-label">
            Auto-recharge
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">Automatically buy credits when your AI credits run out.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          aria-labelledby="auto-recharge-label"
          data-testid="auto-recharge-switch"
          disabled={!canToggle}
          onClick={onSwitch}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
            settings.enabled ? 'bg-brand-600' : 'bg-paper-300 ring-1 ring-line'
          }`}
        >
          <span className="sr-only">{settings.enabled ? 'On' : 'Off'}</span>
          <span
            aria-hidden="true"
            className={`inline-block h-5 w-5 rounded-full bg-paper-0 shadow transition ${
              settings.enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </header>

      {settings.notice ? (
        <div
          role="alert"
          data-testid="auto-recharge-notice"
          className="mt-4 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-sm text-danger-700"
        >
          <p className="font-semibold">Auto-recharge was turned off{settings.notice.at ? ` on ${day(settings.notice.at)}` : ''}.</p>
          <p className="mt-1">{settings.notice.message}</p>
        </div>
      ) : null}

      <p className="mt-4 text-sm font-medium text-ink-900" data-testid="auto-recharge-status">
        {settings.enabled
          ? `On. When your AI credits run out, we charge your saved card ${activeAmount} and add ${activeAmount} of credits.`
          : 'Off. When your AI credits run out, AI pauses until you buy credits manually.'}
      </p>

      <div
        data-testid="auto-recharge-warning"
        className={`mt-3 rounded-lg border px-3.5 py-3 text-xs ${
          settings.enabled ? 'border-caution-200 bg-caution-50 text-caution-600' : 'border-line bg-paper-50 text-ink-600'
        }`}
      >
        <p>
          <span className="font-semibold">Leaving auto-recharge on charges your saved card automatically:</span>{' '}
          {settings.enabled ? activeAmount : 'one credit pack'} each time your AI credits run out, up to{' '}
          {settings.maxPerDay} times in 24 hours.{' '}
          {settings.enabled
            ? 'Turn it off at any time to stop automatic charges and buy credits manually instead.'
            : 'While it is off, nothing is charged automatically.'}
        </p>
      </div>

      {settings.canManage && !settings.enabled && !settings.available ? (
        <p className="mt-3 text-xs text-ink-500">Auto-recharge is not available right now. Buy credits manually.</p>
      ) : null}
      {!settings.canManage ? (
        <p className="mt-3 text-xs text-ink-500">Only an owner can turn auto-recharge on or off.</p>
      ) : null}

      {confirming && !settings.enabled ? (
        <div className="mt-4 rounded-lg border border-line bg-paper-0 p-4" data-testid="auto-recharge-confirm">
          <h4 className="text-sm font-semibold text-ink-900">Pack to buy each time</h4>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Pack to buy each time">
            {settings.packs.map((pack) => (
              <button
                key={pack.code}
                type="button"
                role="radio"
                aria-checked={selected?.code === pack.code}
                disabled={!pack.priceConfigured || busy}
                data-testid={`auto-recharge-pack-${pack.code}`}
                onClick={() => setPackCode(pack.code)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition disabled:opacity-40 ${
                  selected?.code === pack.code
                    ? 'border-brand-500 bg-brand-50 text-ink-900 ring-1 ring-brand-300'
                    : 'border-line bg-paper-0 text-ink-700 hover:border-brand-300'
                }`}
              >
                {pack.label}
              </button>
            ))}
          </div>
          <label className="mt-4 flex items-start gap-2.5 text-sm text-ink-800">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={agreed}
              data-testid="auto-recharge-consent"
              onChange={(event) => setAgreed(event.target.checked)}
            />
            <span>
              I agree that Atmosphere will charge our saved card {amount} automatically each time our AI credits run
              out, until I turn auto-recharge off.
            </span>
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="auto-recharge-enable"
              disabled={!agreed || busy || !selected?.priceConfigured}
              onClick={() => void save({ enabled: true, packCode: selected?.code, consent: true })}
              className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? 'Turning on…' : `Turn on auto-recharge (${amount})`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setAgreed(false);
                setError(null);
              }}
              className="rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm font-medium text-ink-800 transition hover:border-brand-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger-600" data-testid="auto-recharge-error">
          {error}
        </p>
      ) : null}

      {settings.canManage && settings.recent.length > 0 ? (
        <div className="mt-5 border-t border-line pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Automatic purchases</h4>
          <ul className="mt-2 space-y-1.5 text-sm" data-testid="auto-recharge-history">
            {settings.recent.map((row) => (
              <li key={row.id} className="flex justify-between gap-3">
                <span className="text-ink-700">
                  {packOf(settings, row.packCode)?.label ?? row.packCode} pack
                  <span className="ml-2 text-xs text-ink-400">{day(row.at)}</span>
                </span>
                <span className={row.status === 'failed' ? 'text-danger-600' : 'text-ink-900'}>
                  {STATUS_LABEL[row.status]}
                  {row.status === 'succeeded' && row.amountCents ? ` ${formatCents(row.amountCents)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
