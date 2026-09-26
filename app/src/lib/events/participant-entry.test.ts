import { describe, it, expect } from 'vitest';

import {
  callInviteOpen,
  moderatorRoomOpen,
  participantEntry,
  shareLink,
  type ParticipantEntryEvent,
} from './participant-entry';

const NOW = Date.parse('2026-06-01T10:00:00Z');
const FUTURE = new Date(NOW + 3_600_000).toISOString();
const PAST = new Date(NOW - 3_600_000).toISOString();

function ev(over: Partial<ParticipantEntryEvent> = {}): ParticipantEntryEvent {
  return {
    slug: 'evento',
    status: 'PUBLISHED',
    eventType: 'SCHEDULED',
    endsAt: FUTURE,
    postEventPublic: false,
    postEventPublicUntil: null,
    ...over,
  };
}

const ROOM = { kind: 'room', path: '/events/evento/live' };
const PAGE = { kind: 'page', path: '/events/evento' };

describe('participantEntry — evento a calendario', () => {
  it('in diretta, con gli ospiti ammessi, si entra in sala come ospite', () => {
    expect(participantEntry(ev({ status: 'LIVE' }), true, NOW)).toEqual(ROOM);
  });

  it('in diretta, senza ospiti, si passa dalla pagina pubblica (iscrizione)', () => {
    expect(participantEntry(ev({ status: 'LIVE' }), false, NOW)).toEqual(PAGE);
  });

  it('prima della diretta, in allestimento o in pausa, la porta e\' la pagina pubblica', () => {
    for (const status of ['PUBLISHED', 'PROVISIONING', 'IDLE']) {
      expect(participantEntry(ev({ status }), true, NOW)).toEqual(PAGE);
    }
  });

  it('in bozza o archiviato non c\'e\' un ingresso da partecipante', () => {
    for (const status of ['DRAFT', 'ARCHIVED']) {
      expect(participantEntry(ev({ status }), true, NOW)).toBeNull();
    }
  });

  it('incagliato in pausa oltre la fine: la pagina risponde «non trovato», niente ingresso', () => {
    expect(participantEntry(ev({ status: 'IDLE', endsAt: PAST }), true, NOW)).toBeNull();
  });

  it('concluso: la pagina post-evento finche\' e\' pubblica e nella sua finestra', () => {
    expect(participantEntry(ev({ status: 'ENDED', postEventPublic: true }), true, NOW)).toEqual(PAGE);
    expect(participantEntry(ev({ status: 'ENDED', postEventPublic: false }), true, NOW)).toBeNull();
    expect(
      participantEntry(
        ev({ status: 'ENDED', postEventPublic: true, postEventPublicUntil: PAST }),
        true,
        NOW,
      ),
    ).toBeNull();
  });

  it('la finestra a tempo si valuta sull\'istante passato, non sull\'orologio', () => {
    const scadenza = new Date(NOW + 60_000).toISOString();
    const concluso = ev({ status: 'ENDED', postEventPublic: true, postEventPublicUntil: scadenza });
    expect(participantEntry(concluso, true, NOW)).toEqual(PAGE);
    expect(participantEntry(concluso, true, NOW + 120_000)).toBeNull();
  });
});

describe('participantEntry — chiamata rapida', () => {
  it('aperta (diretta, avvio, pausa): si entra dal link della sala anche con gli ospiti spenti', () => {
    for (const status of ['LIVE', 'PROVISIONING', 'IDLE']) {
      // Per una chiamata rapida guestAccessAllowed e' sempre vero: la pagina
      // di gestione lo passa gia' risolto.
      expect(participantEntry(ev({ status, eventType: 'INSTANT' }), true, NOW)).toEqual(ROOM);
    }
  });

  it('in avvio o in pausa oltre la fine la sala non si accende piu\': niente invito', () => {
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(
        participantEntry(ev({ status, eventType: 'INSTANT', endsAt: PAST }), true, NOW),
      ).toBeNull();
    }
  });

  it('in diretta oltre la fine (chiamata a durata aperta) si entra ancora', () => {
    expect(
      participantEntry(ev({ status: 'LIVE', eventType: 'INSTANT', endsAt: PAST }), true, NOW),
    ).toEqual(ROOM);
  });

  it('la fine si valuta sull\'istante passato, non sull\'orologio', () => {
    const pausa = ev({ status: 'IDLE', eventType: 'INSTANT', endsAt: new Date(NOW + 60_000).toISOString() });
    expect(participantEntry(pausa, true, NOW)).toEqual(ROOM);
    expect(participantEntry(pausa, true, NOW + 120_000)).toBeNull();
  });

  it('conclusa: solo la pagina post-evento, se e\' stata resa pubblica', () => {
    expect(
      participantEntry(ev({ status: 'ENDED', eventType: 'INSTANT', postEventPublic: true }), true, NOW),
    ).toEqual(PAGE);
    expect(
      participantEntry(ev({ status: 'ENDED', eventType: 'INSTANT' }), true, NOW),
    ).toBeNull();
  });
});

