import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ASSET_MAX_BYTES, ASSET_MIME_TYPES, formattaPeso, tipoAmmesso } from './limits';
import { erroreDaRisposta, inviaFile } from './upload-xhr';

/**
 * L'invio con avanzamento e annullamento, e le regole condivise con la rotta
 * di caricamento. La promessa non fallisce mai: l'esito dice cosa e' successo.
 */
class XhrFinto {
  static ultimo: XhrFinto | null = null;
  upload: {
    onprogress:
      ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  inviato = false;
  constructor() {
    XhrFinto.ultimo = this;
  }
  open() {}
  send() {
    this.inviato = true;
  }
  abort() {
    this.onabort?.();
  }
}

function xhr(): XhrFinto {
  if (!XhrFinto.ultimo) throw new Error('nessun invio');
  return XhrFinto.ultimo;
}

beforeEach(() => {
  XhrFinto.ultimo = null;
  vi.stubGlobal('XMLHttpRequest', XhrFinto);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('inviaFile', () => {
  it("riferisce l'avanzamento in percentuale e restituisce il corpo della risposta", async () => {
    const avanzamento: number[] = [];
    const esito = inviaFile('/x', new FormData(), {
      onProgress: (p) => avanzamento.push(p),
    });
    xhr().upload.onprogress?.({ lengthComputable: true, loaded: 45, total: 100 });
    xhr().status = 200;
    xhr().responseText = JSON.stringify({ url: 'https://a.example/x.png' });
    xhr().onload?.();
    expect(await esito).toEqual({
      tipo: 'ok',
      corpo: { url: 'https://a.example/x.png' },
    });
    expect(avanzamento).toEqual([45, 100]);
  });

  it('un errore porta lo stato e il codice, mai il testo del server', async () => {
    const esito = inviaFile('/x', new FormData());
    xhr().status = 503;
    xhr().responseText = JSON.stringify({
      error: 'Files storage is not configured.',
      code: 'STORAGE_UNAVAILABLE',
    });
    xhr().onload?.();
    expect(await esito).toEqual({
      tipo: 'errore',
      status: 503,
      codice: 'STORAGE_UNAVAILABLE',
    });
  });

  it('una risposta non JSON (un proxy) conta solo per lo stato', async () => {
    const esito = inviaFile('/x', new FormData());
    xhr().status = 502;
    xhr().responseText = '<html>Bad gateway</html>';
    xhr().onload?.();
    expect(await esito).toEqual({ tipo: 'errore', status: 502, codice: undefined });
  });

  it("la rete assente e l'annullamento hanno un esito loro", async () => {
    const rete = inviaFile('/x', new FormData());
    xhr().onerror?.();
    expect(await rete).toEqual({ tipo: 'rete' });

    const ctrl = new AbortController();
    const annullato = inviaFile('/x', new FormData(), { signal: ctrl.signal });
    ctrl.abort();
    expect(await annullato).toEqual({ tipo: 'annullato' });
  });

  it("gia' annullato prima di partire, non parte", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await inviaFile('/x', new FormData(), { signal: ctrl.signal })).toEqual({
      tipo: 'annullato',
    });
    expect(XhrFinto.ultimo).toBeNull();
  });
});

describe('erroreDaRisposta', () => {
  it('traduce lo stato in cosa dire a chi carica', () => {
    expect(erroreDaRisposta(413)).toBe('troppoGrande');
    expect(erroreDaRisposta(415)).toBe('tipo');
    expect(erroreDaRisposta(503, 'STORAGE_UNAVAILABLE')).toBe('nonDisponibile');
    expect(erroreDaRisposta(503)).toBe('generico');
    expect(erroreDaRisposta(401)).toBe('accesso');
    expect(erroreDaRisposta(403)).toBe('accesso');
    expect(erroreDaRisposta(429)).toBe('troppi');
    expect(erroreDaRisposta(422)).toBe('generico');
    expect(erroreDaRisposta(500)).toBe('generico');
  });
});

describe('limiti condivisi con la rotta', () => {
  it('tipi e pesi per ogni genere di file', () => {
    expect(tipoAmmesso('image', 'image/png')).toBe(true);
    expect(tipoAmmesso('image', 'image/heic')).toBe(false);
    expect(tipoAmmesso('audio', 'audio/mpeg')).toBe(true);
    expect(tipoAmmesso('document', 'application/pdf')).toBe(true);
    expect(tipoAmmesso('document', 'image/svg+xml')).toBe(false);
    expect(ASSET_MIME_TYPES.image).toContain('image/svg+xml');
    expect(ASSET_MAX_BYTES.image).toBe(10 * 1024 * 1024);
    expect(ASSET_MAX_BYTES.audio).toBe(20 * 1024 * 1024);
  });

  it('il peso nella lingua della pagina', () => {
    expect(formattaPeso(73728, 'it')).toBe('72\u00a0kB');
    expect(formattaPeso(10 * 1024 * 1024, 'it')).toBe('10\u00a0MB');
    expect(formattaPeso(1.5 * 1024 * 1024, 'it')).toBe('1,5\u00a0MB');
    expect(formattaPeso(1.5 * 1024 * 1024, 'en')).toBe('1.5\u00a0MB');
    expect(formattaPeso(10, 'it')).toBe('1\u00a0kB');
  });
});
