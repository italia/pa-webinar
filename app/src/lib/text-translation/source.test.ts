// @vitest-environment node
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { improntaSorgente, testoSorgente } from './source';

describe('testo di partenza e impronta', () => {
  it('prende la lingua di partenza, senza spazi ai bordi', () => {
    expect(
      testoSorgente('it', { it: '  Titolo ', en: 'Title' }, { it: 'Testo\n' })
    ).toEqual({
      sourceLanguage: 'it',
      title: 'Titolo',
      description: 'Testo',
    });
    expect(testoSorgente('de', null, undefined)).toEqual({
      sourceLanguage: 'de',
      title: '',
      description: '',
    });
  });

  it("l'impronta e' lo SHA-256 di lingua, titolo e descrizione", () => {
    const atteso = createHash('sha256')
      .update(JSON.stringify(['it', 'Titolo', 'Testo']))
      .digest('hex');
    expect(
      improntaSorgente({ sourceLanguage: 'it', title: 'Titolo', description: 'Testo' })
    ).toBe(atteso);
    // Gli spazi ai bordi non cambiano il testo.
    expect(
      improntaSorgente({
        sourceLanguage: 'it',
        title: ' Titolo ',
        description: 'Testo \n',
      })
    ).toBe(atteso);
    // Lingua, titolo o descrizione diversi: un'altra impronta.
    for (const altro of [
      { sourceLanguage: 'en', title: 'Titolo', description: 'Testo' },
      { sourceLanguage: 'it', title: 'Titolo.', description: 'Testo' },
      { sourceLanguage: 'it', title: 'Titolo', description: 'Testo.' },
    ]) {
      expect(improntaSorgente(altro)).not.toBe(atteso);
    }
  });
});
