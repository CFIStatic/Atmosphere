import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'recording' | 'paused';

export interface CapturedClip {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

/**
 * Codec preference, most wanted first.
 *
 * Chrome and Firefox give us WebM/Opus and WebM/VP9; Safari only ever offers
 * MP4/AAC and MP4/H.264. Probing in order and falling back to the browser's
 * own default is what makes the recorder work on an iPhone at all.
 */
const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
// Prefer containers that mux video + Opus/AAC so Field / proof day film
// always keeps the microphone track (office playback + future transcription).
const VIDEO_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

function pickMimeType(kind: 'audio' | 'video'): string | undefined {
  const candidates = kind === 'audio' ? AUDIO_TYPES : VIDEO_TYPES;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export function recorderSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined';
}

interface Options {
  kind: 'audio' | 'video';
  /** Fires once per completed recording, after `stop()` flushes the last chunk. */
  onComplete?: (clip: CapturedClip) => void;
}

interface UseMediaRecorder {
  state: RecorderState;
  /** Milliseconds of recorded material, excluding time spent paused. */
  elapsedMs: number;
  error: string | null;
  start: (stream: MediaStream) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
}

/**
 * Records whatever stream it is handed.
 *
 * Kept separate from `useMediaStream` on purpose: the video tab keeps a live
 * preview running (and the object detector reading from it) whether or not a
 * recording is in progress, so stream lifetime and recording lifetime are
 * genuinely different things.
 */
export function useMediaRecorder({ kind, onComplete }: Options): UseMediaRecorder {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);

  // Duration is accumulated rather than measured end-to-end so that pausing
  // doesn't inflate the clip length shown next to the recording.
  const accumulatedRef = useRef(0);
  const segmentStartRef = useRef(0);

  // Held in a ref so the `stop` handler always calls the current callback
  // without the recorder needing to be torn down when it changes.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const clearTick = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const startTick = useCallback(() => {
    clearTick();
    tickRef.current = window.setInterval(() => {
      setElapsedMs(accumulatedRef.current + (Date.now() - segmentStartRef.current));
    }, 200);
  }, [clearTick]);

  const start = useCallback(
    (stream: MediaStream) => {
      if (recorderRef.current) return;

      if (!recorderSupported()) {
        setError("This browser can't record media. Try Chrome, Edge, or Safari 15 and up.");
        return;
      }

      // Day film is audiovisual: camera + microphone in one container.
      if (kind === 'video' && stream.getAudioTracks().length === 0) {
        setError(
          'Microphone is required for Field Capture video. Enable mic permission and try again.',
        );
        return;
      }

      const mimeType = pickMimeType(kind);
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      } catch {
        setError("Couldn't start the recorder with this device's audio format.");
        return;
      }

      chunksRef.current = [];
      accumulatedRef.current = 0;
      segmentStartRef.current = Date.now();
      setElapsedMs(0);
      setError(null);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        setError('The recording stopped unexpectedly.');
      };

      recorder.onstop = () => {
        clearTick();
        const chunks = chunksRef.current;
        chunksRef.current = [];
        recorderRef.current = null;
        setState('idle');

        if (chunks.length === 0) return;
        // `recorder.mimeType` is authoritative — the browser may have chosen
        // something other than what we asked for.
        const type = recorder.mimeType || mimeType || (kind === 'audio' ? 'audio/webm' : 'video/webm');
        onCompleteRef.current?.({
          blob: new Blob(chunks, { type }),
          mimeType: type,
          durationMs: accumulatedRef.current,
        });
      };

      // A timeslice makes the browser flush chunks as it goes, so a tab crash
      // or an unplugged device costs a second of audio instead of the whole clip.
      recorder.start(1000);
      recorderRef.current = recorder;
      setState('recording');
      startTick();
    },
    [kind, clearTick, startTick],
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    if (recorder.state === 'recording') {
      accumulatedRef.current += Date.now() - segmentStartRef.current;
    }
    clearTick();
    recorder.stop();
  }, [clearTick]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== 'recording') return;
    accumulatedRef.current += Date.now() - segmentStartRef.current;
    setElapsedMs(accumulatedRef.current);
    clearTick();
    recorder.pause();
    setState('paused');
  }, [clearTick]);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== 'paused') return;
    segmentStartRef.current = Date.now();
    recorder.resume();
    setState('recording');
    startTick();
  }, [startTick]);

  // Never leave a recorder running past the component's life.
  useEffect(() => {
    return () => {
      clearTick();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      recorderRef.current = null;
    };
  }, [clearTick]);

  return { state, elapsedMs, error, start, stop, pause, resume };
}
