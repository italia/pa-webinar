// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  asrPromptTerms,
  canEditInstanceTerm,
  glossaryHints,
  glossaryTermInputSchema,
  mergeGlossary,
  toGlossaryEntry,
  type GlossaryEntry,
} from './glossary';

const voce = (term: string, eventId: string | null, extra: Partial<GlossaryEntry> = {}): GlossaryEntry => ({
  id: `${eventId ?? 'i'}-${term}`,
  eventId,
  term,
  aliases: [],
  reading: 'auto',
  spoken: {},
  translations: {},
  note: null,
  createdById: null,
  ...extra,
});

describe('glossario', () => {
  it('la voce dell’evento prende il posto di quella dell’istanza, maiuscole a parte', () => {
    const out = mergeGlossary(
      [voce('ABC', null, { note: 'istanza' }), voce('XYZ', null)],
      [voce('abc', 'ev', { note: 'evento' })],
    );
    // Prima le voci dell'evento, poi quelle dell'istanza.
    expect(out.map((e) => [e.term, e.note])).toEqual([
      ['abc', 'evento'],
      ['XYZ', null],
    ]);
    expect(mergeGlossary([voce('AAA', null)], [voce('ZZZ', 'ev')]).map((e) => e.term)).toEqual(['ZZZ', 'AAA']);
  });

  it('suggerimento a Whisper: prima i termini dell’evento, entro lo spazio', () => {
    const g = [voce('ISTANZA1', null), voce('EVENTO', 'ev'), voce('ISTANZA2', null)];
    expect(asrPromptTerms(g, 100)).toBe('EVENTO, ISTANZA1, ISTANZA2');
    expect(asrPromptTerms(g, 16)).toBe('EVENTO, ISTANZA1');
    expect(asrPromptTerms(g, 3)).toBe('');
  });

  it('al worker vanno le regole, non gli identificativi', () => {
    const [h] = glossaryHints([voce('ABC', 'ev', { aliases: ['a bi ci'], reading: 'spell' })]);
    expect(h).toEqual({ term: 'ABC', aliases: ['a bi ci'], reading: 'spell', spoken: {}, translations: {}, note: null });
  });

  it('voci dell’istanza: l’amministrazione modifica tutto, chi organizza le proprie', () => {
    const admin = { role: 'admin' as const, accountId: null };
    const org = { role: 'organizer' as const, accountId: 'acc-1' };
    expect(canEditInstanceTerm(admin, { createdById: null })).toBe(true);
    expect(canEditInstanceTerm(org, { createdById: 'acc-1' })).toBe(true);
    expect(canEditInstanceTerm(org, { createdById: 'acc-2' })).toBe(false);
    // Le voci precaricate e quelle aggiunte con la chiave dell'istanza.
    expect(canEditInstanceTerm(org, { createdById: null })).toBe(false);
  });

  it('una riga del database con valori strani diventa una voce pulita', () => {
    const e = toGlossaryEntry({
      id: 'x',
      eventId: null,
      term: 'ABC',
      aliases: ['a bi ci'],
      reading: 'boh',
      spoken: { it: 'a bi ci', en: 3 },
      translations: ['non un oggetto'],
      note: null,
      createdById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    expect(e.reading).toBe('auto');
    expect(e.spoken).toEqual({ it: 'a bi ci' });
    expect(e.translations).toEqual({});
  });

  it('valida lingue, «tutte le lingue» solo per la pronuncia, una riga sola', () => {
    expect(glossaryTermInputSchema.safeParse({ term: 'ABC', spoken: { '*': 'a bi ci', it: 'x' } }).success).toBe(true);
    expect(glossaryTermInputSchema.safeParse({ term: 'ABC', translations: { '*': 'x' } }).success).toBe(false);
    expect(glossaryTermInputSchema.safeParse({ term: 'ABC', translations: { xx: 'x' } }).success).toBe(false);
    expect(glossaryTermInputSchema.safeParse({ term: 'AB\nC' }).success).toBe(false);
    expect(glossaryTermInputSchema.safeParse({ term: '  ' }).success).toBe(false);
    const ok = glossaryTermInputSchema.parse({ term: ' ABC ' });
    expect(ok).toMatchObject({ term: 'ABC', aliases: [], reading: 'auto', spoken: {}, translations: {} });
  });
});
