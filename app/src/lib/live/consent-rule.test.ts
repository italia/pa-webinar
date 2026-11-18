// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { conduceNelVideo, testoConsensoEvento } from './consent-rule';

describe('testoConsensoEvento', () => {
  it.each(['rimovibile', 'fissa'] as const)('con un video (%s) resta', (voce) => {
    expect(testoConsensoEvento("Testo dell'ente.", voce)).toBe("Testo dell'ente.");
  });

  it('senza un video non si mostra', () => {
    expect(testoConsensoEvento("Testo dell'ente.", 'assente')).toBeNull();
  });

  it.each([null, undefined, '', '   '])(
    'un testo vuoto vale come assente: %j',
    (testo) => {
      expect(testoConsensoEvento(testo, 'fissa')).toBeNull();
    }
  );
});

describe('conduceNelVideo', () => {
  it('chi conduce e\' nel video dove c\'e\' un video, qualunque cosa dica l\'evento', () => {
    expect(conduceNelVideo('rimovibile')).toBe(true);
    expect(conduceNelVideo('fissa')).toBe(true);
  });

  it('senza un video completo restano le tracce, che seguono il consenso alla trascrizione', () => {
    expect(conduceNelVideo('assente')).toBe(false);
  });
});
