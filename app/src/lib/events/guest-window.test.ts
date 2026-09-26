import { describe, expect, it } from 'vitest';

import { guestAccessAllowed, guestWindowOpen } from './guest-window';

const aCalendario = (status: string) => ({ status, eventType: 'SCHEDULED' });
const rapida = (status: string) => ({ status, eventType: 'INSTANT' });

describe('guestAccessAllowed', () => {
  it("un evento a calendario ammette ospiti solo se l'amministrazione lo consente", () => {
    expect(guestAccessAllowed({ eventType: 'SCHEDULED' }, true)).toBe(true);
    expect(guestAccessAllowed({ eventType: 'SCHEDULED' }, false)).toBe(false);
  });

  it("una chiamata rapida resta aperta a chi ha il link, qualunque sia l'impostazione", () => {
    expect(guestAccessAllowed({ eventType: 'INSTANT' }, true)).toBe(true);
    expect(guestAccessAllowed({ eventType: 'INSTANT' }, false)).toBe(true);
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
