// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PROVE_FALLITE_INSTABILE,
  attesaTentativo,
  conCambioMedia,
  connessioneInstabile,
  erroreDaRientro,
  richiestaJson,
  statoEvento,
} from './riconnessione';

describe('attesaTentativo', () => {
  it('il primo tentativo parte presto ma sparso fra chi cade insieme', () => {
    expect(attesaTentativo(1, 0)).toBe(500);
    expect(attesaTentativo(1, 1)).toBe(3_000);
    expect(attesaTentativo(1, 0.5)).toBeGreaterThan(500);
    expect(attesaTentativo(1, 0.5)).toBeLessThan(3_000);
  });

  it('poi le attese crescono fino a un tetto', () => {
    const minime = [1, 2, 3, 4, 5, 6, 20].map((n) => attesaTentativo(n, 0));
    expect(minime).toEqual([500, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000]);
    expect(attesaTentativo(50, 1)).toBe(17_000);
  });

  it('valori fuori misura non rompono il calcolo', () => {
    expect(attesaTentativo(0, -1)).toBe(500);
    expect(attesaTentativo(-3, 2)).toBe(3_000);
  });
});

describe('erroreDaRientro', () => {
  it('gli errori fatali della connessione e della conferenza fanno rientrare', () => {
    expect(
      erroreDaRientro({
        error: {
          name: 'connection.otherError',
          message: 'item-not-found',
          type: 'CONNECTION',
          isFatal: true,
        },
      })
    ).toBe(true);
    expect(
      erroreDaRientro({
        error: { name: 'conference.focusLeft', type: 'CONFERENCE', isFatal: true },
      })
    ).toBe(true);
  });

  it('gli errori che Jitsi supera da solo non toccano la chiamata', () => {
    expect(
      erroreDaRientro({
        error: {
          name: 'connection.passwordRequired',
          type: 'CONNECTION',
          isFatal: false,
        },
      })
    ).toBe(false);
    expect(
      erroreDaRientro({ error: { name: 'conference.destroyed', type: 'CONFERENCE' } })
    ).toBe(false);
  });

  it('un errore di configurazione non si ripara rientrando', () => {
    expect(
      erroreDaRientro({ error: { name: 'config.x', type: 'CONFIG', isFatal: true } })
    ).toBe(false);
  });

  it('eventi malformati non fanno nulla', () => {
    expect(erroreDaRientro(undefined)).toBe(false);
    expect(erroreDaRientro(null)).toBe(false);
    expect(erroreDaRientro({})).toBe(false);
    expect(erroreDaRientro({ error: { type: 'CONNECTION', isFatal: 'true' } })).toBe(
      false
    );
  });
});

describe('conCambioMedia', () => {
  it('segue microfono e videocamera come li riferisce Jitsi', () => {
    const spenti = { audio: false, video: false };
    const conMicrofono = conCambioMedia(spenti, 'audio', false);
    expect(conMicrofono).toEqual({ audio: true, video: false });
    expect(conCambioMedia(conMicrofono, 'video', false)).toEqual({
      audio: true,
      video: true,
    });
    expect(conCambioMedia(conMicrofono, 'audio', true)).toEqual({
      audio: false,
      video: false,
    });
  });

  it('senza cambi resta lo stesso oggetto; un valore illeggibile non cambia nulla', () => {
    const stato = { audio: true, video: false };
    expect(conCambioMedia(stato, 'audio', false)).toBe(stato);
    expect(conCambioMedia(stato, 'video', undefined)).toBe(stato);
  });
});

describe('connessioneInstabile', () => {
  it('una prova fallita può essere un singhiozzo, qualcuna di fila no', () => {
    expect(connessioneInstabile(0, true)).toBe(false);
    expect(connessioneInstabile(PROVE_FALLITE_INSTABILE - 1, true)).toBe(false);
    expect(connessioneInstabile(PROVE_FALLITE_INSTABILE, true)).toBe(true);
  });

  it('il browser offline basta', () => {
    expect(connessioneInstabile(0, false)).toBe(true);
  });
});

describe('richiestaJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('una risposta del server arriva con stato e corpo, anche di errore', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"status":"LIVE"}', { status: 200 }))
    );
    await expect(richiestaJson('/api/x')).resolves.toEqual({
      ok: true,
      status: 200,
      data: { status: 'LIVE' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"code":"X"}', { status: 503 }))
    );
    await expect(richiestaJson('/api/x')).resolves.toEqual({
      ok: false,
      status: 503,
      data: { code: 'X' },
    });
  });

  it('un corpo che non è JSON (la pagina d’errore di un proxy) è comunque una risposta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>502</html>', { status: 502 }))
    );
    await expect(richiestaJson('/api/x')).resolves.toEqual({
      ok: false,
      status: 502,
      data: null,
    });
  });

  it('un errore di rete vale null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    await expect(richiestaJson('/api/x')).resolves.toBeNull();
  });

  it('una POST porta corpo e tipo', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await richiestaJson('/api/x', { method: 'POST', body: '{"a":1}', attesaMs: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/x',
      expect.objectContaining({
        method: 'POST',
        body: '{"a":1}',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  /** Una fetch che non risponde finché la richiesta non viene interrotta. */
  const appesa = () =>
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );

  it('una richiesta appesa si interrompe allo scadere del tempo e vale null', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', appesa());
    const esito = richiestaJson('/api/x', { attesaMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(esito).resolves.toBeNull();
  });

  it('anche un corpo che non arriva si interrompe allo scadere del tempo', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const corpo = new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener('abort', () =>
              controller.error(new DOMException('aborted', 'AbortError'))
            );
          },
        });
        return new Response(corpo, { status: 200 });
      })
    );
    const esito = richiestaJson('/api/x', { attesaMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(esito).resolves.toBeNull();
  });
});

describe('statoEvento', () => {
  it('lo stato di una risposta di /lifecycle, solo se buona', () => {
    expect(statoEvento({ ok: true, status: 200, data: { status: 'LIVE' } })).toBe('LIVE');
    expect(statoEvento({ ok: false, status: 503, data: { status: 'LIVE' } })).toBeNull();
    expect(statoEvento({ ok: true, status: 200, data: null })).toBeNull();
    expect(statoEvento({ ok: true, status: 200, data: { status: 3 } })).toBeNull();
    expect(statoEvento(null)).toBeNull();
  });
});
