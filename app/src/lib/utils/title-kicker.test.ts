// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, it, expect } from 'vitest';

import { componiTitolo, dividiTitolo, splitTitleKicker } from './title-kicker';

describe('splitTitleKicker', () => {
  it('returns plain title when disabled', () => {
    expect(splitTitleKicker('Pausa digitale | Test', false)).toEqual({
      kicker: null,
      main: 'Pausa digitale | Test',
    });
  });

  it('returns plain title when no pipe', () => {
    expect(splitTitleKicker('Pausa digitale speciale', true)).toEqual({
      kicker: null,
      main: 'Pausa digitale speciale',
    });
  });

  it('splits on first pipe and trims both parts', () => {
    expect(splitTitleKicker('Pausa digitale speciale | Prova OSS', true)).toEqual({
      kicker: 'Pausa digitale speciale',
      main: 'Prova OSS',
    });
  });

  it('treats additional pipes as part of the main title', () => {
    expect(splitTitleKicker('A | B | C', true)).toEqual({
      kicker: 'A',
      main: 'B | C',
    });
  });

  it('falls back to plain title when kicker half is empty', () => {
    expect(splitTitleKicker(' | Only main', true)).toEqual({
      kicker: null,
      main: ' | Only main',
    });
  });

  it('falls back to plain title when main half is empty', () => {
    expect(splitTitleKicker('Only kicker | ', true)).toEqual({
      kicker: null,
      main: 'Only kicker | ',
    });
  });
});

describe('dividiTitolo e componiTitolo', () => {
  it('dividono e ricompongono il titolo salvato', () => {
    expect(dividiTitolo('Ciclo | Il primo incontro', true)).toEqual({
      sopra: 'Ciclo',
      titolo: 'Il primo incontro',
    });
    expect(componiTitolo('Ciclo', 'Il primo incontro')).toBe('Ciclo | Il primo incontro');
    expect(splitTitleKicker(componiTitolo('Ciclo', 'Il primo incontro'), true)).toEqual({
      kicker: 'Ciclo',
      main: 'Il primo incontro',
    });
  });

  it('con il sopratitolo spento il titolo resta intero', () => {
    expect(dividiTitolo('Q&A | Domande', false)).toEqual({
      sopra: '',
      titolo: 'Q&A | Domande',
    });
  });

  it('un «|» nel titolo resta al titolo: si divide al primo', () => {
    const salvato = componiTitolo('Ciclo', 'Prima | seconda parte');
    expect(dividiTitolo(salvato, true)).toEqual({
      sopra: 'Ciclo',
      titolo: 'Prima | seconda parte',
    });
  });

  it('senza titolo non salva il sopratitolo da solo', () => {
    expect(componiTitolo('Ciclo', '')).toBe('');
    expect(componiTitolo('Ciclo', '  ')).toBe('');
    expect(componiTitolo('', 'Solo titolo')).toBe('Solo titolo');
    expect(componiTitolo('  ', 'Solo titolo')).toBe('Solo titolo');
  });

  it('un titolo che comincia con «|» non ha sopratitolo', () => {
    expect(dividiTitolo('| Titolo', true)).toEqual({ sopra: '', titolo: '| Titolo' });
  });
});
