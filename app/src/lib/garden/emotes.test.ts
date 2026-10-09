import { describe, expect, it } from 'vitest';

// Dai sorgenti della piazza, non dal pacchetto: l'indice tira dentro Phaser.
import { EMOTE_KEY } from '../../../../lobby/src/lobby/emotes';
import { EMOTE_TYPES } from '../../../../lobby/src/lobby/ports/types';

import { GARDEN_EMOTE_TYPES, isGardenEmote } from './emotes';

describe('gesti della piazza', () => {
  it('il server ripete esattamente i gesti che la piazza sa mostrare', () => {
    // Un gesto nuovo nella piazza ma non qui non arriverebbe mai agli altri;
    // uno qui ma non nella piazza arriverebbe a chi non sa disegnarlo.
    expect([...GARDEN_EMOTE_TYPES].sort()).toEqual([...EMOTE_TYPES].sort());
    for (const tipo of EMOTE_TYPES) expect(EMOTE_KEY[tipo]).toMatch(/^[a-z]$/);
  });

  it('riconosce solo i gesti dell’elenco', () => {
    expect(isGardenEmote('clap')).toBe(true);
    expect(isGardenEmote('rickroll')).toBe(false);
    expect(isGardenEmote('')).toBe(false);
  });
});
