import { describe, it, expect } from 'vitest';
import {
  resolveLocale,
  localiseEvent,
  getLocalized,
  getLocalizedExact,
  pruneEmptyTranslations,
  setLocalized,
} from './locale';

function makeRequest(url: string, headers?: Record<string, string>): Request {
  return new Request(url, { headers });
}

// ── resolveLocale ───────────────────────────────────────────

describe('resolveLocale', () => {
  it('returns locale from ?locale=en query param', () => {
    const result = resolveLocale(makeRequest('http://localhost?locale=en'));
    expect(result).toBe('en');
  });

  it('returns locale from ?locale=it query param', () => {
    const result = resolveLocale(makeRequest('http://localhost?locale=it'));
    expect(result).toBe('it');
  });

  it('returns en from Accept-Language: en-US', () => {
    const result = resolveLocale(
      makeRequest('http://localhost', { 'accept-language': 'en-US,en;q=0.9' }),
    );
    expect(result).toBe('en');
  });

  it('returns it from Accept-Language: it-IT', () => {
    const result = resolveLocale(
      makeRequest('http://localhost', { 'accept-language': 'it-IT,it;q=0.9' }),
    );
    expect(result).toBe('it');
  });

  it('defaults to it when no hints', () => {
    const result = resolveLocale(makeRequest('http://localhost'));
    expect(result).toBe('it');
  });

  it('returns fr from Accept-Language: fr-FR', () => {
    const result = resolveLocale(
      makeRequest('http://localhost', { 'accept-language': 'fr-FR,de;q=0.5' }),
    );
    expect(result).toBe('fr');
  });

  it('returns de from Accept-Language: de-DE', () => {
    const result = resolveLocale(
      makeRequest('http://localhost', { 'accept-language': 'de-DE' }),
    );
    expect(result).toBe('de');
  });

  it('ignores unsupported locales in Accept-Language', () => {
    const result = resolveLocale(
      makeRequest('http://localhost', { 'accept-language': 'zh-CN,ja;q=0.5' }),
    );
    expect(result).toBe('it');
  });

  it('query param takes priority over Accept-Language', () => {
    const result = resolveLocale(
      makeRequest('http://localhost?locale=en', { 'accept-language': 'it-IT' }),
    );
    expect(result).toBe('en');
  });
});

// ── getLocalized ────────────────────────────────────────────

describe('getLocalized', () => {
  it('returns the value for the requested locale', () => {
    expect(getLocalized({ it: 'Ciao', en: 'Hello' }, 'en')).toBe('Hello');
  });

  it('falls back to it when requested locale missing', () => {
    expect(getLocalized({ it: 'Ciao' }, 'fr')).toBe('Ciao');
  });

  it('falls back to first value when fallback also missing', () => {
    expect(getLocalized({ de: 'Hallo' }, 'fr', 'en')).toBe('Hallo');
  });

  it('returns empty string for null field', () => {
    expect(getLocalized(null, 'it')).toBe('');
  });

  it('returns empty string for undefined field', () => {
    expect(getLocalized(undefined, 'it')).toBe('');
  });

  it('returns empty string for empty object', () => {
    expect(getLocalized({}, 'it')).toBe('');
  });

  // The event form writes one key per enabled locale and leaves the untranslated
  // ones as "". Treating that as a real value produced, in production,
  // confirmation emails with the subject "Registration confirmed: " and no event
  // name anywhere — for every attendee who registered from an /en page of an
  // event titled only in Italian.
  it('treats an EMPTY translation as missing and falls back', () => {
    expect(getLocalized({ it: 'Sync DesIt + DevIt', en: '' }, 'en')).toBe('Sync DesIt + DevIt');
  });

  it('treats a whitespace-only translation as missing', () => {
    expect(getLocalized({ it: 'Ciao', en: '   ' }, 'en')).toBe('Ciao');
    expect(getLocalized({ it: 'Ciao', en: '\n\t' }, 'en')).toBe('Ciao');
  });

  it('skips an empty fallback and takes the first usable value', () => {
    expect(getLocalized({ it: '', en: '', de: 'Hallo' }, 'fr')).toBe('Hallo');
  });

  it('returns empty only when every translation is empty', () => {
    expect(getLocalized({ it: '', en: '  ' }, 'en')).toBe('');
  });

  it('still prefers the requested locale when it has content', () => {
    expect(getLocalized({ it: 'Ciao', en: 'Hello' }, 'en')).toBe('Hello');
  });
});

