import { describe, expect, it } from 'vitest';

import type { GlossaryEntry } from '@/lib/ai/glossary';

import { aliasRules, asrLanguage, buildPhrases, MAX_PHRASES, primaryLanguageCode } from './vocabulary';

describe('asrLanguage', () => {
  it('mappa le lingue trascritte dal modello sulla variante giusta', () => {
    expect(asrLanguage('it')).toBe('it-IT');
    expect(asrLanguage('en')).toBe('en-GB');
    expect(asrLanguage('pt-BR')).toBe('pt-PT');
  });

  it('le lingue che il modello non trascrive bene ripiegano sul riconoscimento automatico', () => {
    for (const l of ['el', 'ga', 'lt', 'lv', 'mt', 'sl']) expect(asrLanguage(l)).toBe('auto');
  });
});

describe('primaryLanguageCode', () => {
  it('riduce la lingua al codice primario, con l’italiano come ripiego', () => {
    expect(primaryLanguageCode('it-IT')).toBe('it');
    expect(primaryLanguageCode('pt_BR')).toBe('pt');
    expect(primaryLanguageCode(undefined)).toBe('it');
    expect(primaryLanguageCode('')).toBe('it');
  });
});

describe('buildPhrases', () => {
  it('toglie vuoti, doppioni (senza badare alle maiuscole) e frasi troppo lunghe', () => {
    expect(buildPhrases(['PagoPA', ' pagopa ', null, '', 'x'.repeat(81), 'Relatore 1'])).toEqual(['PagoPA', 'Relatore 1']);
  });

  it('si ferma al limite di frasi', () => {
    const many = Array.from({ length: MAX_PHRASES + 10 }, (_, i) => `Termine ${i}`);
    expect(buildPhrases(many)).toHaveLength(MAX_PHRASES);
  });
});

describe('aliasRules', () => {
  it('tiene solo le voci con forme sbagliate note', () => {
    const entry = (term: string, aliases: string[]) => ({ term, aliases }) as unknown as GlossaryEntry;
    expect(aliasRules([entry('SPID', ['spit']), entry('AgID', [])])).toEqual([{ term: 'SPID', aliases: ['spit'] }]);
  });
});
