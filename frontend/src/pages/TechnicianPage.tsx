import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ROLE_LABELS, type AssistantContext, type TechnicianCapabilities } from '../lib/api';
import {
  deleteRecording,
  listRecordings,
  saveRecording,
  type StoredRecording,
} from '../lib/recordings';
import { Logo } from '../components/Logo';
import { AudioRecorderPanel } from '../components/technician/AudioRecorderPanel';
import { VoiceAssistantPanel } from '../components/technician/VoiceAssistantPanel';
import { VideoCapturePanel } from '../components/technician/VideoCapturePanel';
import { RecordingsPanel } from '../components/technician/RecordingsPanel';
import { GaugeIcon, ScanIcon, SparkIcon, VideoIcon } from '../components/icons';
import { CaptureGuidePanel } from '../components/field/CaptureGuidePanel';

type View = 'capture' | 'recordings' | 'assistant';

/**
 * Object labels go stale fast — a technician who scanned a bathroom ten minutes
 * ago is somewhere else now, and telling the assistant otherwise is worse than
 * telling it nothing.
 */
const DETECTION_FRESHNESS_MS = 2 * 60 * 1000;

/**
 * The field technician app.
 *
 * Laid out as a workspace rather than a page: navigation on the left, the work
 * in the middle, and the assistant pinned to the right where it can see what
 * you're doing. On a phone the rails collapse and the three become tabs — which
 * is the form most technicians will actually use it in.
 *
 * Capture and object detection run entirely in the browser. The server is only
 * involved in the assistant's replies and, where the browser can't dictate,
 * transcription.
 */
