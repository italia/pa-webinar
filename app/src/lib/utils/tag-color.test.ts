import { describe, expect, it } from 'vitest';

import { fondoEtichettaPiena, hexWithAlpha, inchiostroEtichetta } from './tag-color';

function canale(hex: string, i: number): number {
  const s = parseInt(hex.slice(i, i + 2), 16) / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminanza(hex: string): number {
  return 0.2126 * canale(hex, 1) + 0.7152 * canale(hex, 3) + 0.0722 * canale(hex, 5);
}
function contrasto(a: string, b: string): number {
  const [la, lb] = [luminanza(a), luminanza(b)] as const;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function tinta(hex: string, alpha: number): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${c
    .map((v) =>
      Math.round(v * alpha + 255 * (1 - alpha))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

describe('colori delle etichette', () => {
  it('hexWithAlpha accetta #rgb e #rrggbb e lascia stare il resto', () => {
    expect(hexWithAlpha('#008758', 0.1)).toBe('rgba(0, 135, 88, 0.1)');
    expect(hexWithAlpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
    expect(hexWithAlpha('red', 0.5)).toBe('red');
  });

  it('scurisce il testo quanto basta per stare sopra 4,5:1 sulla tinta', () => {
    for (const colore of [
      '#008758',
      '#0066cc',
      '#d1a60a',
      '#a66300',
      '#5a768a',
      '#ff0000',
      '#ffffff',
    ]) {
      for (const alpha of [0.1, 0.15, 0.13]) {
        const testo = inchiostroEtichetta(colore, alpha);
        expect(contrasto(testo, tinta(colore, alpha))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('un colore già scuro resta lo stesso', () => {
    expect(inchiostroEtichetta('#003366', 0.1)).toBe('#003366');
    expect(fondoEtichettaPiena('#003366')).toBe('#003366');
  });

  it('il fondo pieno regge il testo bianco', () => {
    for (const colore of ['#008758', '#d1a60a', '#ffffff', '#0066cc']) {
      expect(contrasto(fondoEtichettaPiena(colore), '#ffffff')).toBeGreaterThanOrEqual(
        4.5
      );
    }
  });

  it("un colore non valido torna com'era", () => {
    expect(inchiostroEtichetta('blu', 0.1)).toBe('blu');
    expect(fondoEtichettaPiena('')).toBe('');
  });
});
