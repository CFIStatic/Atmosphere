import { useCallback, useEffect, useRef } from 'react';

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  /** Fired once the fourth digit lands, so the user never hits a submit button. */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  /** Plays the shake animation — set this when a PIN is rejected. */
  shake?: boolean;
  autoFocus?: boolean;
}

export const PIN_LENGTH = 4;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

function BackspaceIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7 6-7Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="m12 10 4 4m0-4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Four-digit PIN entry with an on-screen keypad.
 *
 * The keypad is the primary input rather than a convenience: the people signing
 * in with a PIN are mostly on phones in the field, often wearing gloves, so the
 * targets are deliberately large. A physical keyboard still works — the wrapper
 * is focusable and handles digit/backspace keys.
 */
export function PinPad({
  value,
  onChange,
  onComplete,
  disabled = false,
  shake = false,
  autoFocus = false,
}: PinPadProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const push = useCallback(
    (digit: string) => {
      if (disabled || value.length >= PIN_LENGTH) return;
      const next = value + digit;
      onChange(next);
      if (next.length === PIN_LENGTH) onComplete?.(next);
    },
    [disabled, value, onChange, onComplete],
  );

  const pop = useCallback(() => {
    if (disabled || value.length === 0) return;
    onChange(value.slice(0, -1));
  }, [disabled, value, onChange]);

  useEffect(() => {
    if (autoFocus) containerRef.current?.focus();
  }, [autoFocus]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key >= '0' && e.key <= '9') {
      e.preventDefault();
      push(e.key);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      pop();
    }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={handleKeyDown}
      role="group"
      aria-label="PIN entry"
      className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      {/* Filled/empty indicator dots. The PIN itself is never rendered. */}
      <div
        className={`flex justify-center gap-4 ${shake ? 'animate-shake' : ''}`}
        role="status"
        aria-live="polite"
        aria-label={`${value.length} of ${PIN_LENGTH} digits entered`}
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <span
            key={i}
            className={`h-3.5 w-3.5 rounded-full border transition ${
              i < value.length
                ? 'scale-110 border-brand-400 bg-brand-400'
                : 'border-line/25 bg-transparent'
            }`}
          />
        ))}
      </div>

      <div className="mx-auto mt-8 grid max-w-[17rem] grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => push(k)}
            className="h-16 rounded-xl border border-line/10 bg-raised/70 text-xl font-semibold text-fg transition hover:bg-raised-2 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {k}
          </button>
        ))}

        <span aria-hidden="true" />

        <button
          type="button"
          disabled={disabled}
          onClick={() => push('0')}
          className="h-16 rounded-xl border border-line/10 bg-raised/70 text-xl font-semibold text-fg transition hover:bg-raised-2 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          0
        </button>

        <button
          type="button"
          disabled={disabled || value.length === 0}
          onClick={pop}
          aria-label="Delete last digit"
          className="grid h-16 place-items-center rounded-xl border border-line/10 bg-raised/40 text-fg-2 transition hover:bg-raised-2 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <BackspaceIcon />
        </button>
      </div>
    </div>
  );
}
