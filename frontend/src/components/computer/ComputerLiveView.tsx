import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { isAllowedLiveViewUrl, type ComputerLiveLink } from '../../lib/computer';

/** The remote browser's viewport (providers/browserbase.ts creates it at this size). */
const VIEW_W = 1280;
const VIEW_H = 800;

/**
 * The live browser for a Computer task. Watch shows it with the pointer
 * blocked; Take control lets this viewer use the mouse and keyboard (the
 * agent pauses until they hand back). Each link is minted for this viewer,
 * expires in minutes, and is refreshed before it does. It lives only in
 * component state: never logged, stored or put in the address bar.
 */
export function ComputerLiveView({
  taskId,
  mode,
  onClose,
  onTakeControl,
  onHandBack,
}: {
  taskId: string;
  mode: 'watch' | 'control';
  onClose: () => void;
  onTakeControl?: () => void;
  onHandBack?: () => void;
}) {
  const [link, setLink] = useState<ComputerLiveLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 640, h: 400 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  // Expanded: fit inside the overlay. Inline: fill the card's width.
  const scale = expanded ? Math.min(box.w / VIEW_W, box.h / VIEW_H) || 0.5 : box.w / VIEW_W || 0.5;
  const offsetX = expanded ? Math.max(0, (box.w - VIEW_W * scale) / 2) : 0;
  const offsetY = expanded ? Math.max(0, (box.h - VIEW_H * scale) / 2) : 0;
  const portrait = expanded && box.h > box.w;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await api.computerLiveView(taskId, mode);
        if (cancelled) return;
        if (!isAllowedLiveViewUrl(next.url)) {
          setError('The live view link did not come from the browser service.');
          return;
        }
        setLink(next);
        setError(null);
        const ms = Date.parse(next.expiresAt) - Date.now() - 30_000;
        refreshTimer.current = window.setTimeout(load, Math.max(15_000, ms));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'The live view is not available.');
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [taskId, mode]);

  const watching = mode === 'watch';
  return (
    <div
      className={
        expanded
          ? 'fixed inset-0 z-50 flex flex-col bg-ink-900'
          : 'overflow-hidden rounded-xl border border-line bg-paper-0'
      }
      data-testid="computer-live-view"
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded ? true : undefined}
      aria-label={expanded ? 'Computer live view' : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper-50 px-3 py-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-ink-800">
          <span className={`h-2 w-2 rounded-full ${watching ? 'bg-success-600' : 'bg-brand-600'}`} aria-hidden />
          {watching ? 'Watching live' : 'You have control'}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {watching && onTakeControl ? (
            <button
              type="button"
              onClick={onTakeControl}
              className="rounded-full border border-line bg-paper-0 px-2.5 py-1 text-[11px] font-semibold text-ink-800 transition hover:border-brand-200"
            >
              Take control
            </button>
          ) : null}
          {!watching && onHandBack ? (
            <button
              type="button"
              onClick={onHandBack}
              className="rounded-full bg-brand-600 px-2.5 py-1 text-[11px] font-semibold text-ink-900 transition hover:bg-brand-700"
            >
              Hand back to Computer
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-full border border-line bg-paper-0 px-2.5 py-1 text-[11px] font-medium text-ink-600 transition hover:border-brand-200 hover:text-ink-900"
          >
            {expanded ? 'Shrink' : 'Full screen'}
          </button>
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              onClose();
            }}
            className="rounded-full border border-line bg-paper-0 px-2.5 py-1 text-[11px] font-medium text-ink-600 transition hover:border-brand-200 hover:text-ink-900"
          >
            Close
          </button>
        </div>
      </div>
      <div ref={boxRef} className={expanded ? 'relative min-h-0 flex-1 overflow-hidden' : 'relative w-full overflow-hidden bg-ink-900'} style={expanded ? undefined : { height: Math.round(VIEW_H * scale) }}>
        {link ? (
          // The remote browser is 1280×800. Render the frame at that size and
          // scale it to fit, so a phone sees the whole page (input coordinates
          // follow the CSS transform).
          <iframe
            title={watching ? 'Computer live view (watch only)' : 'Computer live view (you have control)'}
            src={link.url}
            className="absolute left-0 top-0 border-0 bg-paper-0"
            style={{
              width: VIEW_W,
              height: VIEW_H,
              transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
              transformOrigin: 'top left',
              ...(watching ? { pointerEvents: 'none' as const } : {}),
            }}
            referrerPolicy="no-referrer"
            allow="clipboard-read; clipboard-write"
            data-testid="computer-live-iframe"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs text-paper-200">
            {error ?? 'Connecting to the browser…'}
          </div>
        )}
      </div>
      <p className="border-t border-line bg-paper-0 px-3 py-2 text-[11px] text-ink-600">
        {portrait ? 'Turn your phone sideways for a bigger view. ' : ''}
        {watching
          ? 'Watch only. Take control to use the mouse and keyboard yourself.'
          : 'Computer is paused while you have control. Sign in or make changes, then hand back. Your login stays saved for next time.'}
      </p>
    </div>
  );
}
