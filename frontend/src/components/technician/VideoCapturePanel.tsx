import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaStream } from '../../hooks/useMediaStream';
import { useMediaRecorder, recorderSupported } from '../../hooks/useMediaRecorder';
import { useObjectDetection, type Detection } from '../../hooks/useObjectDetection';
import { newRecordingId, formatDuration, type StoredRecording } from '../../lib/recordings';
import { PauseIcon, PlayIcon, ScanIcon, SpinnerIcon, StopIcon, VideoIcon } from '../icons';
import { api, type LiveStageObservation } from '../../lib/api';

interface Props {
  onSaved: (recording: StoredRecording) => void;
  /** Lifts the current labels so the assistant can answer "what am I looking at". */
  onDetections: (labels: string[]) => void;
  /**
   * When set, the model watches the recording live: a frame is sampled every
   * few seconds and answered with which stage of the shot list is on screen.
   */
  liveContext?: { jobId: string; phase: 'before' | 'after' } | null;
}

/**
 * Box colours, cycled per class so two objects never blur together. Picked to
 * read against camera footage rather than against the page.
 */
const BOX_COLORS = ['#D2500A', '#2F7D5B', '#1F6FB2', '#7C3E8E', '#B4361D', '#946A0B'];

function colorFor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return BOX_COLORS[hash % BOX_COLORS.length];
}