// ── setLocalized ────────────────────────────────────────────

describe('setLocalized', () => {
  it('sets a new value on existing field', () => {
    const result = setLocalized({ it: 'Ciao' }, 'en', 'Hello');
    expect(result).toEqual({ it: 'Ciao', en: 'Hello' });
  });

  it('creates field from null', () => {
    const result = setLocalized(null, 'it', 'Ciao');
    expect(result).toEqual({ it: 'Ciao' });
  });

  it('overwrites existing locale value', () => {
    const result = setLocalized({ it: 'Vecchio' }, 'it', 'Nuovo');
    expect(result).toEqual({ it: 'Nuovo' });
  });

  it('does not mutate original object', () => {
    const original = { it: 'Ciao' };
    setLocalized(original, 'en', 'Hello');
    expect(original).toEqual({ it: 'Ciao' });
  });
});

// ── localiseEvent ───────────────────────────────────────────

describe('localiseEvent', () => {
  it('returns Italian title/description for it locale', () => {
    const event = {
      title: { it: 'Titolo Italiano', en: 'English Title' },
      description: { it: 'Descrizione italiana', en: 'English description' },
    };
    const { title, description } = localiseEvent(event, 'it');
    expect(title).toBe('Titolo Italiano');
    expect(description).toBe('Descrizione italiana');
  });

  it('returns English title/description for en locale', () => {
    const event = {
      title: { it: 'Titolo Italiano', en: 'English Title' },
      description: { it: 'Descrizione italiana', en: 'English description' },
    };
    const { title, description } = localiseEvent(event, 'en');
    expect(title).toBe('English Title');
    expect(description).toBe('English description');
  });

  it('falls back to Italian when English fields are missing', () => {
    const event = {
      title: { it: 'Titolo Italiano' },
      description: { it: 'Descrizione italiana' },
    };
    const { title, description } = localiseEvent(event, 'en');
    expect(title).toBe('Titolo Italiano');
    expect(description).toBe('Descrizione italiana');
  });

  it('returns French when available', () => {
    const event = {
      title: { it: 'Titolo', fr: 'Titre' },
      description: { it: 'Desc', fr: 'Description' },
    };
    const { title, description } = localiseEvent(event, 'fr');
    expect(title).toBe('Titre');
    expect(description).toBe('Description');
  });
});

// ── pruneEmptyTranslations ──────────────────────────────────

describe('pruneEmptyTranslations', () => {
  it('drops empty and whitespace-only locales', () => {
    expect(pruneEmptyTranslations({ it: 'Sync', en: '', fr: '  ' })).toEqual({ it: 'Sync' });
  });

  it('keeps every locale that has content', () => {
    expect(pruneEmptyTranslations({ it: 'Ciao', en: 'Hello' })).toEqual({ it: 'Ciao', en: 'Hello' });
  });

  it('returns an empty object for null/undefined/empty input', () => {
    expect(pruneEmptyTranslations(null)).toEqual({});
    expect(pruneEmptyTranslations(undefined)).toEqual({});
    expect(pruneEmptyTranslations({})).toEqual({});
  });

  it('is what makes the stored shape and the read fallback agree', () => {
    const stored = pruneEmptyTranslations({ it: 'Sync DesIt + DevIt', en: '' });
    expect(getLocalized(stored, 'en')).toBe('Sync DesIt + DevIt');
    // …and a consumer reading the JSON directly no longer sees an empty string.
    expect(stored).not.toHaveProperty('en');
  });
});

// ── getLocalizedExact ───────────────────────────────────────

describe('getLocalizedExact', () => {
  it('returns only what was authored for that locale', () => {
    expect(getLocalizedExact({ it: 'Testo', en: '' }, 'en')).toBe('');
    expect(getLocalizedExact({ it: 'Testo' }, 'en')).toBe('');
    expect(getLocalizedExact({ it: 'Testo', en: 'Text' }, 'en')).toBe('Text');
  });

  it('never falls back — a legal page must not serve another language as its own', () => {
    // privacy/accessibility rely on the empty result to render the built-in,
    // fully translated document instead of the operator's Italian text.
    expect(getLocalizedExact({ it: 'Informativa' }, 'de')).toBe('');
  });
});
