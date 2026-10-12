import { describe, expect, it } from 'vitest';

import { guestAccessAllowed, guestWindowOpen } from './guest-window';

const aCalendario = (status: string, accessMode: string | null = null) => ({
  status,
  eventType: 'SCHEDULED',
  accessMode,
});
const rapida = (status: string) => ({ status, eventType: 'INSTANT', accessMode: null });

describe('guestAccessAllowed', () => {
  it("un evento a calendario ammette ospiti solo se l'amministrazione lo consente", () => {
    expect(guestAccessAllowed({ eventType: 'SCHEDULED', accessMode: null }, true)).toBe(true);
    expect(guestAccessAllowed({ eventType: 'SCHEDULED', accessMode: null }, false)).toBe(false);
  });

  it("un evento solo su invito non ammette ospiti, qualunque sia l'impostazione del sito", () => {
    expect(guestAccessAllowed({ eventType: 'SCHEDULED', accessMode: 'INVITATION' }, true)).toBe(false);
    // Aperto a tutti non accende gli ospiti spenti dal sito: riguarda l'iscrizione.
    expect(guestAccessAllowed({ eventType: 'SCHEDULED', accessMode: 'OPEN' }, false)).toBe(false);
    expect(guestAccessAllowed({ eventType: 'SCHEDULED', accessMode: 'OPEN' }, true)).toBe(true);
  });

  it("una chiamata rapida resta aperta a chi ha il link, qualunque sia l'impostazione", () => {
    expect(guestAccessAllowed({ eventType: 'INSTANT', accessMode: null }, true)).toBe(true);
    expect(guestAccessAllowed({ eventType: 'INSTANT', accessMode: null }, false)).toBe(true);
  });
});

describe('guestWindowOpen', () => {
  it('evento a calendario: aperta solo in diretta', () => {
    expect(guestWindowOpen(aCalendario('LIVE'), true)).toBe(true);
    for (const status of ['DRAFT', 'PUBLISHED', 'PROVISIONING', 'IDLE', 'ENDED', 'ARCHIVED']) {
      expect(guestWindowOpen(aCalendario(status), true), status).toBe(false);
    }
  });

  it('evento a calendario con gli ospiti spenti: chiusa anche in diretta', () => {
    expect(guestWindowOpen(aCalendario('LIVE'), false)).toBe(false);
  });

  it('evento solo su invito: chiusa anche in diretta, con gli ospiti accesi dal sito', () => {
    expect(guestWindowOpen(aCalendario('LIVE', 'INVITATION'), true)).toBe(false);
  });

  it('chiamata rapida: aperta in diretta e durante la preparazione, anche con gli ospiti spenti', () => {
    for (const enabled of [true, false]) {
      for (const status of ['LIVE', 'PROVISIONING', 'IDLE']) {
        expect(guestWindowOpen(rapida(status), enabled), `${status}/${enabled}`).toBe(true);
      }
      for (const status of ['ENDED', 'ARCHIVED']) {
        expect(guestWindowOpen(rapida(status), enabled), `${status}/${enabled}`).toBe(false);
      }
    }
  });
});
