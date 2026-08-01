import { useCallback } from 'react';
import { useMediaStream } from '../../hooks/useMediaStream';
import { useMediaRecorder, recorderSupported } from '../../hooks/useMediaRecorder';
import { newRecordingId, formatDuration, type StoredRecording } from '../../lib/recordings';
import { MicIcon, PauseIcon, PlayIcon, StopIcon } from '../icons';

interface Props {
  onSaved: (recording: StoredRecording) => void;
}

/**
 * A plain voice-memo recorder.
 *
 * Separate from the assistant on purpose: a technician standing in a flooded
 * basement wants to narrate what they see without waiting on a round trip, and
 * a memo recorded here can be transcribed later from Recordings.
 */
export function AudioRecorderPanel({ onSaved }: Props) {
  const { stream, status: streamStatus, error: streamError, start: startStream, stop: stopStream } =
    useMediaStream({ audio: true });

  const handleComplete = useCallback(
    (clip: { blob: Blob; mimeType: string; durationMs: number }) => {
      // The mic is released as soon as the clip is flushed — no reason to hold
      // it open (and no reason to leave the browser's recording indicator on).
      stopStream();
      onSaved({
        id: newRecordingId(),
        kind: 'audio',
        blob: clip.blob,
        mimeType: clip.mimeType,
        durationMs: clip.durationMs,
        createdAt: Date.now(),
      });
    },
    [onSaved, stopStream],
  );

  const { state, elapsedMs, error: recorderError, start, stop, pause, resume } = useMediaRecorder({
    kind: 'audio',
    onComplete: handleComplete,
  });

  const busy = streamStatus === 'requesting';
  const recording = state !== 'idle';
  const error = recorderError ?? streamError;

  async function handleStart() {
    const next = stream ?? (await startStream());
    if (next) start(next);
  }

  if (!recorderSupported()) {
    return (
      <section className="rounded-xl glass-card p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink-900">Voice memo</h2>
        <p className="mt-2 text-sm text-ink-600">
          This browser can&apos;t record audio. Try Chrome, Edge, or Safari 15 and up.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl glass-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Voice memo</h2>
          <p className="mt-1 text-sm text-ink-600">
            Narrate what you&apos;re seeing. Saved to this device only.
          </p>
        </div>

        {recording && (
          <div className="flex shrink-0 items-center gap-2 rounded-full border border-danger-200 bg-danger-50 px-3 py-1">
            <span
              className={`h-2 w-2 rounded-full bg-danger-600 ${state === 'recording' ? 'animate-pulse' : ''}`}
              aria-hidden="true"
            />
            <span className="font-mono text-sm tabular-nums text-danger-700">
              {formatDuration(elapsedMs)}
            </span>
            <span className="sr-only">
              {state === 'recording' ? 'Recording in progress' : 'Recording paused'}
            </span>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {!recording ? (
          <button
            onClick={handleStart}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition hover:bg-brand-600 disabled:opacity-50"
          >
            <MicIcon width={18} height={18} />
            {busy ? 'Starting…' : 'Start recording'}
          </button>
        ) : (
          <>
            <button
              onClick={stop}
              className="flex items-center gap-2 rounded-lg bg-danger-600 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition hover:bg-danger-700"
            >
              <StopIcon width={18} height={18} />
              Stop &amp; save
            </button>
            <button
              onClick={state === 'recording' ? pause : resume}
              className="flex items-center gap-2 rounded-lg glass-card px-4 py-2.5 text-sm font-medium text-ink-700 transition hover:bg-paper-100"
            >
              {state === 'recording' ? (
                <>
                  <PauseIcon width={18} height={18} /> Pause
                </>
              ) : (
                <>
                  <PlayIcon width={18} height={18} /> Resume
                </>
              )}
            </button>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}
    </section>
  );
}
