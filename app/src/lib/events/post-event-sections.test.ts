// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import {
  domandePubblicateInSala,
  domandePubbliche,
  sezioniDopoEvento,
} from './post-event-sections';

const tutte = { recap: true, qa: true, polls: true, wordCloud: true, materials: true, feedback: true };

describe('sezioni della pagina dopo l\'evento', () => {
  it('tutte, quando chi organizza le mostra tutte', () => {
    expect(sezioniDopoEvento(tutte)).toEqual(['recap', 'qa', 'polls', 'wordCloud', 'materials', 'feedback']);
  });

  it('la scelta di chi organizza vale, nell\'ordine della pagina', () => {
    expect(sezioniDopoEvento({ ...tutte, polls: false, recap: false })).toEqual([
      'qa',
      'wordCloud',
      'materials',
      'feedback',
    ]);
  });
});

describe('domande sulla pagina dopo l\'evento', () => {
  const evento = {
    postEventShowQA: true,
    qaEnabled: true,
    recordingDestination: 'PUBLIC' as 'PUBLIC' | 'REGISTRANTS' | null,
    recordingAudience: 'PUBLIC' as 'PUBLIC' | 'REGISTRANTS',
  };

  it('si pubblicano se chi organizza le mostra e la registrazione non e\' riservata', () => {
    expect(domandePubbliche(evento)).toBe(true);
    expect(domandePubbliche({ ...evento, recordingDestination: null })).toBe(true);
  });

  it('con l\'interruttore spento o senza Q&A no', () => {
    expect(domandePubbliche({ ...evento, postEventShowQA: false })).toBe(false);
    expect(domandePubbliche({ ...evento, qaEnabled: false })).toBe(false);
  });

  it('con la registrazione riservata no, anche con l\'interruttore acceso', () => {
    expect(domandePubbliche({ ...evento, recordingDestination: 'REGISTRANTS' })).toBe(false);
  });

  it('con il video reso riservato dal pubblico no, anche su destinazione pubblica', () => {
    expect(domandePubbliche({ ...evento, recordingAudience: 'REGISTRANTS' })).toBe(false);
  });

  it('con il pubblico riservato no, anche senza destinazione', () => {
    expect(
      domandePubbliche({
        ...evento,
        recordingDestination: null,
        recordingAudience: 'REGISTRANTS',
      }),
    ).toBe(false);
  });
});

describe('domande in sala: si puo\' dire che compaiono sulla pagina', () => {
  const scheda = (esitoDomande: 'soloTesto' | 'nonPubblicate') => ({ chat: { esitoDomande } });

  it('lo dice la scheda, anche per un Q&A aperto dal vivo', () => {
    expect(
      domandePubblicateInSala({
        schedaPrivacy: scheda('soloTesto'),
        postEventShow: { qa: false },
      }),
    ).toBe(true);
    expect(
      domandePubblicateInSala({
        schedaPrivacy: scheda('nonPubblicate'),
        postEventShow: { qa: true },
      }),
    ).toBe(false);
  });

  it('senza scheda, nelle chiamate rapide, segue la sezione della pagina', () => {
    expect(domandePubblicateInSala({ schedaPrivacy: null, postEventShow: { qa: false } })).toBe(false);
    expect(domandePubblicateInSala({ schedaPrivacy: null, postEventShow: { qa: true } })).toBe(true);
  });

  it('senza dati resta l\'avviso piu\' prudente', () => {
    expect(domandePubblicateInSala({})).toBe(true);
  });
});
