// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { conduceSempreRegistrato, testoConsensoEvento } from './consent-rule';

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

describe('conduceSempreRegistrato', () => {
  it('vale dove chi non acconsente resta fuori dal video', () => {
    expect(conduceSempreRegistrato({ hostsAlwaysRecorded: true }, 'rimovibile')).toBe(true);
    expect(conduceSempreRegistrato({ hostsAlwaysRecorded: true, eventType: 'SCHEDULED' }, 'rimovibile')).toBe(true);
    expect(conduceSempreRegistrato({ hostsAlwaysRecorded: true }, 'fissa')).toBe(false);
    expect(conduceSempreRegistrato({ hostsAlwaysRecorded: false }, 'rimovibile')).toBe(false);
  });

  it('mai in una chiamata rapida: chi conduce risponde alla domanda come tutti', () => {
    expect(
      conduceSempreRegistrato({ hostsAlwaysRecorded: true, eventType: 'INSTANT' }, 'rimovibile')
    ).toBe(false);
  });
});