describe('shareLink e callInviteOpen', () => {
  const INVITE = { kind: 'invite', path: '/events/evento/live' };

  it('evento a calendario: sempre la pagina pubblica, bozza e concluso compresi', () => {
    for (const status of ['DRAFT', 'PUBLISHED', 'LIVE', 'IDLE', 'ENDED', 'ARCHIVED']) {
      expect(shareLink(ev({ status }), NOW)).toEqual(PAGE);
      expect(callInviteOpen(ev({ status }), NOW)).toBe(false);
    }
  });

  it('chiamata rapida aperta: l\'invito alla sala', () => {
    for (const status of ['LIVE', 'PROVISIONING', 'IDLE']) {
      const call = ev({ status, eventType: 'INSTANT' });
      expect(shareLink(call, NOW)).toEqual(INVITE);
      expect(callInviteOpen(call, NOW)).toBe(true);
    }
  });

  it('chiamata rapida chiusa senza pagina post-evento: niente da condividere', () => {
    // L'invito di una chiamata conclusa risponde «non trovato»: e' lo stato in
    // cui nasce ogni chiamata finita (postEventPublic spento).
    for (const status of ['ENDED', 'ARCHIVED', 'DRAFT', 'PUBLISHED']) {
      const call = ev({ status, eventType: 'INSTANT' });
      expect(shareLink(call, NOW)).toBeNull();
      expect(callInviteOpen(call, NOW)).toBe(false);
    }
  });

  it('chiamata rapida conclusa con pagina post-evento pubblica: quella pagina', () => {
    const call = ev({ status: 'ENDED', eventType: 'INSTANT', postEventPublic: true });
    expect(shareLink(call, NOW)).toEqual(PAGE);
    // Scaduta la finestra della pagina, torna a non esserci niente.
    const scaduta = ev({ ...call, postEventPublicUntil: PAST });
    expect(shareLink(scaduta, NOW)).toBeNull();
  });

  it('chiamata rapida incagliata in pausa oltre la fine: niente invito', () => {
    const call = ev({ status: 'IDLE', eventType: 'INSTANT', endsAt: PAST });
    expect(shareLink(call, NOW)).toBeNull();
    expect(callInviteOpen(call, NOW)).toBe(false);
  });
});

describe('moderatorRoomOpen', () => {
  it('chi conduce entra da pubblicato fino alla diretta, pausa compresa', () => {
    for (const eventType of ['SCHEDULED', 'INSTANT']) {
      for (const status of ['PUBLISHED', 'PROVISIONING', 'IDLE', 'LIVE']) {
        expect(moderatorRoomOpen(ev({ status, eventType }), NOW)).toBe(true);
      }
    }
  });

  it('non in bozza, a evento concluso o archiviato', () => {
    for (const status of ['DRAFT', 'ENDED', 'ARCHIVED']) {
      expect(moderatorRoomOpen(ev({ status }), NOW)).toBe(false);
    }
  });

  it('incagliato in allestimento o in pausa oltre la fine: la sala non si accende, niente ingresso', () => {
    for (const eventType of ['SCHEDULED', 'INSTANT']) {
      for (const status of ['PROVISIONING', 'IDLE']) {
        expect(moderatorRoomOpen(ev({ status, eventType, endsAt: PAST }), NOW)).toBe(false);
      }
    }
  });

  it('oltre la fine si entra ancora in diretta (tempo supplementare) e da pubblicato (lo si avvia dalla sala d\'attesa)', () => {
    for (const status of ['LIVE', 'PUBLISHED']) {
      expect(moderatorRoomOpen(ev({ status, endsAt: PAST }), NOW)).toBe(true);
    }
  });

  it('coerente con l\'ingresso da partecipante sullo stesso evento incagliato', () => {
    const incagliato = ev({ status: 'IDLE', endsAt: PAST });
    expect(moderatorRoomOpen(incagliato, NOW)).toBe(false);
    expect(participantEntry(incagliato, true, NOW)).toBeNull();
  });
});
