import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
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
 * otherwise OpenStreetMap). The suggestion list is portaled to document.body
 * so a transformed card or the phone iframe scroller cannot clip or offset it.
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
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef(newSessionToken());
  const blurTimer = useRef<number | null>(null);
  const pickGen = useRef(0);
  /** Lookups only after the user types — a filled value must not reopen the list. */
  const typedRef = useRef(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [provider, setProvider] = useState<'google' | 'osm' | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);
  const [hint, setHint] = useState<string | null>(null);
  const [listPos, setListPos] = useState<{ top: number; left: number; width: number } | null>(null);

  function syncListPos() {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setListPos({ top: r.bottom + 4, left: r.left, width: r.width });
  }

  useEffect(() => {
    let cancelled = false;
    void api
      .placesStatus()
      .then((res) => {
        if (cancelled) return;
        setConfigured(res.configured);
        setProvider(res.provider === 'google' || res.google ? 'google' : res.provider ?? null);
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (chosen || !typedRef.current) {
      setOpen(false);
      setSuggestions([]);
      return;
    }
    if (configured === false) return;
    const q = value.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const gen = pickGen.current;
    let cancelled = false;
    const t = window.setTimeout(() => {
      setBusy(true);
      void api
        .placesAutocomplete({ input: q, sessionToken: sessionRef.current })
        .then((res) => {
          if (cancelled || gen !== pickGen.current) return;
          setConfigured(res.configured);
          if (res.provider) setProvider(res.provider);
          setSuggestions(res.suggestions);
          setOpen(res.suggestions.length > 0);
          setActive(-1);
          setHint(res.suggestions.length ? null : 'No matching streets — keep typing or try the town.');
          if (res.suggestions.length) syncListPos();
        })
        .catch((err) => {
          if (cancelled || gen !== pickGen.current) return;
          const msg = err instanceof Error ? err.message : '';
          if (/maps_unconfigured|not configured/i.test(msg)) {
            setConfigured(false);
            setHint(null);
          } else {
            setHint('Address search is unavailable. Try again in a moment.');
          }
          setSuggestions([]);
          setOpen(false);
        })
        .finally(() => {
          if (!cancelled && gen === pickGen.current) setBusy(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [value, configured, chosen]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => syncListPos();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  async function pick(s: Suggestion) {
    pickGen.current += 1;
    typedRef.current = false;
    setChosen(true);
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
      setOpen(false);
      setSuggestions([]);
      setHint(null);
    } catch {
      setOpen(false);
      setSuggestions([]);
      setHint('Could not confirm that place — pick another result.');
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

  const showList = open && !chosen && suggestions.length > 0;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={inputId}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-label="Address"
        className={className}
        value={value}
        disabled={disabled}
        required={required}
        autoComplete="off"
        placeholder={placeholder ?? 'Search for a street address…'}
        onChange={(e) => {
          typedRef.current = true;
          setChosen(false);
          onChange(e.target.value);
        }}
        onFocus={() => {
          if (!chosen && typedRef.current && suggestions.length) {
            syncListPos();
            setOpen(true);
          }
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
      {showList &&
        listPos &&
        createPortal(
          <ul
            id={listId}
            role="listbox"
            style={{ top: listPos.top, left: listPos.left, width: listPos.width }}
            className="fixed z-[80] max-h-60 overflow-auto rounded-lg border border-line bg-paper-0 py-1 shadow-lg"
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
          </ul>,
          document.body,
        )}
      {configured !== false && !chosen && !hint && !value.trim() && (
        <p className="mt-1 text-[11px] text-ink-500">
          {provider === 'osm'
            ? 'Start typing, then pick a result from the list.'
            : 'Search Google for the site, then pick a result.'}
        </p>
      )}
      {configured === false && (
        <p className="mt-1 text-[11px] text-ink-500">
          Address search is unavailable — type the full street, town, and postal code.
        </p>
      )}
      {hint && <p className="mt-1 text-[11px] text-caution-600">{hint}</p>}
    </div>
  );
}
