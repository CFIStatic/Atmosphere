import { afterEach, describe, expect, it, vi } from 'vitest';
import { translate, verifierChromeStrings } from './i18n';
import {
  applyDocumentLocale,
  detectBrowserLocale,
  isAppLocale,
  isRtlLocale,
  matchLocale,
} from './locale';
import {
  getPreferences,
  initPreferences,
  resetPreferencesForTests,
  setPreference,
} from './preferences';

describe('locale matching', () => {
  it('accepts supported BCP-47 tags and maps common aliases', () => {
    expect(isAppLocale('es')).toBe(true);
    expect(isAppLocale('xx')).toBe(false);
    expect(matchLocale('en-US')).toBe('en');
    expect(matchLocale('es-MX')).toBe('es');
    expect(matchLocale('pt')).toBe('pt-BR');
    expect(matchLocale('pt-PT')).toBe('pt-BR');
    expect(matchLocale('zh-CN')).toBe('zh-Hans');
    expect(matchLocale('zh-TW')).toBe('zh-Hant');
    expect(matchLocale('no')).toBe('nb');
    expect(matchLocale('nn-NO')).toBe('nb');
    expect(matchLocale('fil')).toBeNull();
  });

  it('uses the first supported browser language, else English', () => {
    expect(detectBrowserLocale(['sv-SE', 'en'])).toBe('sv');
    expect(detectBrowserLocale(['fil-PH'])).toBe('en');
  });

  it('marks Arabic and Hebrew as RTL', () => {
    expect(isRtlLocale('ar')).toBe(true);
    expect(isRtlLocale('he')).toBe(true);
    expect(isRtlLocale('en')).toBe(false);
    applyDocumentLocale('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    applyDocumentLocale('es');
    expect(document.documentElement.dir).toBe('ltr');
  });
});

describe('locale persistence', () => {
  afterEach(() => {
    localStorage.clear();
    resetPreferencesForTests();
    vi.unstubAllGlobals();
  });

  it('stores the chosen locale in the preferences blob and atmosphere.locale', () => {
    setPreference('locale', 'es');
    expect(getPreferences().locale).toBe('es');
    expect(localStorage.getItem('atmosphere.locale')).toBe('es');
    expect(JSON.parse(localStorage.getItem('atmosphere.preferences') ?? '{}').locale).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('defaults a first visit to the browser language when it is supported', () => {
    localStorage.clear();
    vi.stubGlobal('navigator', { language: 'it-IT', languages: ['it-IT'] });
    initPreferences();
    expect(getPreferences().locale).toBe('it');
  });

  it('honors atmosphere.locale when the preferences blob has no locale', () => {
    localStorage.clear();
    localStorage.setItem('atmosphere.locale', 'ar');
    localStorage.setItem('atmosphere.preferences', JSON.stringify({ theme: 'dark' }));
    vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] });
    initPreferences();
    expect(getPreferences().locale).toBe('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('keeps a user override instead of re-detecting the browser', () => {
    vi.stubGlobal('navigator', { language: 'fr', languages: ['fr-FR'] });
    setPreference('locale', 'de');
    expect(getPreferences().locale).toBe('de');
    expect(detectBrowserLocale()).toBe('fr');
  });
});

describe('catalog fallback', () => {
  it('uses Spanish strings and falls back to English when a key is missing', () => {
    expect(translate('es', 'settings.title')).toBe('Ajustes');
    expect(translate('es', 'settings.language.helper')).toMatch(/El resto de la aplicación/);
    expect(translate('es', 'nav.videos')).toBe('Vídeos');
    expect(translate('es', 'nav.allVideos')).toBe('Todos los vídeos');
    expect(translate('es', 'nav.classified')).toBe('Clasificados');
    expect(translate('es', 'nav.awaitingAnalysis')).toBe('Pendiente de análisis');
    expect(translate('es', 'nav.needsReview')).toBe('Requiere revisión');
    expect(translate('es', 'nav.support')).toBe('Soporte');
    expect(translate('ja', 'nav.support')).toBe('サポート');
    expect(translate('de', 'settings.password.current')).toBe('Current password');
    expect(translate('ja', 'nav.settings')).toBe('設定');
    expect(translate('ja', 'nav.allVideos')).toBe('すべての動画');
  });

  it('has Settings chrome for every listed locale', async () => {
    const { APP_LOCALES } = await import('./locale');
    const { catalogHas } = await import('./i18n');
    for (const locale of APP_LOCALES) {
      expect(catalogHas(locale, 'settings.title')).toBe(true);
      expect(catalogHas(locale, 'settings.language.title')).toBe(true);
      expect(catalogHas(locale, 'nav.settings')).toBe(true);
      expect(catalogHas(locale, 'nav.support')).toBe(true);
      expect(catalogHas(locale, 'settings.support.title')).toBe(true);
      expect(catalogHas(locale, 'nav.videos')).toBe(true);
      expect(catalogHas(locale, 'nav.allVideos')).toBe(true);
      expect(catalogHas(locale, 'nav.classified')).toBe(true);
      expect(catalogHas(locale, 'nav.awaitingAnalysis')).toBe(true);
      expect(catalogHas(locale, 'nav.needsReview')).toBe(true);
    }
  });

  it('posts Videos rail labels with the rest of office chrome', () => {
    const chrome = verifierChromeStrings('es', 'light');
    expect(chrome.videos).toBe('Vídeos');
    expect(chrome.allVideos).toBe('Todos los vídeos');
    expect(chrome.classified).toBe('Clasificados');
    expect(chrome.awaitingAnalysis).toBe('Pendiente de análisis');
    expect(chrome.needsReview).toBe('Requiere revisión');
    expect(chrome.settings).toBe('Ajustes');
    expect(chrome.support).toBe('Soporte');
  });
});
