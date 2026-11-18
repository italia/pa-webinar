// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { regolaConsenso } from './consent-rule';
import { elencoRegistrazione } from './recording-badge';

const evento = {
  eventType: 'SCHEDULED',
  recordingEnabled: true,
  multitrackRecordingEnabled: false,
  participantsCanUnmute: true,
  participantsCanStartVideo: false,
  participantsCanShareScreen: false,
};
const muto = { ...evento, participantsCanUnmute: false };

describe('elencoRegistrazione', () => {
  it("dove chi partecipa puo' parlare e la voce si toglie, per tutti", () => {
    const regola = regolaConsenso(evento, true, 'solo-voce');
    expect(elencoRegistrazione({ regola, istantanea: false, inCorso: false })).toBe(
      'tutti'
    );
  });

  it('dove il pubblico non parla, solo per chi chiede la parola', () => {
    const regola = regolaConsenso(muto, true, 'solo-voce');
    expect(elencoRegistrazione({ regola, istantanea: false, inCorso: true })).toBe(
      'mani'
    );
  });

  it('con il solo ascolto, o senza registrazione, nessuno', () => {
    expect(
      elencoRegistrazione({
        regola: regolaConsenso(evento, true, 'visibili'),
        istantanea: false,
        inCorso: true,
      })
    ).toBe('nessuno');
    expect(
      elencoRegistrazione({
        regola: regolaConsenso(evento, false, 'solo-voce'),
        istantanea: false,
        inCorso: true,
      })
    ).toBe('nessuno');
  });

  it('nella chiamata rapida solo mentre si registra', () => {
    const rapida = { ...evento, eventType: 'INSTANT' };
    const regola = regolaConsenso(rapida, true, 'solo-voce');
    expect(elencoRegistrazione({ regola, istantanea: true, inCorso: false })).toBe(
      'nessuno'
    );
    expect(elencoRegistrazione({ regola, istantanea: true, inCorso: true })).toBe(
      'tutti'
    );
    expect(
      elencoRegistrazione({
        regola: regolaConsenso(rapida, true, 'visibili'),
        istantanea: true,
        inCorso: true,
      })
    ).toBe('nessuno');
  });

  it("dove chi partecipa non entra mai nel video, nessuno: non c'e' un consenso da mostrare", () => {
    for (const [ev, istantanea] of [
      [evento, false],
      [muto, false],
      [{ ...evento, eventType: 'INSTANT' }, true],
    ] as const) {
      const regola = regolaConsenso(ev, true, 'esclusi');
      expect(elencoRegistrazione({ regola, istantanea, inCorso: true })).toBe('nessuno');
    }
  });
});
