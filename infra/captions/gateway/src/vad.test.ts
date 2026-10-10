import { describe, expect, it } from 'vitest';

import { levelDbfs, VoiceDetector } from './vad.js';

/** 20 ms a 16 kHz: un tono all'ampiezza data, o rumore bianco. */
function frame(amplitude: number, kind: 'tone' | 'noise' = 'tone', seed = 1): Buffer {
  const out = Buffer.alloc(320 * 2);
  let x = seed;
  for (let i = 0; i < 320; i++) {
    let v: number;
    if (kind === 'tone') v = Math.sin((2 * Math.PI * 220 * i) / 16000);
    else {
      x = (x * 1103515245 + 12345) % 2147483648;
      v = (x / 2147483648) * 2 - 1;
    }
    out.writeInt16LE(Math.round(v * amplitude * 32767), i * 2);
  }
  return out;
}

const options = { minDbfs: -55, marginDb: 10 };

describe('levelDbfs', () => {
  it('misura il livello RMS', () => {
    expect(levelDbfs(frame(1))).toBeCloseTo(-3, 0);
    expect(levelDbfs(frame(0.1))).toBeCloseTo(-23, 0);
    expect(levelDbfs(Buffer.alloc(640))).toBe(-100);
  });
});

describe('VoiceDetector', () => {
  it('nel silenzio la voce supera la soglia assoluta', () => {
    const vad = new VoiceDetector(options);
    for (let i = 0; i < 50; i++) expect(vad.push(Buffer.alloc(640))).toBe(false);
    expect(vad.push(frame(0.1))).toBe(true);
  });

  it('il primo frame di una voce che entra parlando è voce', () => {
    expect(new VoiceDetector(options).push(frame(0.1))).toBe(true);
  });

  it('sotto la soglia assoluta non è mai voce', () => {
    const vad = new VoiceDetector(options);
    expect(vad.push(frame(0.001))).toBe(false);
  });

  it('un rumore costante smette subito di contare come voce', () => {
    const vad = new VoiceDetector(options);
    const verdicts = Array.from({ length: 100 }, (_, i) => vad.push(frame(0.02, 'noise', i + 1)));
    expect(verdicts.slice(1).every((v) => !v)).toBe(true);
  });

  it('sopra un rumore di fondo la voce resta voce', () => {
    const vad = new VoiceDetector(options);
    for (let i = 0; i < 100; i++) vad.push(frame(0.01, 'noise', i + 1));
    expect(vad.push(frame(0.2))).toBe(true);
  });

  it('senza pause nella finestra la soglia non sale sopra la voce sommessa', () => {
    const vad = new VoiceDetector(options);
    // Solo parlato forte, nessun silenzio: il "rumore di fondo" è -23 dBFS.
    for (let i = 0; i < 100; i++) vad.push(frame(0.1));
    expect(vad.threshold()).toBe(-35);
    expect(vad.push(frame(0.03))).toBe(true);
  });

  it('il parlato con vuoti tra le parole resta voce anche quando è lungo', () => {
    const vad = new VoiceDetector(options);
    // Quattro frame di parola e uno di vuoto, per sei secondi: nessun tratto
    // senza voce lungo quanto una pausa (qui bastano cinque frame, 100 ms).
    let run = 0;
    let longest = 0;
    for (let i = 0; i < 300; i++) {
      if (vad.push(i % 5 === 4 ? frame(0.003, 'noise', i + 1) : frame(0.15))) run = 0;
      else longest = Math.max(longest, ++run);
    }
    expect(longest).toBeLessThan(5);
  });
});
