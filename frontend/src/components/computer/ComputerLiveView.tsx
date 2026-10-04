import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { isAllowedLiveViewUrl, type ComputerLiveLink } from '../../lib/computer';

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
    <div className="overflow-hidden rounded-xl border border-line bg-paper-0" data-testid="computer-live-view">
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
            onClick={onClose}
            className="rounded-full border border-line bg-paper-0 px-2.5 py-1 text-[11px] font-medium text-ink-600 transition hover:border-brand-200 hover:text-ink-900"
          >
            Close
          </button>
        </div>
      </div>
      <div className="relative w-full bg-ink-900" style={{ aspectRatio: '1280 / 800' }}>
        {link ? (
          <iframe
            title={watching ? 'Computer live view (watch only)' : 'Computer live view (you have control)'}
            src={link.url}
            className="absolute inset-0 h-full w-full border-0"
            style={watching ? { pointerEvents: 'none' } : undefined}
            referrerPolicy="no-referrer"
            allow="clipboard-read; clipboard-write"
            data-testid="computer-live-iframe"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs text-paper-200">
            {error ?? 'Connecting to the browser…'}
          </div>
        )}
        {watching && link ? (
          <div className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-ink-900/75 px-2.5 py-1 text-[11px] text-paper-50">
            Watch only. Take control to use the mouse.
          </div>
        ) : null}
      </div>
      {!watching ? (
        <p className="border-t border-line px-3 py-2 text-[11px] text-ink-600">
          Computer is paused while you have control. Sign in or make changes, then hand back. Your login stays saved for next time.
        </p>
      ) : null}
    </div>
  );
}
