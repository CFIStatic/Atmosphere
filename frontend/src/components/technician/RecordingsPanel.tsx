import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import {
  downloadRecording,
  formatDuration,
  formatSize,
  type StoredRecording,
} from '../../lib/recordings';
import { DownloadIcon, MicIcon, SpinnerIcon, TrashIcon, VideoIcon } from '../icons';

interface Props {
  recordings: StoredRecording[] | null;
  transcriptionAvailable: boolean;
  onDelete: (id: string) => void;
  onNote: (id: string, note: string) => void;
}

function formatWhen(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function RecordingsPanel({ recordings, transcriptionAvailable, onDelete, onNote }: Props) {
  const [transcribing, setTranscribing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One object URL per recording, rebuilt only when the set changes. Playing
  // blobs straight out of IndexedDB needs a URL, and leaking them across a
  // long shift would pin every clip in memory.
  const urls = useMemo(() => {
    const map = new Map<string, string>();
    for (const recording of recordings ?? []) {
      map.set(recording.id, URL.createObjectURL(recording.blob));
    }
    return map;
  }, [recordings]);

  useEffect(() => {
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [urls]);

  async function handleTranscribe(recording: StoredRecording) {
    setTranscribing(recording.id);
    setError(null);
    try {
      const { text } = await api.transcribe(recording.blob);
      onNote(recording.id, text);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't transcribe that recording.");
    } finally {
      setTranscribing(null);
    }
  }

  if (recordings === null) {
    return (
      <div className="grid place-items-center rounded-xl glass-card py-16 text-brand-500 shadow-card">
        <SpinnerIcon className="animate-spin" width={22} height={22} />
        <span className="sr-only">Loading recordings…</span>
      </div>
    );
  }

  if (recordings.length === 0) {
    return (
      <div className="rounded-xl glass-card px-6 py-14 text-center shadow-card">
        <p className="text-sm font-medium text-ink-800">Nothing captured yet.</p>
        <p className="mt-1 text-xs text-ink-500">
          Recordings stay on this device until you download them.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-2.5 text-sm text-danger-700">
          {error}
        </p>
      )}

      {recordings.map((recording) => {
        const url = urls.get(recording.id);
        const isVideo = recording.kind === 'video';

        return (
          <article key={recording.id} className="rounded-xl glass-card p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  {isVideo ? <VideoIcon width={18} height={18} /> : <MicIcon width={18} height={18} />}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">
                    {isVideo ? 'Video' : 'Voice memo'}
                    <span className="ml-2 font-mono text-xs font-normal text-ink-500">
                      {formatDuration(recording.durationMs)}
                    </span>
                  </p>
                  <p className="truncate text-xs text-ink-500">
                    {formatWhen(recording.createdAt)} · {formatSize(recording.blob.size)}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => downloadRecording(recording)}
                  aria-label="Download recording"
                  className="rounded-lg p-2 text-ink-500 transition hover:bg-paper-100 hover:text-ink-900"
                >
                  <DownloadIcon width={18} height={18} />
                </button>
                <button
                  onClick={() => onDelete(recording.id)}
                  aria-label="Delete recording"
                  className="rounded-lg p-2 text-ink-500 transition hover:bg-danger-50 hover:text-danger-600"
                >
                  <TrashIcon width={18} height={18} />
                </button>
              </div>
            </div>

            {url &&
              (isVideo ? (
                <video src={url} controls playsInline className="mt-3 w-full rounded-lg bg-paper-100" />
              ) : (
                <audio src={url} controls className="mt-3 w-full" />
              ))}

            {recording.note ? (
              <p className="mt-3 rounded-lg border border-line bg-paper-50 px-3 py-2 text-sm leading-relaxed text-ink-700">
                {recording.note}
              </p>
            ) : (
              transcriptionAvailable &&
              !isVideo && (
                <button
                  onClick={() => void handleTranscribe(recording)}
                  disabled={transcribing === recording.id}
                  className="mt-3 flex items-center gap-2 rounded-lg glass-card px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-paper-100 disabled:opacity-60"
                >
                  {transcribing === recording.id && (
                    <SpinnerIcon className="animate-spin text-brand-500" width={14} height={14} />
                  )}
                  {transcribing === recording.id ? 'Transcribing…' : 'Transcribe'}
                </button>
              )
            )}
          </article>
        );
      })}
    </div>
  );
}
