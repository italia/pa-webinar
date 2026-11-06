// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import { voceCorrisponde } from '@/lib/persons/ricerca-rubrica';

describe('voceCorrisponde', () => {
  it('guarda ogni campo, senza badare a maiuscole e accenti', () => {
    const campi = ['Nicolò Prova', 'persona@example.org', 'Comune di Forlì'];
    expect(voceCorrisponde(campi, 'nicolo')).toBe(true);
    expect(voceCorrisponde(campi, 'PERSONA@')).toBe(true);
    expect(voceCorrisponde(campi, 'forlì')).toBe(true);
    expect(voceCorrisponde(campi, 'regione')).toBe(false);
  });

  it('i campi vuoti non corrispondono a niente', () => {
    expect(voceCorrisponde([null, undefined, ''], 'a')).toBe(false);
  });
});
