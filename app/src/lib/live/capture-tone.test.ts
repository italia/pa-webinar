import { afterEach, describe, expect, it, vi } from 'vitest';

describe('suonaAvvisoCattura', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const finto = (stato = 'running') => {
    const note: number[] = [];
    class Contesto {
      currentTime = 0;
      destination = {};
      state = stato;
      resume = vi.fn(async () => undefined);
      createOscillator() {
        const nota = {
          frequency: { value: 0 },
          connect: (n: unknown) => n,
          start: vi.fn(() => note.push(nota.frequency.value)),
          stop: vi.fn(),
        };
        return nota;
      }
      createGain() {
        return {
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: (n: unknown) => n,
        };
      }
    }
    vi.stubGlobal('AudioContext', Contesto);
    return note;
  };

  it("sale all'avvio e scende allo stop", async () => {
    const note = finto();
    const { suonaAvvisoCattura } = await import('./capture-tone');
    await suonaAvvisoCattura(true);
    expect(note).toEqual([660, 880]);
    note.length = 0;
    await suonaAvvisoCattura(false);
    expect(note).toEqual([880, 660]);
  });

  it("con l'audio bloccato dal browser non mette note in coda", async () => {
    const note = finto('suspended');
    const { suonaAvvisoCattura } = await import('./capture-tone');
    await suonaAvvisoCattura(true);
    expect(note).toEqual([]);
  });

  it('un browser senza audio non ferma la sala', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const { suonaAvvisoCattura } = await import('./capture-tone');
    await expect(suonaAvvisoCattura(true)).resolves.toBeUndefined();
  });
});