/** Distinct labels, most confident first — what the assistant gets told about. */
function summarize(detections: Detection[]): string[] {
  const best = new Map<string, number>();
  for (const d of detections) {
    if ((best.get(d.label) ?? 0) < d.score) best.set(d.label, d.score);
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
}

export function VideoCapturePanel({ onSaved, onDetections, liveContext }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [detecting, setDetecting] = useState(false);

  // The rear camera is the one pointed at the damage; `facingMode` is a hint,
  // so a laptop with only a front camera still gets a stream.
  const { stream, status: streamStatus, error: streamError, start: startStream, stop: stopStream } =
    useMediaStream({ video: { facingMode: 'environment' }, audio: true });

  const detector = useObjectDetection(videoRef, detecting && Boolean(stream));

  const observationsRef = useRef<Array<{ stageLabel: string; note: string }>>([]);

  const handleComplete = useCallback(
    (clip: { blob: Blob; mimeType: string; durationMs: number }) => {
      // The live log becomes the recording's name-and-note, so the clip in
      // the Recordings list carries its own narration instead of "video".
      const log = observationsRef.current;
      onSaved({
        id: newRecordingId(),
        kind: 'video',
        blob: clip.blob,
        mimeType: clip.mimeType,
        durationMs: clip.durationMs,
        createdAt: Date.now(),
        note: log.length
          ? log.map((o) => `${o.stageLabel}: ${o.note}`).join(' · ').slice(0, 500)
          : undefined,
      });
    },
    [onSaved],
  );

  const recorder = useMediaRecorder({ kind: 'video', onComplete: handleComplete });

  // Bind the stream to the <video> element. `srcObject` can't be set as a prop.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
  }, [stream]);

  // Report labels upward. Joined into a key so an unchanged set of objects
  // doesn't fire the callback on every one of the detector's ~7 ticks/second.
  const labels = summarize(detector.detections);
  const labelKey = labels.join('|');
  useEffect(() => {
    onDetections(labelKey ? labelKey.split('|') : []);
  }, [labelKey, onDetections]);

  // Draw the boxes. The canvas is sized in the video's own pixel space, so
  // bounding boxes need no scaling — CSS stretches both together.
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const { videoWidth, videoHeight } = video;
    if (!videoWidth || !videoHeight) return;
    if (canvas.width !== videoWidth) canvas.width = videoWidth;
    if (canvas.height !== videoHeight) canvas.height = videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Scale the chrome with the frame so boxes look the same on a 480p webcam
    // and a 1080p phone camera.
    const scale = Math.max(1, videoWidth / 640);
    ctx.lineWidth = 2 * scale;
    ctx.font = `600 ${13 * scale}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'top';

    for (const { label, score, bbox } of detector.detections) {
      const [x, y, width, height] = bbox;
      const color = colorFor(label);

      ctx.strokeStyle = color;
      ctx.strokeRect(x, y, width, height);

      const text = `${label} ${Math.round(score * 100)}%`;
      const padding = 5 * scale;
      const textWidth = ctx.measureText(text).width;
      const boxHeight = 19 * scale;
      // Flip the caption inside the box when the detection touches the top edge.
      const captionY = y > boxHeight ? y - boxHeight : y;

      ctx.fillStyle = color;
      ctx.fillRect(x, captionY, textWidth + padding * 2, boxHeight);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(text, x + padding, captionY + 3 * scale);
    }
  }, [detector.detections]);

  const live = Boolean(stream);
  const recording = recorder.state !== 'idle';

  /* ---- Live stage monitoring ------------------------------------------- *
   * While recording with a job selected, a downscaled frame goes to the
   * model every eight seconds and comes back as "you are on step N". The
   * cadence is a cost decision as much as a UX one: a walkthrough changes
   * stage every half minute, not every second. Failures drop the sample and
   * say so once — a dead network must never interrupt a recording.
   */
  const [observations, setObservations] = useState<Array<LiveStageObservation & { at: number }>>([]);
  const [liveState, setLiveState] = useState<'off' | 'watching' | 'unavailable'>('off');
  const lastStageRef = useRef<number | null>(null);

  useEffect(() => {
    if (!recording || !liveContext) {
      setLiveState('off');
      if (!recording) {
        setObservations([]);
        lastStageRef.current = null;
      }
      return;
    }
    setLiveState('watching');
    let cancelled = false;

    const sample = async () => {
      const video = videoRef.current;
      if (!video || !video.videoWidth || cancelled) return;
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 640 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frameBase64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
      if (!frameBase64) return;
      try {
        const observation = await api.liveObserve(liveContext.jobId, {
          phase: liveContext.phase,
          frameBase64,
          lastStageIndex: lastStageRef.current,
        });
        if (cancelled) return;
        lastStageRef.current = observation.stageIndex;
        setObservations((prev) => [...prev.slice(-5), { ...observation, at: Date.now() }]);
      } catch {
        // One quiet downgrade, not an error per tick: the recording is the
        // job; the commentary is a bonus.
        if (!cancelled) setLiveState('unavailable');
      }
    };

    void sample();
    const timer = setInterval(() => void sample(), 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [recording, liveContext]);

  // handleComplete fires from the recorder's callback, outside React's render
  // — the ref is how it sees the log the state was holding.
  useEffect(() => {
    observationsRef.current = observations;
  }, [observations]);

  function handleStopCamera() {
    if (recording) recorder.stop();
    setDetecting(false);
    stopStream();
  }

  function handleRecord() {
    if (recording) recorder.stop();
    else if (stream) recorder.start(stream);
  }

  const problem = streamError ?? recorder.error ?? detector.error;

  return (
    <section className="overflow-hidden rounded-xl glass-card">
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Camera</h2>
          <p className="mt-1 text-sm text-ink-600">
            Record the walkthrough. Detection runs on this device — no frames are uploaded.
          </p>
        </div>

        {recording && liveState === 'watching' && observations.length > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-600" aria-hidden="true" />
            {observations[observations.length - 1].stageLabel}
          </span>
        )}
        {recording && (
          <div className="flex shrink-0 items-center gap-2 rounded-full border border-danger-200 bg-danger-50 px-3 py-1">
            <span
              className={`h-2 w-2 rounded-full bg-danger-600 ${recorder.state === 'recording' ? 'animate-pulse' : ''}`}
              aria-hidden="true"
            />
            <span className="font-mono text-sm tabular-nums text-danger-700">
              {formatDuration(recorder.elapsedMs)}
            </span>
          </div>
        )}
      </header>

      {(observations.length > 0 || liveState === 'unavailable') && (
        <div className="border-b border-line px-5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Live monitoring
          </p>
          {liveState === 'unavailable' ? (
            <p className="mt-1 text-xs text-ink-500">
              Unavailable right now — the recording is unaffected, and the filed video still gets
              its narrated report.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {observations
                .slice(-4)
                .reverse()
                .map((o) => (
                  <li key={o.at} className="flex gap-2 text-xs">
                    <span
                      className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        o.stageIndex >= 0 ? 'bg-brand-600' : 'bg-ink-400'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="font-medium text-ink-800">{o.stageLabel}</span>
                      <span className="text-ink-500"> — {o.note}</span>
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {/* The stage stays dark: footage reads better against it than against
          paper, and it makes the boxes legible in daylight. */}
      <div className="relative aspect-video w-full overflow-hidden bg-paper-100">
        <video ref={videoRef} className="h-full w-full object-contain" muted playsInline autoPlay />
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          aria-hidden="true"
        />

        {!live && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
            <div>
              <VideoIcon className="mx-auto text-ink-500" width={36} height={36} />
              <p className="mt-3 text-sm text-ink-400">
                {streamStatus === 'requesting' ? 'Waiting for camera access…' : 'Camera is off.'}
              </p>
            </div>
          </div>
        )}

        {detector.status === 'loading' && (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg bg-paper-0/95 px-3 py-1.5 text-xs font-medium text-ink-700 shadow-card">
            <SpinnerIcon className="animate-spin text-brand-500" width={14} height={14} />
            Loading detection model…
          </div>
        )}
      </div>

      {/* What the detector currently sees, in words — readable at arm's length
          in daylight, unlike the labels drawn on the frame. */}
      {detector.status === 'running' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-paper-50 px-5 py-3">
          {labels.length === 0 ? (
            <span className="text-xs text-ink-500">Nothing recognised yet — pan across the area.</span>
          ) : (
            labels.map((label) => (
              <span
                key={label}
                className="rounded-full border px-2.5 py-1 text-xs font-semibold capitalize"
                style={{
                  borderColor: `${colorFor(label)}40`,
                  backgroundColor: `${colorFor(label)}12`,
                  color: colorFor(label),
                }}
              >
                {label}
              </span>
            ))
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line px-5 py-4">
        {!live ? (
          <button
            onClick={() => void startStream()}
            disabled={streamStatus === 'requesting'}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition hover:bg-brand-600 disabled:opacity-50"
          >
            <VideoIcon width={18} height={18} />
            {streamStatus === 'requesting' ? 'Starting…' : 'Start camera'}
          </button>
        ) : (
          <>
            {recorderSupported() && (
              <button
                onClick={handleRecord}
                className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-ink-900 shadow-card transition ${
                  recording ? 'bg-danger-600 hover:bg-danger-700' : 'bg-brand-500 hover:bg-brand-600'
                }`}
              >
                {recording ? (
                  <>
                    <StopIcon width={18} height={18} /> Stop &amp; save
                  </>
                ) : (
                  <>
                    <VideoIcon width={18} height={18} /> Record
                  </>
                )}
              </button>
            )}

            {recording && (
              <button
                onClick={recorder.state === 'recording' ? recorder.pause : recorder.resume}
                className="flex items-center gap-2 rounded-lg glass-card px-4 py-2.5 text-sm font-medium text-ink-700 transition hover:bg-paper-100"
              >
                {recorder.state === 'recording' ? (
                  <>
                    <PauseIcon width={18} height={18} /> Pause
                  </>
                ) : (
                  <>
                    <PlayIcon width={18} height={18} /> Resume
                  </>
                )}
              </button>
            )}

            <button
              onClick={() => setDetecting((prev) => !prev)}
              aria-pressed={detecting}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition ${
                detecting
                  ? 'border-brand-200 bg-brand-50 text-brand-700'
                  : 'glass-card text-ink-700 hover:bg-paper-100'
              }`}
            >
              <ScanIcon width={18} height={18} />
              {detecting ? 'Detection on' : 'Detect objects'}
            </button>

            <button
              onClick={handleStopCamera}
              className="rounded-lg glass-card px-4 py-2.5 text-sm font-medium text-ink-600 transition hover:bg-paper-100"
            >
              Turn off
            </button>
          </>
        )}
      </div>

      {problem && (
        <p role="alert" className="border-t border-danger-200 bg-danger-50 px-5 py-2.5 text-sm text-danger-700">
          {problem}
        </p>
      )}
    </section>
  );
}
