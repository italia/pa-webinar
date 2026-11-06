// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import en from '@/i18n/messages/en.json';
import it_ from '@/i18n/messages/it.json';

/**
 * I testi della rubrica dicono quello che la rubrica fa: il profilo si aggiorna
 * solo con una nuova spunta, la ricerca guarda il solo ente (il nome e' cifrato),
 * e chi esce perde subito email e inviti ma il resto va via con la corsa del
 * giorno dopo.
 */
describe('i testi della rubrica', () => {
  it('il profilo si aggiorna solo con una nuova spunta', () => {
    expect(it_.admin.rubrica.subtitle).toContain('solo quando la persona spunta');
    expect(en.admin.rubrica.subtitle).toContain('only when the person ticks');
    expect(it_.admin.rubrica.subtitle).not.toContain('ad ogni');
    expect(en.admin.rubrica.subtitle).not.toContain('every');
  });

  it('la ricerca promette il solo ente', () => {
    expect(it_.admin.rubrica.searchLabel).toBe('Cerca per ente');
    expect(en.admin.rubrica.searchLabel).toBe('Search by organization');
  });

  it('chi esce sa cosa va via subito e cosa entro il giorno dopo', () => {
    expect(it_.rubrica.optOut.successBody).toContain('entro il giorno successivo');
    expect(en.rubrica.optOut.successBody).toContain('within one day');
    expect(it_.rubrica.optOut.successBody).not.toContain('non sono più presenti');
    expect(en.rubrica.optOut.successBody).not.toContain('no longer in');
  });
});
