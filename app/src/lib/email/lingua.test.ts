import { describe, expect, it } from 'vitest';

import { linguaDaIntestazione, linguaEmail, linguaPagina, lingueIscrizione } from './lingua';

describe('lingua delle email', () => {
  it('usa la lingua della persona quando ha testi email', () => {
    expect(linguaEmail('it')).toBe('it');
    expect(linguaEmail('fr')).toBe('fr');
    expect(linguaEmail('de-AT')).toBe('de');
    expect(linguaEmail('es')).toBe('es');
  });

  it('ricade sull’inglese per le altre lingue e per i valori assenti', () => {
    expect(linguaEmail('pl')).toBe('en');
    expect(linguaEmail('sv')).toBe('en');
    expect(linguaEmail(null)).toBe('en');
    expect(linguaEmail('')).toBe('en');
  });

  it('per i link accetta solo le lingue della piattaforma', () => {
    expect(linguaPagina('pl')).toBe('pl');
    expect(linguaPagina('xx')).toBeNull();
    expect(linguaPagina('../admin')).toBeNull();
  });

  it('dall’intestazione prende la prima lingua della piattaforma', () => {
    expect(linguaDaIntestazione('zh-CN,de;q=0.8,en;q=0.5')).toBe('de');
    expect(linguaDaIntestazione('')).toBeNull();
  });
});

describe('lingue di un’iscrizione', () => {
  it('link nella lingua della pagina, testi nella lingua email', () => {
    expect(lingueIscrizione('pl')).toEqual({ pagina: 'pl', testi: 'en' });
    expect(lingueIscrizione('de')).toEqual({ pagina: 'de', testi: 'de' });
  });

  it('le iscrizioni senza lingua restano sulla lingua predefinita', () => {
    expect(lingueIscrizione(null)).toEqual({ pagina: 'it', testi: 'it' });
  });
});
