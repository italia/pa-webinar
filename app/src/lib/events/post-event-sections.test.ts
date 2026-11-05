// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import { domandePubbliche, sezioniDopoEvento } from './post-event-sections';

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
});
