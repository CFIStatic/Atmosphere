import { useCallback, useEffect, useRef, useState } from 'react';

export type StreamStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'unsupported' | 'error';

interface UseMediaStream {
  stream: MediaStream | null;
  status: StreamStatus;
  error: string | null;
  start: () => Promise<MediaStream | null>;
  stop: () => void;
}

/**
 * Owns a `getUserMedia` stream and — importantly — releases it.
 *
 * The camera light staying on after a technician leaves the video tab is the
 * kind of thing that gets an app deleted, so every path out of this hook stops
 * the tracks: explicit `stop()`, unmount, and a failed re-acquire.
 *
 * `constraints` is read through a ref so callers can pass an object literal
 * without the identity change re-triggering permission prompts.
 */
export function useMediaStream(constraints: MediaStreamConstraints): UseMediaStream {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const constraintsRef = useRef(constraints);
  constraintsRef.current = constraints;

  // Kept in a ref as well so cleanup can reach the live stream without the
  // effect depending on state (which would tear down on every render).
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    setStatus('idle');
  }, []);

  const start = useCallback(async (): Promise<MediaStream | null> => {
    if (streamRef.current) return streamRef.current;

    // getUserMedia only exists on a secure origin. Saying so beats the bare
    // "undefined is not a function" the browser would otherwise produce.
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      setError(
        window.isSecureContext
          ? "This browser doesn't support media capture."
          : 'Media capture needs a secure connection (HTTPS or localhost).',
      );
      return null;
    }

    setStatus('requesting');
    setError(null);

    try {
      const next = await navigator.mediaDevices.getUserMedia(constraintsRef.current);
      streamRef.current = next;
      setStream(next);
      setStatus('ready');
      return next;
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setStatus('denied');
        setError('Access was blocked. Allow the camera and microphone in your browser settings, then try again.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setStatus('error');
        setError("Couldn't find a camera or microphone on this device.");
      } else if (name === 'NotReadableError') {
        setStatus('error');
        setError('The camera or microphone is already in use by another app.');
      } else {
        setStatus('error');
        setError("Couldn't start capture. Close any other app using the camera and try again.");
      }
      return null;
    }
  }, []);

  // Release hardware when the component using this goes away.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return { stream, status, error, start, stop };
}
