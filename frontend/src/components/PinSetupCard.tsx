import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { PinPad } from './PinPad';
import { SpinnerIcon, CheckIcon } from '../components/icons';

type Stage = 'loading' | 'off' | 'on' | 'enter' | 'confirm' | 'saving';

/**
 * Lets a signed-in user turn a 4-digit PIN on or off for the device they are
 * currently using.
 *
 * Enrolling requires a live session by design: the PIN is a shortcut for a
 * device that has already proven itself with a password, never a credential
 * that can stand on its own.
 */
export function PinSetupCard() {
  const [stage, setStage] = useState<Stage>('loading');
  // Tracked separately from `stage` so cancelling a "Change PIN" returns to the
  // enrolled state instead of claiming the PIN was switched off.
  const [enrolled, setEnrolled] = useState(false);
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const shakeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    api
      .pinStatus()
      .then((s) => {
        if (cancelled) return;
        setEnrolled(s.enrolled);
        setStage(s.enrolled ? 'on' : 'off');
      })
      .catch(() => {
        if (!cancelled) setStage('off');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => window.clearTimeout(shakeTimer.current), []);

  function reject(message: string) {
    setError(message);
    setShake(true);
    window.clearTimeout(shakeTimer.current);
    shakeTimer.current = window.setTimeout(() => setShake(false), 450);
  }

  function beginSetup() {
    setFirst('');
    setSecond('');
    setError(null);
    setStage('enter');
  }

  function handleFirstComplete(value: string) {
    setFirst(value);
    setSecond('');
    setError(null);
    setStage('confirm');
  }

  async function handleConfirmComplete(value: string) {
    if (value !== first) {
      setSecond('');
      reject("Those PINs didn't match. Start again.");
      setFirst('');
      setStage('enter');
      return;
    }

    setStage('saving');
    setError(null);
    try {
      await api.pinEnroll(value);
      setEnrolled(true);
      setStage('on');
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 4000);
    } catch (err) {
      // The server rejects weak PINs (1234, 0000, sequences), so surface that
      // message verbatim rather than a generic failure.
      setSecond('');
      setFirst('');
      reject(err instanceof ApiError ? err.message : 'Could not save your PIN. Try again.');
      setStage('enter');
    }
  }

  async function handleDisable() {
    setStage('saving');
    setError(null);
    try {
      await api.pinDisable();
      setEnrolled(false);
      setStage('off');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not turn off PIN sign-in.');
      setStage('on');
    }
  }

  const busy = stage === 'saving';

  return (
    <div className="rounded-xl border border-line bg-paper-0 shadow-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Quick sign-in
          </p>
          <p className="mt-1.5 text-lg font-semibold text-ink-900">
            {stage === 'on' ? 'PIN is on for this device' : '4-digit PIN'}
          </p>
        </div>
        {stage === 'on' && (
          <span className="flex items-center gap-1 rounded-full border border-success-200 bg-success-50 px-2.5 py-1 text-xs font-medium text-success-600">
            <CheckIcon width={13} height={13} /> On
          </span>
        )}
      </div>

      {stage === 'loading' && (
        <div className="mt-4 flex items-center gap-2 text-sm text-ink-500">
          <SpinnerIcon className="animate-spin" width={16} height={16} /> Checking…
        </div>
      )}

      {stage === 'off' && (
        <>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            Skip typing your password on this device. Your PIN only works here — it can't be used
            to sign in from anywhere else.
          </p>
          {error && <p className="mt-3 text-sm text-danger-700">{error}</p>}
          <button
            onClick={beginSetup}
            className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-500"
          >
            Set up a PIN
          </button>
        </>
      )}

      {stage === 'on' && (
        <>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            {justSaved
              ? "Saved. You'll be asked for this PIN next time you sign in on this device."
              : 'You can sign in on this device with your PIN instead of your password.'}
          </p>
          {error && <p className="mt-3 text-sm text-danger-700">{error}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={beginSetup}
              className="rounded-lg border border-line bg-paper-0 px-4 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
            >
              Change PIN
            </button>
            <button
              onClick={handleDisable}
              className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-2 text-sm font-medium text-danger-700 transition hover:bg-danger-50"
            >
              Turn off
            </button>
          </div>
        </>
      )}

      {(stage === 'enter' || stage === 'confirm' || busy) && (
        <div className="mt-4">
          <p className="text-sm text-ink-700">
            {busy
              ? 'Saving your PIN…'
              : stage === 'enter'
                ? 'Choose a 4-digit PIN'
                : 'Enter it once more to confirm'}
          </p>

          {error && (
            <p role="alert" className="mt-2 text-sm text-danger-700">
              {error}
            </p>
          )}

          <div className="mt-5">
            <PinPad
              value={stage === 'confirm' ? second : first}
              onChange={stage === 'confirm' ? setSecond : setFirst}
              onComplete={stage === 'confirm' ? handleConfirmComplete : handleFirstComplete}
              disabled={busy}
              shake={shake}
              autoFocus
            />
          </div>

          {!busy && (
            <button
              onClick={() => {
                setFirst('');
                setSecond('');
                setError(null);
                setStage((s) => (s === 'confirm' ? 'enter' : enrolled ? 'on' : 'off'));
              }}
              className="mt-5 w-full rounded-lg border border-line bg-paper-0 px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-paper-100"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
