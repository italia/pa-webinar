// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import {
  VASTA_SCALA,
  elencoPredefinito,
  elencoVisibileAlPubblico,
  nicknamePredefinito,
} from './participant-list';

describe('elencoVisibileAlPubblico', () => {
  it("di default e' nascosto", () => {
    expect(elencoVisibileAlPubblico({})).toBe(false);
    expect(
      elencoVisibileAlPubblico({ participantListVisible: false, eventType: 'SCHEDULED' })
    ).toBe(false);
    expect(elencoVisibileAlPubblico({ participantListVisible: null })).toBe(false);
  });

  it('lo mostra la scelta di chi organizza', () => {
    expect(elencoVisibileAlPubblico({ participantListVisible: true })).toBe(true);
  });

  it('con gli pseudonimi resta nascosto, anche se scelto', () => {
    expect(
      elencoVisibileAlPubblico({ participantListVisible: true, audienceAnonymous: true })
    ).toBe(false);
    expect(
      elencoVisibileAlPubblico({ audienceAnonymous: true, eventType: 'INSTANT' })
    ).toBe(false);
  });

  it('nelle chiamate rapide resta visibile', () => {
    expect(elencoVisibileAlPubblico({ eventType: 'INSTANT' })).toBe(true);
  });
});

describe('elencoPredefinito', () => {
  it('si vede dove chi partecipa parla o si mostra', () => {
    expect(elencoPredefinito({ participantsCanUnmute: true })).toBe(true);
    expect(elencoPredefinito({ participantsCanStartVideo: true })).toBe(true);
  });

  it('resta nascosto su vasta scala, anche se parlano tutti', () => {
    expect(elencoPredefinito({ participantsCanUnmute: true, maxParticipants: 100 })).toBe(true);
    expect(elencoPredefinito({ participantsCanUnmute: true, maxParticipants: 300 })).toBe(false);
    expect(elencoPredefinito({ participantsCanUnmute: true, maxParticipants: VASTA_SCALA - 1 })).toBe(true);
    expect(elencoPredefinito({ participantsCanUnmute: true, maxParticipants: VASTA_SCALA })).toBe(false);
  });

  it('resta nascosto dove il pubblico ascolta soltanto', () => {
    expect(elencoPredefinito({})).toBe(false);
    expect(elencoPredefinito({ participantsCanUnmute: false, participantsCanStartVideo: false })).toBe(false);
  });
});

describe('nicknamePredefinito', () => {
  it("acceso dove l'elenco e' nascosto e col pubblico anonimo", () => {
    expect(nicknamePredefinito({ participantListVisible: false })).toBe(true);
    expect(nicknamePredefinito({ participantListVisible: true, audienceAnonymous: true })).toBe(true);
  });

  it("spento dove ci si vede per nome, e nelle chiamate rapide", () => {
    expect(nicknamePredefinito({ participantListVisible: true })).toBe(false);
    expect(nicknamePredefinito({ eventType: 'INSTANT' })).toBe(false);
  });
});
