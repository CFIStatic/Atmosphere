import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api, type ResolvedPlaceAddress } from '../lib/api';

type Suggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

function newSessionToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 32);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * Site address field backed by the BFF (Google Places when configured,
 * otherwise OpenStreetMap). Falls back to a plain text input if lookup fails.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onResolved,
  required,
  placeholder,
  disabled,
  id: idProp,
  className = 'glass-field mt-1 w-full rounded-lg px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400',
}: {
  value: string;
  onChange: (next: string) => void;
  /** Called when the user picks a Google suggestion (street + city + postal). */
  onResolved?: (address: ResolvedPlaceAddress) => void;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const autoId = useId();
  const inputId = idProp ?? autoId;
  const listId = `${inputId}-list`;
  const sessionRef = useRef(newSessionToken());
  const blurTimer = useRef<number | null>(null);
  const pickedLock = useRef(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .placesStatus()
      .then((res) => {
        if (!cancelled) setConfigured(res.configured);
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (pickedLock.current) {
      setOpen(false);
      setSuggestions([]);
      return;
    }
    if (configured === false) return;
    const q = value.trim();
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      setBusy(true);
      void api
        .placesAutocomplete({ input: q, sessionToken: sessionRef.current })
        .then((res) => {
          if (cancelled) return;
          setConfigured(res.configured);
          setSuggestions(res.suggestions);
          setOpen(res.suggestions.length > 0);
          setActive(-1);
          setHint(null);
        })
        .catch((err) => {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : '';
          if (/maps_unconfigured|not configured/i.test(msg)) {
            setConfigured(false);
            setHint(null);
          } else {
            setHint('Address lookup unavailable — type the full address.');
          }
          setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [value, configured]);

  async function pick(s: Suggestion) {
    pickedLock.current = true;
    setOpen(false);
    setSuggestions([]);
    onChange(s.description);
    setBusy(true);
    try {
      const { address } = await api.placesDetails({
        placeId: s.placeId,
        sessionToken: sessionRef.current,
      });
      sessionRef.current = newSessionToken();
      onChange(address.formatted || address.addressLine1);
      onResolved?.(address);
      setHint(null);
    } catch {
      setHint('Could not confirm that place — check city and postal below.');
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      void pick(suggestions[active]!);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className={open && suggestions.length > 0 ? 'relative z-50' : 'relative'}>
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        className={className}
        value={value}
        disabled={disabled}
        required={required}
        autoComplete="street-address"
        placeholder={placeholder ?? 'Start typing a street address…'}
        onChange={(e) => {
          pickedLock.current = false;
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (suggestions.length) setOpen(true);
        }}
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 160);
        }}
        onKeyDown={onKeyDown}
      />
      {busy && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-ink-400">
          Looking up…
        </span>
      )}
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-line bg-paper-0 py-1 shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li key={s.placeId} role="option" aria-selected={i === active} id={`${listId}-${i}`}>
              <button
                type="button"
                className={`flex w-full flex-col px-3 py-2 text-left text-sm ${
                  i === active ? 'bg-brand-50 text-ink-900' : 'text-ink-800 hover:bg-paper-100'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (blurTimer.current) window.clearTimeout(blurTimer.current);
                  void pick(s);
                }}
              >
                <span className="font-medium">{s.mainText}</span>
                {s.secondaryText ? (
                  <span className="text-xs text-ink-500">{s.secondaryText}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {configured === false && (
        <p className="mt-1 text-[11px] text-ink-500">
          Type the full street address — lookup is unavailable right now.
        </p>
      )}
      {hint && <p className="mt-1 text-[11px] text-caution-600">{hint}</p>}
    </div>
  );
}
