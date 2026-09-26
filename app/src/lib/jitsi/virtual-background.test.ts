import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  SFONDI_VIRTUALI,
  SFONDO_PREDEFINITO,
  leggiSfondo,
  scriviSfondo,
  sfondoDa,
} from './virtual-background';

describe('sfondi virtuali', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('il primo della lista e’ «nessuno», e non ha immagine', () => {
    expect(SFONDI_VIRTUALI[0]?.id).toBe(SFONDO_PREDEFINITO);
    expect(SFONDI_VIRTUALI[0]?.url).toBeNull();
  });

  it('gli identificativi sono unici e i percorsi puntano alla cartella degli sfondi', () => {
    const ids = SFONDI_VIRTUALI.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SFONDI_VIRTUALI.slice(1)) {
      expect(s.url, s.id).toMatch(/^\/images\/virtual-backgrounds\/[a-z-]+\.jpg$/);
    }
  });

  it('un identificativo sconosciuto ricade su «nessuno»', () => {
    // Uno sfondo tolto da una versione all'altra resterebbe altrimenti appeso
    // a un'immagine che dentro la conferenza darebbe 404.
    expect(sfondoDa('sfondo-che-non-esiste').id).toBe(SFONDO_PREDEFINITO);
    expect(sfondoDa(null).id).toBe(SFONDO_PREDEFINITO);
    expect(sfondoDa(undefined).id).toBe(SFONDO_PREDEFINITO);
  });

  it('la scelta sopravvive al giro successivo', () => {
    scriviSfondo('grafite');
    expect(leggiSfondo()).toBe('grafite');
  });

  it('non si memorizza uno sfondo inventato', () => {
    scriviSfondo('qualunque-cosa');
    expect(leggiSfondo()).toBe(SFONDO_PREDEFINITO);
  });

  it('senza memoria locale si continua a funzionare', () => {
    // Navigazione privata, spazio esaurito, criteri d'impresa: leggere o
    // scrivere puo' lanciare, e la sala d'attesa non deve cadere per questo.
    const rotto = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloccato');
    });
    expect(leggiSfondo()).toBe(SFONDO_PREDEFINITO);
    rotto.mockRestore();

    const rottoScrivi = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloccato');
    });
    expect(() => scriviSfondo('grafite')).not.toThrow();
    rottoScrivi.mockRestore();
  });
});
