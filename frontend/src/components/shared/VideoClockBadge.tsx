import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../design/cn';
import { formatVideoClock, measuredDuration } from '../../lib/videoDuration';

/**
 * The length a preview should print. Hidden while unknown — a 0:00 badge
 * reads as a real clock time, which is how the office list used to lie.
 */
export function VideoClockBadge({
  seconds,
  className,
}: {
  seconds: number | null | undefined;
  className?: string;
}) {
  const label = formatVideoClock(seconds);
  if (label === '—') return null;
  return (
    <span
      className={cn(
        'absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white',
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Prefer the stored length, then whatever the player learns from the file. */
export function useMeasuredVideoClock(
  initial: number | null | undefined,
): [number | null, (el: HTMLVideoElement | null) => void] {
  const [seconds, setSeconds] = useState<number | null>(() => measuredDuration(initial ?? 0));
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setSeconds(measuredDuration(initial ?? 0));
  }, [initial]);

  const ref = useCallback((el: HTMLVideoElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!el) return;

    const apply = () => {
      const next = measuredDuration(el.duration);
      if (next != null) setSeconds(next);
    };
    el.addEventListener('loadedmetadata', apply);
    el.addEventListener('durationchange', apply);
    if (el.readyState >= 1) apply();
    cleanupRef.current = () => {
      el.removeEventListener('loadedmetadata', apply);
      el.removeEventListener('durationchange', apply);
    };
  }, []);

  return [seconds, ref];
}
