import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import { campione, righeTrascrizione } from './input';

describe('campione', () => {
  it('tutti se sono pochi, altrimenti distribuiti nel tempo', () => {
    expect(campione([1, 2, 3], 5)).toEqual([1, 2, 3]);
    const c = campione(
      Array.from({ length: 100 }, (_, i) => i),
      10
    );
    expect(c).toHaveLength(10);
    expect(c[0]).toBe(0);
    expect(c[9]).toBe(90);
  });
});

describe('righeTrascrizione', () => {
  it('un turno per voce, con il minuto e il nome dato dallo staff', () => {
    const { lines, truncated } = righeTrascrizione(
      [
        { start: 5, text: 'Buongiorno.', speaker: 'SPEAKER_00' },
        { start: 7, text: 'Cominciamo.', speaker: 'SPEAKER_00' },
        { start: 65, text: 'Una domanda.', speaker: 'SPEAKER_01' },
        { start: 3700, text: 'Grazie.', speaker: 'SPEAKER_02' },
        { start: 3710, text: '   ', speaker: 'SPEAKER_02' },
      ],
      new Map([['SPEAKER_00', 'Relatore 1']])
    );
    expect(truncated).toBe(false);
    expect(lines).toEqual([
      '[00:05] Relatore 1: Buongiorno. Cominciamo.',
      '[01:05] Voce 1: Una domanda.',
      '[1:01:40] Voce 2: Grazie.',
    ]);
  });

  it('si ferma al limite e lo dice', () => {
    const segmenti = Array.from({ length: 50 }, (_, i) => ({
      start: i * 10,
      text: 'parola '.repeat(20),
      speaker: i % 2 ? 'A' : 'B',
    }));
    const { lines, truncated } = righeTrascrizione(segmenti, new Map(), 1000);
    expect(truncated).toBe(true);
    expect(lines.join('\n').length).toBeLessThanOrEqual(1000);
  });

  it('un intervento lungo si spezza in righe con il loro minuto', () => {
    const segmenti = Array.from({ length: 40 }, (_, i) => ({
      start: i * 30,
      text: 'frase di una relazione lunga '.repeat(4),
      speaker: null,
    }));
    const { lines } = righeTrascrizione(segmenti, new Map());
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((l) => l.length < 1700)).toBe(true);
    expect(lines[1]).toMatch(/^\[\d{2}:\d{2}\] Voce: /);
    expect(lines.join(' ').split('frase').length - 1).toBe(160);
  });

  it('non resta mai vuota, nemmeno se la prima riga supera il limite', () => {
    const { lines, truncated } = righeTrascrizione([{ start: 0, text: 'x'.repeat(500), speaker: 'A' }], new Map(), 100);
    expect(truncated).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(100);
  });

  it('un segmento lunghissimo si spezza tra le parole, con il minuto stimato', () => {
    const testo = Array.from({ length: 1000 }, (_, i) => `parola${i}`).join(' ');
    const { lines } = righeTrascrizione([{ start: 0, end: 600, text: testo, speaker: 'A' }], new Map());
    expect(lines.length).toBeGreaterThan(4);
    expect(lines[0]).toMatch(/^\[00:00\] Voce 1: parola0 /);
    expect(lines[lines.length - 1]).toMatch(/^\[(0[89]|10):\d{2}\] Voce 1: /);
    // Nessuna parola tagliata o persa.
    expect(lines.map((l) => l.replace(/^\[[^\]]+\] Voce 1: /, '')).join(' ')).toBe(testo);
  });
});
