import { describe, expect, it } from 'vitest';

import { sezioniDopoEvento } from './post-event-sections';

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
