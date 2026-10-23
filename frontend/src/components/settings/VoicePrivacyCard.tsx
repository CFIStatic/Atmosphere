import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { TERMS_PUBLIC_URL } from '../../lib/terms';

export type VoicePrivacyState = {
  enabled: boolean;
  consentedAt: string | null;
  learned: boolean;
  crossCompanyOptIn: boolean;
};

const OFF: VoicePrivacyState = { enabled: false, consentedAt: null, learned: false, crossCompanyOptIn: false };

function Switch({
  id,
  checked,
  disabled,
  onChange,
  labelledBy,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  labelledBy: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-labelledby={labelledBy}
      data-testid={id}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-brand-600' : 'bg-paper-300 ring-1 ring-line'
      }`}
    >
      <span className="sr-only">{checked ? 'On' : 'Off'}</span>
      <span
        aria-hidden="true"
        className={`inline-block h-4 w-4 rounded-full bg-paper-0 shadow transition ${checked ? 'translate-x-6' : 'translate-x-1'}`}
      />
    </button>
  );
}

/**
 * Account privacy: voice recognition on/off and cross-company matching.
 * Voices are learned automatically from job clips for people who agreed to the
 * Terms of Service. Turning it off deletes the voiceprint.
 */
export function VoicePrivacyCard({ preview }: { preview?: VoicePrivacyState }) {
  const [state, setState] = useState<VoicePrivacyState>(preview ?? OFF);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preview) return;
    // Wrapped so a stubbed api (tests, demo) without this call stays quiet.
    void Promise.resolve()
      .then(() => api.getVoicePrivacy())
      .then((res) => {
        if (res?.voice) setState(res.voice);
      })
      .catch(() => undefined);
  }, [preview]);

  async function run(work: () => Promise<{ voice: VoicePrivacyState }>) {
    if (preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await work();
      setState(res.voice);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  function toggleRecognition() {
    if (state.enabled) {
      if (preview) return setState(OFF);
      void run(() => api.disableVoiceRecognition());
    } else {
      if (preview) return setState({ ...state, enabled: true, consentedAt: new Date().toISOString() });
      void run(() => api.enableVoiceRecognition());
    }
  }

  function toggleCrossCompany() {
    if (preview) return setState({ ...state, crossCompanyOptIn: !state.crossCompanyOptIn });
    void run(() => api.setVoiceCrossCompanyOptIn(!state.crossCompanyOptIn));
  }

  return (
    <section className="rounded-xl glass-card p-5 sm:p-6" data-testid="voice-privacy">
      <h2 className="text-base font-semibold text-ink-900">Privacy</h2>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id="voice-recognition-label" className="text-sm font-medium text-ink-900">
            Voice recognition
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            Label you by name on job clips. Turning this off deletes your voiceprint.{' '}
            <a
              href={`${TERMS_PUBLIC_URL}#voiceprints`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-ink-700"
            >
              Learn more
            </a>
          </p>
        </div>
        <Switch
          id="voice-recognition-switch"
          labelledBy="voice-recognition-label"
          checked={state.enabled}
          disabled={busy}
          onChange={toggleRecognition}
        />
      </div>
      <div className="mt-4 flex items-start justify-between gap-4 border-t border-line/70 pt-4">
        <div className="min-w-0">
          <p id="voice-cross-company-label" className="text-sm font-medium text-ink-900">
            Recognize me on other companies' jobs
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {state.enabled && !state.learned
              ? 'Available after your voice is learned from a job clip.'
              : 'Off unless you turn it on.'}
          </p>
        </div>
        <Switch
          id="voice-cross-company-switch"
          labelledBy="voice-cross-company-label"
          checked={state.crossCompanyOptIn}
          disabled={busy || !state.enabled || !state.learned}
          onChange={toggleCrossCompany}
        />
      </div>
      {error ? (
        <p className="mt-3 text-sm text-danger-700" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
