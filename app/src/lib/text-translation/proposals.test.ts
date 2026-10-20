import { describe, expect, it } from 'vitest';

import {
  letturaTraduzioni,
  normalizzaDescrizione,
  normalizzaTitolo,
  type TextTranslations,
} from './proposals';

const proposta = (extra: Partial<TextTranslations> = {}): TextTranslations => ({
  version: 1,
  sourceLanguage: 'it',
  sourceHash: 'h1',
  generatedAt: '2026-10-19T10:00:00.000Z',
  model: { id: 'modello', version: null },
  title: { en: 'Title', de: 'Titel' },
  description: { en: 'Text', de: 'Text DE' },
  ...extra,
});

describe('normalizzaTitolo', () => {
  it('una riga sola, senza caratteri di controllo', () => {
    expect(normalizzaTitolo('  Primo\n  titolo\u0007 ', 'Titolo')).toBe('Primo titolo');
  });

  it("tiene al piu' un «|», e solo se il titolo di partenza ha il sopratitolo", () => {
    expect(normalizzaTitolo('Cycle | The | title', 'Ciclo | Titolo')).toBe(
      'Cycle | The title'
    );
    expect(normalizzaTitolo('Cycle|Title', 'Ciclo|Titolo')).toBe('Cycle|Title');
    expect(normalizzaTitolo('The | title', 'Il titolo')).toBe('The title');
  });

  it('taglia un titolo troppo lungo', () => {
    expect(normalizzaTitolo('a'.repeat(5000), 'x').length).toBe(600);
  });
});

describe('normalizzaDescrizione', () => {
  it('a capo uniformi, niente caratteri di controllo, Markdown intatto (anche i due spazi che vanno a capo)', () => {
    expect(
      normalizzaDescrizione('## Titolo\r\n\r\nRiga  \r\n- voce\u0000\n**forte**\n')
    ).toBe('## Titolo\n\nRiga  \n- voce\n**forte**');
  });
});

describe('letturaTraduzioni', () => {
  it('scarta forme sconosciute e voci non valide', () => {
    expect(letturaTraduzioni(null)).toBeNull();
    expect(letturaTraduzioni({ version: 2 })).toBeNull();
    const letta = letturaTraduzioni({
      ...proposta(),
      title: { en: 'Title', 'NON VALIDA': 'x', fr: '   ', de: 3 },
      model: 'stringa',
    });
    expect(letta?.title).toEqual({ en: 'Title' });
    expect(letta?.model).toEqual({ id: null, version: null });
  });
});
