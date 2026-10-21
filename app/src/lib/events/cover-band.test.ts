import { describe, expect, it } from 'vitest';

import { rapportoFasciaCopertina } from './cover-band';

describe('rapportoFasciaCopertina', () => {
  it('senza misure, la fascia di un portatile comune (1366 × 768)', () => {
    // Contenitore 1176 meno margini 26; alta il 38% di 768.
    expect(rapportoFasciaCopertina()).toBeCloseTo(1150 / (768 * 0.38));
  });

  it('su uno schermo largo e alto, al massimo 340 px', () => {
    expect(rapportoFasciaCopertina({ width: 1920, height: 1080 })).toBeCloseTo(
      1294 / 340
    );
  });

  it('uno schermo stretto non vale: si usa quello di riferimento', () => {
    expect(rapportoFasciaCopertina({ width: 390, height: 844 })).toBeCloseTo(
      rapportoFasciaCopertina()
    );
  });
});
