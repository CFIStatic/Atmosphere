/**
 * App locales for Settings + shell chrome.
 *
 * Codes are BCP-47. Autonyms stay in their own language so the picker is
 * readable before the rest of the UI has switched.
 */

export const APP_LOCALES = [
  'en',
  'es',
  'pt-BR',
  'fr',
  'de',
  'it',
  'nl',
  'pl',
  'uk',
  'ru',
  'tr',
  'ar',
  'he',
  'hi',
  'ja',
  'ko',
  'zh-Hans',
  'zh-Hant',
  'vi',
  'th',
  'id',
  'sv',
  'nb',
  'da',
  'fi',
  'el',
  'cs',
  'ro',
  'hu',
] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'en';

export interface LocaleOption {
  id: AppLocale;
  /** Language name in that language. */
  nativeName: string;
  /** English name, shown as a subtitle. */
  englishName: string;
  rtl: boolean;
}

export const LOCALE_OPTIONS: LocaleOption[] = [
  { id: 'en', nativeName: 'English', englishName: 'English', rtl: false },
  { id: 'es', nativeName: 'Español', englishName: 'Spanish', rtl: false },
  { id: 'pt-BR', nativeName: 'Português (Brasil)', englishName: 'Portuguese (Brazil)', rtl: false },
  { id: 'fr', nativeName: 'Français', englishName: 'French', rtl: false },
  { id: 'de', nativeName: 'Deutsch', englishName: 'German', rtl: false },
  { id: 'it', nativeName: 'Italiano', englishName: 'Italian', rtl: false },
  { id: 'nl', nativeName: 'Nederlands', englishName: 'Dutch', rtl: false },
  { id: 'pl', nativeName: 'Polski', englishName: 'Polish', rtl: false },
  { id: 'uk', nativeName: 'Українська', englishName: 'Ukrainian', rtl: false },
  { id: 'ru', nativeName: 'Русский', englishName: 'Russian', rtl: false },
  { id: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', rtl: false },
  { id: 'ar', nativeName: 'العربية', englishName: 'Arabic', rtl: true },
  { id: 'he', nativeName: 'עברית', englishName: 'Hebrew', rtl: true },
  { id: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', rtl: false },
  { id: 'ja', nativeName: '日本語', englishName: 'Japanese', rtl: false },
  { id: 'ko', nativeName: '한국어', englishName: 'Korean', rtl: false },
  { id: 'zh-Hans', nativeName: '简体中文', englishName: 'Chinese (Simplified)', rtl: false },
  { id: 'zh-Hant', nativeName: '繁體中文', englishName: 'Chinese (Traditional)', rtl: false },
  { id: 'vi', nativeName: 'Tiếng Việt', englishName: 'Vietnamese', rtl: false },
  { id: 'th', nativeName: 'ไทย', englishName: 'Thai', rtl: false },
  { id: 'id', nativeName: 'Bahasa Indonesia', englishName: 'Indonesian', rtl: false },
  { id: 'sv', nativeName: 'Svenska', englishName: 'Swedish', rtl: false },
  { id: 'nb', nativeName: 'Norsk (bokmål)', englishName: 'Norwegian', rtl: false },
  { id: 'da', nativeName: 'Dansk', englishName: 'Danish', rtl: false },
  { id: 'fi', nativeName: 'Suomi', englishName: 'Finnish', rtl: false },
  { id: 'el', nativeName: 'Ελληνικά', englishName: 'Greek', rtl: false },
  { id: 'cs', nativeName: 'Čeština', englishName: 'Czech', rtl: false },
  { id: 'ro', nativeName: 'Română', englishName: 'Romanian', rtl: false },
  { id: 'hu', nativeName: 'Magyar', englishName: 'Hungarian', rtl: false },
];

const OPTION_BY_ID = new Map(LOCALE_OPTIONS.map((option) => [option.id, option]));

export const LOCALE_STORAGE_KEY = 'atmosphere.locale';

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && OPTION_BY_ID.has(value as AppLocale);
}

export function localeOption(id: AppLocale): LocaleOption {
  return OPTION_BY_ID.get(id) ?? LOCALE_OPTIONS[0];
}

export function isRtlLocale(locale: AppLocale): boolean {
  return localeOption(locale).rtl;
}

/**
 * Map a BCP-47 tag (or list from the browser) onto a supported locale.
 * `zh-CN` → Simplified, `pt` → Brazilian Portuguese, `no` → Norwegian bokmål.
 */
export function matchLocale(tag: string): AppLocale | null {
  const lower = tag.trim().toLowerCase().replace(/_/g, '-');
  if (!lower) return null;
  if (isAppLocale(lower)) return lower;

  if (lower.startsWith('zh-hans') || lower === 'zh-cn' || lower === 'zh-sg') return 'zh-Hans';
  if (
    lower.startsWith('zh-hant') ||
    lower === 'zh-tw' ||
    lower === 'zh-hk' ||
    lower === 'zh-mo'
  ) {
    return 'zh-Hant';
  }
  if (lower.startsWith('zh')) return 'zh-Hans';
  if (lower.startsWith('pt')) return 'pt-BR';
  if (lower.startsWith('nb') || lower.startsWith('nn') || lower === 'no') return 'nb';

  const base = lower.split('-')[0];
  if (isAppLocale(base)) return base;
  return null;
}

export function detectBrowserLocale(
  languages: readonly string[] | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.languages?.length
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : undefined,
): AppLocale {
  if (!languages) return DEFAULT_LOCALE;
  for (const tag of languages) {
    const matched = matchLocale(tag);
    if (matched) return matched;
  }
  return DEFAULT_LOCALE;
}

export function coerceLocale(value: unknown): AppLocale {
  return isAppLocale(value) ? value : detectBrowserLocale();
}

/** Paint lang + dir onto <html> without touching storage. */
export function applyDocumentLocale(locale: AppLocale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.dir = isRtlLocale(locale) ? 'rtl' : 'ltr';
}

export function persistLocalePreference(locale: AppLocale): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* private mode / quota */
  }
}

export function readStoredLocaleOverride(): AppLocale | null {
  if (typeof window === 'undefined') return null;
  try {
    const direct = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isAppLocale(direct)) return direct;
  } catch {
    /* ignore */
  }
  return null;
}
