import { afterEach, describe, expect, it, vi } from 'vitest';

const mp = vi.hoisted(() => ({
  forVisionTasks: vi.fn(async (percorso: string) => ({ percorso })),
  createFromOptions: vi.fn(),
  close: vi.fn(),
}));
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: mp.forVisionTasks },
  ImageSegmenter: { createFromOptions: mp.createFromOptions },
}));

import {
  PERCORSO_MODELLO,
  PERCORSO_WASM,
  mascheraInAlfa,
  prendiSegmentatore,
  rettangoloCopertura,
  rilasciaSegmentatore,
} from './background-preview';

afterEach(() => {
  vi.clearAllMocks();
});

describe('rettangoloCopertura', () => {
  it('taglia i lati di un video più largo del riquadro', () => {
    // 1280×720 in un riquadro quadrato: si tiene il centro, alto quanto il video.
    expect(rettangoloCopertura(1280, 720, 100, 100)).toEqual({ sx: 280, sy: 0, sw: 720, sh: 720 });
  });

  it('taglia sopra e sotto un video più alto del riquadro', () => {
    const r = rettangoloCopertura(720, 1280, 160, 90);
    expect(r.sx).toBe(0);
    expect(r.sw).toBe(720);
    expect(r.sh).toBeCloseTo(405);
    expect(r.sy).toBeCloseTo((1280 - 405) / 2);
  });

  it('con misure nulle non divide per zero', () => {
    expect(rettangoloCopertura(0, 0, 100, 100)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});

describe('mascheraInAlfa', () => {
  it('porta la confidenza nel canale alfa, limitata fra 0 e 255', () => {
    const pixel = new Uint8ClampedArray(4 * 4);
    mascheraInAlfa(new Float32Array([0, 0.5, 1, 1.4]), pixel);
    expect(Array.from(pixel.filter((_, i) => i % 4 === 3))).toEqual([0, 128, 255, 255]);
    expect(pixel[0]).toBe(255);
  });

  it('non scrive oltre la fine dell’immagine', () => {
    const pixel = new Uint8ClampedArray(4);
    mascheraInAlfa(new Float32Array([1, 1, 1]), pixel);
    expect(pixel[3]).toBe(255);
  });
});

describe('segmentatore condiviso', () => {
  it('si carica dal portale, con la scheda grafica o, se non va, con il processore', async () => {
    const segmentatore = { close: mp.close };
    mp.createFromOptions.mockRejectedValueOnce(new Error('niente WebGL')).mockResolvedValueOnce(segmentatore);

    await expect(prendiSegmentatore()).resolves.toBe(segmentatore);
    expect(mp.forVisionTasks).toHaveBeenCalledWith(PERCORSO_WASM);
    const deleghe = mp.createFromOptions.mock.calls.map(
      (c) => (c[1] as { baseOptions: { delegate: string; modelAssetPath: string } }).baseOptions,
    );
    expect(deleghe.map((d) => d.delegate)).toEqual(['GPU', 'CPU']);
    expect(deleghe[0]?.modelAssetPath).toBe(PERCORSO_MODELLO);

    // Una seconda anteprima riusa lo stesso; si chiude con l'ultima.
    await prendiSegmentatore();
    expect(mp.createFromOptions).toHaveBeenCalledTimes(2);
    rilasciaSegmentatore();
    await Promise.resolve();
    expect(mp.close).not.toHaveBeenCalled();
    rilasciaSegmentatore();
    await vi.waitFor(() => expect(mp.close).toHaveBeenCalledTimes(1));
  });

  it('un caricamento fallito non resta in memoria: la volta dopo si riprova', async () => {
    mp.createFromOptions.mockRejectedValue(new Error('rotto'));
    await expect(prendiSegmentatore()).rejects.toThrow('rotto');
    rilasciaSegmentatore();
    mp.createFromOptions.mockReset().mockResolvedValue({ close: mp.close });
    await expect(prendiSegmentatore()).resolves.toBeTruthy();
    rilasciaSegmentatore();
  });
});

describe('il motore installato', () => {
  it('non manda dati fuori dal portale', async () => {
    // Le versioni 1.x di @mediapipe/tasks-vision spediscono metriche d'uso a
    // un servizio di Google: un aggiornamento che le riporta deve fermarsi qui.
    const { createRequire } = await import('node:module');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.dirname(createRequire(import.meta.url).resolve('@mediapipe/tasks-vision'));
    const file = ['vision_bundle.mjs', 'vision_bundle.cjs', 'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_nosimd_internal.js'];
    for (const f of file) {
      const testo = fs.readFileSync(path.join(dir, f), 'utf8');
      // Un indirizzo di rete di Google, o la chiave delle sue API. (Gli
      // identificativi «type.googleapis.com/…» di protobuf sono nomi, non
      // indirizzi.)
      expect(testo, f).not.toMatch(/https:\/\/[a-z0-9.-]*googleapis\.com|odml\.pa\.googleapis|x-goog-api-key|google-analytics/);
    }
  });
});
