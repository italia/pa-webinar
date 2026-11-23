// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import { guestAccessAllowed, guestWindowOpen } from './guest-window';

const NOW = Date.parse('2026-06-01T10:00:00Z');
const FINE = new Date(NOW + 3_600_000).toISOString();
const PASSATA = new Date(NOW - 60_000).toISOString();

const aCalendario = (status: string, accessMode: string | null = null, endsAt = FINE) => ({
  status,
  eventType: 'SCHEDULED',
  accessMode,
  endsAt,
});
const rapida = (status: string, endsAt = FINE) => ({
  status,
  eventType: 'INSTANT',
  accessMode: null,
  endsAt,
});

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
  it('evento a calendario: aperta dalla sala d’attesa, in diretta e in pausa', () => {
    for (const status of ['PROVISIONING', 'LIVE', 'IDLE']) {
      expect(guestWindowOpen(aCalendario(status), true, NOW), status).toBe(true);
    }
    // Prima che la sala si apra si passa dall'iscrizione; dopo, e' chiusa.
    for (const status of ['DRAFT', 'PUBLISHED', 'ENDED', 'ARCHIVED']) {
      expect(guestWindowOpen(aCalendario(status), true, NOW), status).toBe(false);
    }
  });

  it('evento a calendario con gli ospiti spenti: chiusa anche a sala aperta', () => {
    for (const status of ['PROVISIONING', 'LIVE', 'IDLE']) {
      expect(guestWindowOpen(aCalendario(status), false, NOW), status).toBe(false);
    }
  });

  it('evento solo su invito: chiusa anche a sala aperta, con gli ospiti accesi dal sito', () => {
    for (const status of ['PROVISIONING', 'LIVE', 'IDLE']) {
      expect(guestWindowOpen(aCalendario(status, 'INVITATION'), true, NOW), status).toBe(false);
    }
  });

  it('chiamata rapida: aperta in diretta e durante la preparazione, anche con gli ospiti spenti', () => {
    for (const enabled of [true, false]) {
      for (const status of ['LIVE', 'PROVISIONING', 'IDLE']) {
        expect(guestWindowOpen(rapida(status), enabled, NOW), `${status}/${enabled}`).toBe(true);
      }
      for (const status of ['ENDED', 'ARCHIVED']) {
        expect(guestWindowOpen(rapida(status), enabled, NOW), `${status}/${enabled}`).toBe(false);
      }
    }
  });

  it('oltre la fine, in allestimento o in pausa, è chiusa: la sala non si riaprirebbe', () => {
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(guestWindowOpen(aCalendario(status, null, PASSATA), true, NOW), status).toBe(false);
      expect(guestWindowOpen(rapida(status, PASSATA), true, NOW), status).toBe(false);
    }
    // In diretta, nel fuori orario, resta aperta finché la sala è viva.
    expect(guestWindowOpen(aCalendario('LIVE', null, PASSATA), true, NOW)).toBe(true);
    expect(guestWindowOpen(rapida('LIVE', PASSATA), true, NOW)).toBe(true);
  });
});
