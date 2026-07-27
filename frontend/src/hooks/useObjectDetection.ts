import { useEffect, useRef, useState, type RefObject } from 'react';

export interface Detection {
  label: string;
  /** 0–1 confidence from the model. */
  score: number;
  /** `[x, y, width, height]` in the video's own pixel space. */
  bbox: [number, number, number, number];
}

export type DetectorStatus = 'idle' | 'loading' | 'running' | 'error';

/**
 * Object detection on the live camera feed, entirely in the browser.
 *
 * COCO-SSD via TensorFlow.js runs on-device, which is the point: a technician
 * in a crawlspace with one bar of signal gets the same latency as one standing
 * in the driveway, and no video frame ever leaves the phone.
 *
 * By default the weights (~18 MB) come from Google's CDN on first use and are
 * then served from the browser's HTTP cache. Both TF.js and the model are
 * pulled in with a dynamic `import()`, so they stay out of the main bundle and
 * cost nothing to the technicians who never open this tab.
 *
 * Set `VITE_COCO_SSD_MODEL_URL` to a self-hosted `model.json` when the CDN is
 * not an option — a locked-down corporate network, an air-gapped deployment, or
 * simply not wanting a third-party runtime dependency.
 */

/** Self-hosted `model.json`, if this deployment configured one. */
const MODEL_URL = import.meta.env.VITE_COCO_SSD_MODEL_URL as string | undefined;

/** Ignore boxes the model isn't reasonably sure about — they flicker badly. */
const MIN_SCORE = 0.5;

/**
 * Roughly 7 detections/second. Faster looks no better to a human eye and turns
 * a phone into a hand warmer; slower makes the boxes visibly lag the camera.
 */
const DETECT_INTERVAL_MS = 140;

/** Loaded once per page and shared — reloading per mount would refetch weights. */
let modelPromise: Promise<CocoSsdModel> | null = null;

interface CocoSsdPrediction {
  bbox: [number, number, number, number];
  class: string;
  score: number;
}
interface CocoSsdModel {
  detect: (input: HTMLVideoElement) => Promise<CocoSsdPrediction[]>;
}

async function loadModel(): Promise<CocoSsdModel> {
  modelPromise ??= (async () => {
    const [tf, cocoSsd] = await Promise.all([
      import('@tensorflow/tfjs'),
      import('@tensorflow-models/coco-ssd'),
    ]);
    // Waits for a backend (WebGL where available, CPU otherwise) to initialise.
    await tf.ready();
    // 'lite_mobilenet_v2' is the smallest and fastest base — the right trade on
    // a phone, where the alternative is a slideshow. A configured `modelUrl`
    // points at the same architecture, self-hosted.
    const config = MODEL_URL ? { modelUrl: MODEL_URL } : { base: 'lite_mobilenet_v2' as const };
    return (await cocoSsd.load(config)) as unknown as CocoSsdModel;
  })();

  try {
    return await modelPromise;
  } catch (err) {
    modelPromise = null; // let a retry re-attempt the download
    throw err;
  }
}

interface UseObjectDetection {
  status: DetectorStatus;
  error: string | null;
  detections: Detection[];
}

export function useObjectDetection(
  videoRef: RefObject<HTMLVideoElement>,
  enabled: boolean,
): UseObjectDetection {
  const [status, setStatus] = useState<DetectorStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);

  // Guards the async loop against a component that unmounted mid-inference.
  const runningRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      runningRef.current = false;
      setStatus('idle');
      setDetections([]);
      return;
    }

    let frame = 0;
    let cancelled = false;
    runningRef.current = true;

    (async () => {
      setStatus('loading');
      setError(null);

      let model: CocoSsdModel;
      try {
        model = await loadModel();
      } catch {
        if (cancelled) return;
        setStatus('error');
        setError('Could not load the detection model. Check your connection and try again.');
        return;
      }
      if (cancelled) return;

      setStatus('running');
      let lastRun = 0;
      // Detection is far slower than a frame, so the loop is a rAF pump gated
      // by a timestamp rather than a `setInterval` that would stack requests.
      let inFlight = false;

      const tick = async (now: number) => {
        if (cancelled) return;
        frame = requestAnimationFrame(tick);

        const video = videoRef.current;
        // readyState < 2 means no frame is decoded yet; detecting would throw.
        if (inFlight || !video || video.readyState < 2 || now - lastRun < DETECT_INTERVAL_MS) return;

        lastRun = now;
        inFlight = true;
        try {
          const predictions = await model.detect(video);
          if (cancelled) return;
          setDetections(
            predictions
              .filter((p) => p.score >= MIN_SCORE)
              .map((p) => ({ label: p.class, score: p.score, bbox: p.bbox })),
          );
        } catch {
          /* a dropped frame is not worth surfacing — the next tick retries */
        } finally {
          inFlight = false;
        }
      };

      frame = requestAnimationFrame(tick);
    })();

    return () => {
      cancelled = true;
      runningRef.current = false;
      cancelAnimationFrame(frame);
    };
  }, [enabled, videoRef]);

  return { status, error, detections };
}
