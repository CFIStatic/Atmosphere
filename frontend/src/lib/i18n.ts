import { useMemo } from 'react';
import { EN, type MessageKey } from '../locales/en';
import { ES } from '../locales/es';
import { OTHER_CATALOGS } from '../locales/other';
import { DEFAULT_LOCALE, type AppLocale } from './locale';
import { getPreferences, usePreferences } from './preferences';

export type { MessageKey };

const CATALOGS: Record<AppLocale, Partial<Record<MessageKey, string>>> = {
  en: EN,
  es: ES,
  'pt-BR': OTHER_CATALOGS['pt-BR'] ?? {},
  fr: OTHER_CATALOGS.fr ?? {},
  de: OTHER_CATALOGS.de ?? {},
  it: OTHER_CATALOGS.it ?? {},
  nl: OTHER_CATALOGS.nl ?? {},
  pl: OTHER_CATALOGS.pl ?? {},
  uk: OTHER_CATALOGS.uk ?? {},
  ru: OTHER_CATALOGS.ru ?? {},
  tr: OTHER_CATALOGS.tr ?? {},
  ar: OTHER_CATALOGS.ar ?? {},
  he: OTHER_CATALOGS.he ?? {},
  hi: OTHER_CATALOGS.hi ?? {},
  ja: OTHER_CATALOGS.ja ?? {},
  ko: OTHER_CATALOGS.ko ?? {},
  'zh-Hans': OTHER_CATALOGS['zh-Hans'] ?? {},
  'zh-Hant': OTHER_CATALOGS['zh-Hant'] ?? {},
  vi: OTHER_CATALOGS.vi ?? {},
  th: OTHER_CATALOGS.th ?? {},
  id: OTHER_CATALOGS.id ?? {},
  sv: OTHER_CATALOGS.sv ?? {},
  nb: OTHER_CATALOGS.nb ?? {},
  da: OTHER_CATALOGS.da ?? {},
  fi: OTHER_CATALOGS.fi ?? {},
  el: OTHER_CATALOGS.el ?? {},
  cs: OTHER_CATALOGS.cs ?? {},
  ro: OTHER_CATALOGS.ro ?? {},
  hu: OTHER_CATALOGS.hu ?? {},
};

export type TranslateVars = Record<string, string | number>;

function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value == null ? match : String(value);
  });
}

/** Look up a string. Unknown keys and missing locale entries fall back to English. */
export function translate(locale: AppLocale, key: MessageKey, vars?: TranslateVars): string {
  const raw = CATALOGS[locale]?.[key] ?? EN[key] ?? key;
  return interpolate(raw, vars);
}

/** Translate using the current preference (or an explicit locale). */
export function t(key: MessageKey, vars?: TranslateVars, locale?: AppLocale): string {
  return translate(locale ?? getPreferences().locale, key, vars);
}

/** Subscribe to locale so Settings and chrome re-render without a reload. */
export function useT(): (key: MessageKey, vars?: TranslateVars) => string {
  const { locale } = usePreferences();
  return useMemo(() => {
    return (key: MessageKey, vars?: TranslateVars) => translate(locale, key, vars);
  }, [locale]);
}

export function catalogHas(locale: AppLocale, key: MessageKey): boolean {
  return Boolean(CATALOGS[locale]?.[key]);
}

export function supportedCatalogLocales(): AppLocale[] {
  return (Object.keys(CATALOGS) as AppLocale[]).filter(
    (locale) => locale === DEFAULT_LOCALE || Object.keys(CATALOGS[locale]).length > 0,
  );
}

export interface VerifierChromeStrings {
  startJob: string;
  dashboard: string;
  settings: string;
  signOut: string;
  appearance: string;
  light: string;
  dark: string;
  openNav: string;
  closeNav: string;
  account: string;
  switchToLight: string;
  switchToDark: string;
}

export function verifierChromeStrings(
  locale: AppLocale,
  theme: 'light' | 'dark',
): VerifierChromeStrings {
  const themeLabel = translate(locale, theme === 'light' ? 'theme.light' : 'theme.dark');
  return {
    startJob: translate(locale, 'nav.startJob'),
    dashboard: translate(locale, 'nav.dashboard'),
    settings: translate(locale, 'nav.settings'),
    signOut: translate(locale, 'common.signOut'),
    appearance: translate(locale, 'nav.appearance', { theme: themeLabel }),
    light: translate(locale, 'theme.light'),
    dark: translate(locale, 'theme.dark'),
    openNav: translate(locale, 'nav.open'),
    closeNav: translate(locale, 'nav.close'),
    account: translate(locale, 'nav.account'),
    switchToLight: translate(locale, 'nav.switchToLight'),
    switchToDark: translate(locale, 'nav.switchToDark'),
  };
}