export function TechnicianPage() {
  const { user, membership, logout } = useAuth();
  const [view, setView] = useState<View>('capture');
  const [capabilities, setCapabilities] = useState<TechnicianCapabilities | null>(null);
  const [recordings, setRecordings] = useState<StoredRecording[] | null>(null);
  const [detected, setDetected] = useState<{ labels: string[]; at: number }>({ labels: [], at: 0 });

  // What the deployment supports. On failure assume the leanest configuration
  // rather than offering buttons that 501.
  useEffect(() => {
    let cancelled = false;
    api
      .technicianCapabilities()
      .then((next) => {
        if (!cancelled) setCapabilities(next);
      })
      .catch(() => {
        if (!cancelled) {
          setCapabilities({ assistant: false, transcription: false, maxAudioUploadBytes: 0 });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listRecordings().then((stored) => {
      if (!cancelled) setRecordings(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaved = useCallback((recording: StoredRecording) => {
    setRecordings((prev) => [recording, ...(prev ?? [])]);
    void saveRecording(recording);
  }, []);

  const handleDelete = useCallback((id: string) => {
    setRecordings((prev) => (prev ?? []).filter((recording) => recording.id !== id));
    void deleteRecording(id);
  }, []);

  const handleNote = useCallback((id: string, note: string) => {
    setRecordings((prev) => {
      const next = (prev ?? []).map((recording) =>
        recording.id === id ? { ...recording, note } : recording,
      );
      const updated = next.find((recording) => recording.id === id);
      if (updated) void saveRecording(updated);
      return next;
    });
  }, []);

  // The camera panel fires this on every change to the detected set; a ref
  // comparison keeps an identical set from re-rendering the whole page.
  const detectedRef = useRef(detected);
  detectedRef.current = detected;
  const handleDetections = useCallback((labels: string[]) => {
    if (labels.join('|') === detectedRef.current.labels.join('|')) return;
    setDetected({ labels, at: Date.now() });
  }, []);

  const freshLabels =
    detected.labels.length > 0 && Date.now() - detected.at < DETECTION_FRESHNESS_MS
      ? detected.labels
      : [];

  const assistantContext = useMemo<AssistantContext>(
    () => ({
      role: membership?.role,
      workType: membership?.workType,
      orgName: membership?.org?.name,
      detectedObjects: freshLabels.length > 0 ? freshLabels : undefined,
    }),
    // `freshLabels` is derived from `detected`; depending on the source avoids
    // rebuilding the context object on every render.
    [membership, detected], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const recordingCount = recordings?.length ?? 0;
  const contextLabel = freshLabels.length > 0 ? freshLabels.slice(0, 3).join(', ') : 'This job';

  const nav: { id: View; label: string; Icon: typeof VideoIcon; badge?: number }[] = [
    { id: 'capture', label: 'Capture', Icon: VideoIcon },
    { id: 'recordings', label: 'Recordings', Icon: ScanIcon, badge: recordingCount },
  ];

  const initials = (user?.email ?? '?').slice(0, 2).toUpperCase();

  const assistant = (
    <VoiceAssistantPanel
      context={assistantContext}
      contextLabel={contextLabel}
      assistantAvailable={capabilities?.assistant ?? false}
      transcriptionAvailable={capabilities?.transcription ?? false}
    />
  );

  return (
    <div className="flex h-screen overflow-hidden bg-paper-100">
      {/* ---- Left rail ---- */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-paper-200/70 lg:flex">
        <div className="px-5 py-4">
          <Logo />
        </div>

        <nav className="flex-1 px-3">
          <p className="px-2 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Field
          </p>
          {nav.map(({ id, label, Icon, badge }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              aria-current={view === id ? 'page' : undefined}
              className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ${
                view === id
                  ? 'bg-brand-100 text-brand-800'
                  : 'text-ink-600 hover:bg-paper-300/60 hover:text-ink-900'
              }`}
            >
              <Icon width={17} height={17} />
              <span className="flex-1 text-left">{label}</span>
              {badge ? (
                <span className="rounded-full bg-paper-200/50 px-1.5 py-0.5 text-[11px] font-semibold text-ink-500">
                  {badge}
                </span>
              ) : null}
            </button>
          ))}

          <p className="px-2 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Operate
          </p>
          <Link
            to="/field"
            className="mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-ink-600 transition hover:bg-paper-300/60 hover:text-ink-900"
          >
            <GaugeIcon width={17} height={17} />
            Overview
          </Link>
        </nav>

        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2.5 px-1.5 py-1">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-ink-800">{user?.email}</p>
              <p className="truncate text-[11px] text-ink-500">
                {membership ? ROLE_LABELS[membership.role] : 'Field'}
              </p>
            </div>
          </div>
          <button
            onClick={() => void logout()}
            className="mt-2 w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-ink-500 transition hover:bg-paper-300/60 hover:text-ink-900"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* ---- Main column ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-paper-50 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="lg:hidden">
              <Logo compact />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-ink-900">
                {view === 'assistant' ? 'Assistant' : view === 'recordings' ? 'Recordings' : 'Capture'}
              </h1>
              <p className="truncate text-xs text-ink-500">
                {membership?.org?.name ?? 'Your organization'}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`hidden rounded-full border px-2.5 py-1 text-xs font-medium sm:inline ${
                capabilities?.assistant
                  ? 'border-brand-200 bg-brand-50 text-brand-700'
                  : 'glass-card text-ink-500'
              }`}
            >
              {capabilities === null
                ? 'Checking…'
                : capabilities.assistant
                  ? 'Assistant ready'
                  : 'On-device only'}
            </span>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 lg:hidden">
              {initials}
            </span>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main
            className={`cx-scroll min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 ${
              view === 'assistant' ? 'hidden xl:block' : ''
            }`}
          >
            <div className="mx-auto max-w-2xl space-y-4">
              {/* Panels are unmounted when hidden, which is what releases the
                  camera and mic — a hidden-but-mounted preview would keep the
                  hardware (and the browser's recording indicator) live. */}
              {view !== 'recordings' && (
                <>
                  <CaptureGuidePanel />
                  <VideoCapturePanel onSaved={handleSaved} onDetections={handleDetections} />
                  <AudioRecorderPanel onSaved={handleSaved} />
                </>
              )}

              {view === 'recordings' && (
                <RecordingsPanel
                  recordings={recordings}
                  transcriptionAvailable={capabilities?.transcription ?? false}
                  onDelete={handleDelete}
                  onNote={handleNote}
                />
              )}
            </div>
          </main>

          {/* The assistant is a permanent rail on a wide screen and a tab on a
              phone — same component either way. */}
          <aside
            className={`w-full shrink-0 border-l border-line xl:flex xl:w-[360px] ${
              view === 'assistant' ? 'flex' : 'hidden'
            }`}
          >
            {assistant}
          </aside>
        </div>

        {/* ---- Mobile tabs ---- */}
        <nav className="flex shrink-0 border-t border-line bg-paper-50 lg:hidden">
          {[...nav, { id: 'assistant' as View, label: 'Assistant', Icon: SparkIcon, badge: 0 }].map(
            ({ id, label, Icon, badge }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                aria-current={view === id ? 'page' : undefined}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${
                  view === id ? 'text-brand-600' : 'text-ink-500'
                }`}
              >
                <span className="relative">
                  <Icon width={19} height={19} />
                  {badge ? (
                    <span className="absolute -right-2 -top-1 rounded-full bg-brand-500 px-1 text-[9px] font-bold text-white">
                      {badge}
                    </span>
                  ) : null}
                </span>
                {label}
              </button>
            ),
          )}
        </nav>
      </div>
    </div>
  );
}
