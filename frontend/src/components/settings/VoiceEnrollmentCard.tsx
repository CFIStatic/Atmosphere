import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { VOICE_CONSENT_TEXT, fileToWavBase64 } from '../../lib/speakerIdentity';

export type VoiceEnrollmentState = {
  enrolled: boolean;
  consentedAt: string | null;
  crossCompanyOptIn: boolean;
};

export type PendingVoiceRequest = {
  id: string;
  requester_user_id: string;
  status: string;
};

type Props = {
  preview?: {
    state: VoiceEnrollmentState;
    pendingRequests?: PendingVoiceRequest[];
  };
};

export function VoiceEnrollmentCard({ preview }: Props) {
  const [state, setState] = useState<VoiceEnrollmentState>(
    preview?.state ?? { enrolled: false, consentedAt: null, crossCompanyOptIn: false },
  );
  const [pending, setPending] = useState<PendingVoiceRequest[]>(preview?.pendingRequests ?? []);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const acceptedRef = useRef(false);

  useEffect(() => {
    if (preview) return;
    const load = (api as { getVoiceEnrollment?: () => Promise<{ voiceprint: VoiceEnrollmentState; pendingRequests: PendingVoiceRequest[] }> }).getVoiceEnrollment;
    if (!load) return;
    void load()
      .then((res) => {
        setState(res.voiceprint);
        setPending(res.pendingRequests ?? []);
      })
      .catch(() => undefined);
  }, [preview]);

  async function enroll(blob: Blob, requestId?: string) {
    setBusy(true);
    setError(null);
    try {
      const wavBase64 = await fileToWavBase64(blob);
      if (requestId) {
        await api.confirmVoiceEnrollment(requestId, {
          consentText: VOICE_CONSENT_TEXT,
          consented: true,
          wavBase64,
          crossCompanyOptIn: state.crossCompanyOptIn,
        });
        setPending((rows) => rows.filter((row) => row.id !== requestId));
      } else {
        const saved = await api.enrollVoiceprint({
          consentText: VOICE_CONSENT_TEXT,
          consented: true,
          wavBase64,
          crossCompanyOptIn: state.crossCompanyOptIn,
        });
        setState(saved.voiceprint);
      }
      setState((current) => ({ ...current, enrolled: true, consentedAt: new Date().toISOString() }));
      acceptedRef.current = false;
      setAccepted(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that voice sample.');
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(file: File | undefined, requestId?: string) {
    if (!file || !accepted) return;
    await enroll(file, requestId);
  }

  function stopRecorder() {
    const media = recorder.current;
    if (media && media.state !== 'inactive') media.stop();
    setRecording(false);
  }

  function setConsent(next: boolean) {
    acceptedRef.current = next;
    setAccepted(next);
    if (!next && recorder.current && recorder.current.state !== 'inactive') stopRecorder();
  }

  async function toggleRecord(requestId?: string) {
    if (recording) {
      stopRecorder();
      return;
    }
    if (!acceptedRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const media = new MediaRecorder(stream);
    chunks.current = [];
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.current.push(event.data);
    };
    media.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      recorder.current = null;
      if (!acceptedRef.current) return;
      const blob = new Blob(chunks.current, { type: media.mimeType || 'audio/webm' });
      void enroll(blob, requestId);
    };
    recorder.current = media;
    media.start();
    setRecording(true);
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      if (!preview) await api.revokeVoiceprint();
      setState({ enrolled: false, consentedAt: null, crossCompanyOptIn: false });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the voiceprint.');
    } finally {
      setBusy(false);
    }
  }

  async function setOptIn(next: boolean) {
    setState((current) => ({ ...current, crossCompanyOptIn: next }));
    if (preview || !state.enrolled) return;
    try {
      await api.setVoiceCrossCompanyOptIn(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that setting.');
    }
  }

  return (
    <section className="rounded-xl glass-card p-5 sm:p-6" data-testid="voice-enrollment-card">
      <h2 className="text-base font-semibold text-ink-900">Voice enrollment</h2>
      <p className="mt-1 text-sm text-ink-600">
        A short sample lets Atmosphere recognize your voice on this company&apos;s clips. The recording is not kept — only the voiceprint, this consent, and the time you gave it.
      </p>
      <p className="mt-4 rounded-lg bg-paper-100 px-3 py-3 text-sm leading-relaxed text-ink-800" data-testid="voice-consent-text">
        {VOICE_CONSENT_TEXT}
      </p>
      <label className="mt-3 flex items-start gap-2 text-sm text-ink-800">
        <input
          type="checkbox"
          className="mt-1"
          checked={accepted}
          onChange={(event) => setConsent(event.target.checked)}
          data-testid="voice-consent-check"
        />
        I agree to this voiceprint consent.
      </label>
      <label className="mt-3 flex items-start gap-2 text-sm text-ink-800">
        <input
          type="checkbox"
          className="mt-1"
          checked={state.crossCompanyOptIn}
          onChange={(event) => void setOptIn(event.target.checked)}
          data-testid="voice-cross-company"
        />
        Allow other companies to match my voice. Off unless you turn this on.
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || (!accepted && !recording)}
          onClick={() => void toggleRecord()}
          className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-ink-900 disabled:opacity-50"
          data-testid="voice-record"
        >
          {recording ? 'Stop and save' : 'Record sample'}
        </button>
        <label className={`rounded-lg border border-line px-3.5 py-2 text-sm font-semibold ${accepted && !busy ? 'text-ink-800' : 'text-ink-400'}`}>
          Upload sample
          <input
            type="file"
            accept="audio/*,.wav"
            className="sr-only"
            disabled={!accepted || busy}
            data-testid="voice-upload"
            onChange={(event) => void onUpload(event.target.files?.[0])}
          />
        </label>
        {state.enrolled ? (
          <button
            type="button"
            onClick={() => void revoke()}
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-ink-800"
            data-testid="voice-revoke"
          >
            Revoke and delete voiceprint
          </button>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-ink-500" data-testid="voice-enrollment-status">
        {state.enrolled
          ? `Enrolled ${state.consentedAt ? new Date(state.consentedAt).toLocaleString() : ''}. Revoking deletes the voiceprint.`
          : 'Not enrolled.'}
      </p>
      {pending.map((request) => (
        <div key={request.id} className="mt-4 rounded-lg border border-line px-3 py-3" data-testid="voice-coworker-request">
          <p className="text-sm text-ink-800">A teammate asked you to enroll your voice. Confirm it here — they cannot finish this for you.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || (!accepted && !recording)}
              onClick={() => void toggleRecord(request.id)}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-ink-900 disabled:opacity-50"
            >
              Confirm with a recording
            </button>
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-700"
              onClick={() => {
                if (preview) {
                  setPending((rows) => rows.filter((row) => row.id !== request.id));
                  return;
                }
                void api.declineVoiceEnrollment(request.id).then(() => setPending((rows) => rows.filter((row) => row.id !== request.id)));
              }}
            >
              Decline
            </button>
          </div>
        </div>
      ))}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </section>
  );
}
