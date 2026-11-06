// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import {
  domandePubblicabili,
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

describe('domande pubblicabili: il Q&A si puo\' aprire dal vivo', () => {
  const evento = {
    postEventShowQA: true,
    recordingDestination: null,
    recordingAudience: 'PUBLIC',
  } as const;

  it('non dipendono dal Q&A acceso alla creazione', () => {
    expect(domandePubbliche({ ...evento, qaEnabled: false })).toBe(false);
    expect(domandePubblicabili(evento)).toBe(true);
  });

  it('restano fuori se chi organizza non le mostra o la registrazione e\' riservata', () => {
    expect(domandePubblicabili({ ...evento, postEventShowQA: false })).toBe(false);
    expect(domandePubblicabili({ ...evento, recordingDestination: 'REGISTRANTS' })).toBe(false);
    expect(domandePubblicabili({ ...evento, recordingAudience: 'REGISTRANTS' })).toBe(false);
  });
});

describe('domande in sala: si puo\' dire che compaiono sulla pagina', () => {
  it('lo dice il valore calcolato dal server', () => {
    expect(domandePubblicateInSala({ domandePubblicabili: true })).toBe(true);
    expect(domandePubblicateInSala({ domandePubblicabili: false })).toBe(false);
  });

  it('senza dati resta l\'avviso piu\' prudente', () => {
    expect(domandePubblicateInSala({})).toBe(true);
  });
});
