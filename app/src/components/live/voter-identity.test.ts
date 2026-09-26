import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  registrationAccessToken,
  voterIdentity,
  voterIdStorageKey,
  type RoomSeat,
} from './voter-identity';

/**
 * Con quale identità si vota e si scrive nella nuvola, per ogni posto in sala.
 *
 * È la regola che decide se relatori e moderatori scrivono o prendono un 403:
 * il loro token di sala non è una registrazione, e mandarlo come
 * `accessToken` era il difetto per cui la nuvola restava vuota.
 */

const identita = (seat: RoomSeat) =>
  voterIdentity(registrationAccessToken(seat), 'guest_browser');

const posto = (campi: Partial<RoomSeat>): RoomSeat => ({
  token: '',
  isGuest: false,
  isModerator: false,
  isSpeaker: false,
  ...campi,
});

describe('identità di voto per posto in sala', () => {
  it("l'iscritto vota con la propria registrazione", () => {
    expect(identita(posto({ token: 'ALICE' }))).toEqual({ voterAccessToken: 'ALICE' });
  });

  it('il moderatore vota col browser: il suo link non è una registrazione', () => {
    expect(identita(posto({ token: 'TOKEN_MODERATORE', isModerator: true }))).toEqual({
      voterGuestId: 'guest_browser',
    });
  });

  it('il relatore vota col browser: il suo grant non è una registrazione', () => {
    expect(identita(posto({ token: 'TOKEN_RELATORE', isSpeaker: true }))).toEqual({
      voterGuestId: 'guest_browser',
    });
  });

  it("l'ospite vota col browser", () => {
    expect(identita(posto({ isGuest: true }))).toEqual({ voterGuestId: 'guest_browser' });
    // Anche se, per qualunque motivo, un token gli arrivasse.
    expect(identita(posto({ isGuest: true, token: 'QUALCOSA' }))).toEqual({
      voterGuestId: 'guest_browser',
    });
  });

  it('senza token non c’è registrazione da usare', () => {
    expect(identita(posto({}))).toEqual({ voterGuestId: 'guest_browser' });
  });

  it('il token di sala di chi conduce non diventa mai un accessToken', () => {
    for (const ruolo of [{ isModerator: true }, { isSpeaker: true }, { isGuest: true }]) {
      expect(registrationAccessToken(posto({ token: 'TOKEN_SALA', ...ruolo }))).toBeUndefined();
    }
  });
});

describe('dove il browser tiene l’identificativo', () => {
  it('moderatore, relatore e ospite non condividono la chiave', () => {
    // «Entra come partecipante» apre la sala da ospite nello stesso browser di
    // chi conduce: con una chiave sola l'anteprima avrebbe i voti del moderatore.
    const chiavi = [
      voterIdStorageKey(posto({ isModerator: true })),
      voterIdStorageKey(posto({ isSpeaker: true })),
      voterIdStorageKey(posto({ isGuest: true })),
    ];
    expect(new Set(chiavi).size).toBe(3);
  });

  it('l’ospite resta sulla chiave di sempre', () => {
    // Un ospite già in sala non perde voti e reazioni con l'aggiornamento.
    expect(voterIdStorageKey(posto({ isGuest: true }))).toBe('paw_guest_id');
  });
});

describe('la sala usa questa regola', () => {
  // Spazi normalizzati: un a capo in più non è un cambio di comportamento.
  const src = readFileSync(path.join(__dirname, 'live-event-client.tsx'), 'utf8').replace(
    /\s+/g,
    ' ',
  );

  it("ricava la registrazione da qui, col ruolo di chi è in sala", () => {
    expect(src).toMatch(
      /const registeredAccessToken = registrationAccessToken\(\{ ?token, isGuest, isModerator, isSpeaker,? ?\}\)/,
    );
  });

  it('tiene l’identificativo sotto la chiave del proprio ruolo', () => {
    expect(src).toContain('voterIdStorageKey({ isModerator, isSpeaker })');
    expect(src).not.toMatch(/const k = 'paw_guest_id'/);
  });

  it("passa ai pannelli l'identità ricavata da qui, e nient'altro", () => {
    const barra = src.match(/<LiveSidebar [\s\S]*?\/>/)?.[0] ?? '';
    expect(barra).toContain('{...voterIdentity(registeredAccessToken, guestId)}');
    // Una prop esplicita accanto — `voterAccessToken={token}` — la
    // scavalcherebbe: era la forma del difetto.
    expect(barra).not.toMatch(/voterAccessToken=|voterGuestId=/);
  });
});
