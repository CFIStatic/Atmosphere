import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { LOCALE_OPTIONS, localeOption, type AppLocale } from '../lib/locale';
import { setPreference, usePreferences } from '../lib/preferences';
import { CheckIcon, ChevronDownIcon, SearchIcon } from './icons';

function optionSearchText(option: (typeof LOCALE_OPTIONS)[number]): string {
  return `${option.nativeName} ${option.englishName} ${option.id}`.toLowerCase();
}

/**
 * Searchable language combobox. Names are shown in their own language, with
 * an English subtitle when that differs from the autonym.
 */
export function LanguagePicker() {
  const t = useT();
  const { locale } = usePreferences();
  const selected = localeOption(locale);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LOCALE_OPTIONS;
    return LOCALE_OPTIONS.filter((option) => optionSearchText(option).includes(q));
  }, [query]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  function choose(next: AppLocale) {
    setPreference('locale', next);
    close();
  }

  const showEnglish = selected.englishName !== selected.nativeName;

  return (
    <div ref={wrapRef} className="relative max-w-md">
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls="language-picker-list"
        aria-haspopup="listbox"
        aria-label={t('settings.language.aria')}
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
        className="flex w-full items-center justify-between gap-3 rounded-lg glass-card px-3.5 py-2.5 text-start text-sm text-ink-900 outline-none transition focus-visible:border-brand-400 focus-visible:ring-2 focus-visible:ring-brand-200"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{selected.nativeName}</span>
          {showEnglish && (
            <span className="mt-0.5 block truncate text-xs text-ink-500">{selected.englishName}</span>
          )}
        </span>
        <ChevronDownIcon width={16} height={16} className="shrink-0 text-ink-500" />
      </button>

      {open && (
        <div
          id="language-picker-list"
          className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl glass-panel"
        >
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm text-ink-500">
            <SearchIcon width={15} height={15} className="shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('settings.language.search')}
              aria-label={t('settings.language.search')}
              className="w-full bg-transparent text-ink-900 placeholder-ink-500 outline-none"
            />
          </div>
          <ul role="listbox" aria-label={t('settings.language.aria')} className="max-h-64 overflow-y-auto py-1">
            {matches.length === 0 ? (
              <li className="px-3.5 py-6 text-center text-sm text-ink-500">
                {t('settings.language.empty')}
              </li>
            ) : (
              matches.map((option) => {
                const active = option.id === locale;
                const subtitle = option.englishName !== option.nativeName;
                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => choose(option.id)}
                      className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-start text-sm transition hover:bg-paper-200 ${
                        active ? 'text-ink-900' : 'text-ink-700'
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{option.nativeName}</span>
                        {subtitle && (
                          <span className="block truncate text-xs text-ink-500">
                            {option.englishName}
                          </span>
                        )}
                      </span>
                      {active && <CheckIcon width={16} height={16} className="shrink-0 text-brand-600" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
