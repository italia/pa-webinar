// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { conduceNelVideo, testoConsensoEvento, voceDi } from './consent-rule';

describe('testoConsensoEvento', () => {
  it.each(['solo-voce', 'visibili'] as const)('con la casella (%s) resta', (partecipanti) => {
    expect(testoConsensoEvento("Testo dell'ente.", partecipanti)).toBe("Testo dell'ente.");
  });

  it('senza un video non si mostra', () => {
    expect(testoConsensoEvento("Testo dell'ente.", 'assente')).toBeNull();
  });

  it('dove chi partecipa non entra mai nel video non c\'e\' la casella che lo copre', () => {
    expect(testoConsensoEvento("Testo dell'ente.", 'esclusi')).toBeNull();
  });

  it.each([null, undefined, '', '   '])(
    'un testo vuoto vale come assente: %j',
    (testo) => {
      expect(testoConsensoEvento(testo, 'visibili')).toBeNull();
    }
  );
});

describe('conduceNelVideo', () => {
  it('chi conduce e\' nel video dove c\'e\' un video, qualunque cosa dica l\'evento', () => {
    for (const partecipanti of ['solo-voce', 'esclusi', 'visibili'] as const) {
      expect(conduceNelVideo(partecipanti)).toBe(true);
    }
  });

  it('senza un video completo restano le tracce, che seguono il consenso alla trascrizione', () => {
    expect(conduceNelVideo('assente')).toBe(false);
  });
});

describe('voceDi', () => {
  it('la voce di chi non acconsente si ricava dalla capacita\' dell\'installazione', () => {
    expect(voceDi('solo-voce')).toBe('rimovibile');
    expect(voceDi('esclusi')).toBe('rimovibile');
    expect(voceDi('visibili')).toBe('fissa');
    expect(voceDi('assente')).toBe('assente');
  });
});
