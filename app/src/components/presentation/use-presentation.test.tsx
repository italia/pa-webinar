import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PresentationPointer, PresentationState } from '@/lib/presentation/types';

import {
  actionErrorFromResponse,
  usePresentation,
  type PresentationControls,
} from './use-presentation';

/**
 * Il lato browser della presentazione: legge lo stato, lo allinea al canale e
 * comanda le pagine per chi presenta.
 *
 * Il punto delicato sono le pagine girate di fila: partono una alla volta e
 * l'ultima chiesta vince, così una risposta che arriva fuori ordine non
 * riporta la sala indietro.
 */

const SLUG = 'evento-di-prova';
const M1 = '55555555-5555-4555-8555-555555555555';
const M2 = '66666666-6666-4666-8666-666666666666';

function stato(version: number, materialId: string | null, page = 1): PresentationState {
  return {
    version,
    presentation: materialId
      ? {
          materialId,
          page,
          pageCount: 10,
          title: `Documento ${materialId.slice(0, 2)}`,
          presenterName: null,
          presenterRole: 'MODERATOR',
          yours: false,
          startedAt: '2026-10-08T09:00:00.000Z',
          fileUrl: `/api/events/${SLUG}/presentation/file?m=${materialId}`,
        }
      : null,
  };
}

let container: HTMLDivElement;
let root: Root;
let servito: PresentationState;
const fetchMock = vi.fn();
const risultato: { current: PresentationControls | null } = { current: null };

function Sonda(props: { pointer: PresentationPointer | null; canPresent: boolean }) {
  risultato.current = usePresentation({
    eventSlug: SLUG,
    token: 'TOKEN',
    pointer: props.pointer,
    pushLive: true,
    canPresent: props.canPresent,
  });
  return null;
}

async function monta(pointer: PresentationPointer | null = null, canPresent = true) {
  await act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Sonda pointer={pointer} canPresent={canPresent} />
      </SWRConfig>
    );
  });
  await attendi();
}

async function attendi() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const chiamate = (metodo: string) =>
  fetchMock.mock.calls.filter(
    ([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === metodo
  );

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  servito = stato(3, M1, 2);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (!init?.method || init.method === 'GET')
      return new Response(JSON.stringify(servito), { status: 200 });
    return new Response(JSON.stringify(servito), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  risultato.current = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('usePresentation — lettura', () => {
  it('legge lo stato con il token come Bearer, senza cache', async () => {
    await monta();
    const [url, init] = chiamate('GET')[0]!;
    expect(url).toBe(`/api/events/${SLUG}/presentation`);
    expect((init as RequestInit).headers).toEqual({ Authorization: 'Bearer TOKEN' });
    expect((init as RequestInit).cache).toBe('no-store');
    expect(risultato.current!.view).toMatchObject({ materialId: M1, page: 2 });
    expect(risultato.current!.displayPage).toBe(2);
  });

  it('una lettura non riuscita (502) tiene lo stato di prima; chi non sta nella stanza non vede nulla', async () => {
    await monta();
    expect(risultato.current!.view.materialId).toBe(M1);
    fetchMock.mockImplementation(
      async () => new Response('bad gateway', { status: 502 })
    );
    await act(async () => {
      risultato.current!.refresh();
    });
    await attendi();
    expect(risultato.current!.view).toMatchObject({ materialId: M1, page: 2 });
    fetchMock.mockImplementation(async () => new Response('{}', { status: 401 }));
    await act(async () => {
      risultato.current!.refresh();
    });
    await attendi();
    expect(risultato.current!.view.materialId).toBeNull();
  });

  it('il canale annuncia un documento nuovo: si rilegge lo stato completo', async () => {
    await monta();
    const prima = chiamate('GET').length;
    servito = stato(5, M2, 1);
    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <Sonda pointer={{ materialId: M2, page: 1, version: 5 }} canPresent />
        </SWRConfig>
      );
    });
    await attendi();
    expect(chiamate('GET').length).toBeGreaterThan(prima);
    expect(risultato.current!.view).toMatchObject({ materialId: M2, stale: false });
    expect(risultato.current!.view.info?.title).toBe('Documento 66');
  });
});

describe('usePresentation — chi assiste', () => {
  it('un documento nuovo dal canale: rilegge anche chi assiste, dopo un istante a caso', async () => {
    const caso = vi.spyOn(Math, 'random').mockReturnValue(0);
    await monta(null, false);
    const prima = chiamate('GET').length;
    servito = stato(5, M2, 1);
    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <Sonda pointer={{ materialId: M2, page: 1, version: 5 }} canPresent={false} />
        </SWRConfig>
      );
    });
    await attendi();
    expect(chiamate('GET').length).toBeGreaterThan(prima);
    expect(risultato.current!.view).toMatchObject({ materialId: M2, stale: false });
    caso.mockRestore();
  });
});

describe('usePresentation — chi presenta', () => {
  it('avvia: POST con il materiale, e la risposta vale subito', async () => {
    await monta();
    servito = stato(4, M2, 1);
    let esito: unknown;
    await act(async () => {
      esito = await risultato.current!.start(M2);
    });
    expect(esito).toBeNull();
    const [url, init] = chiamate('POST')[0]!;
    expect(url).toBe(`/api/events/${SLUG}/presentation`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ materialId: M2 });
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer TOKEN',
    });
    expect(risultato.current!.view.materialId).toBe(M2);
  });

  it('pagine girate di fila: una richiesta alla volta, e l’ultima pagina vince', async () => {
    await monta();
    let rilascia: () => void = () => {};
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const corpo = JSON.parse(init.body as string) as { page: number };
        await new Promise<void>((r) => {
          rilascia = r;
        });
        servito = stato(servito.version + 1, M1, corpo.page);
        return new Response(JSON.stringify(servito), { status: 200 });
      }
      return new Response(JSON.stringify(servito), { status: 200 });
    });

    act(() => {
      risultato.current!.goTo(3, 10);
      risultato.current!.goTo(4, 10);
      risultato.current!.goTo(5, 10);
    });
    // La pagina chiesta si vede subito.
    expect(risultato.current!.displayPage).toBe(5);
    expect(chiamate('PATCH')).toHaveLength(1);

    await act(async () => {
      rilascia();
    });
    await attendi();
    expect(chiamate('PATCH')).toHaveLength(2);
    expect(JSON.parse((chiamate('PATCH')[1]![1] as RequestInit).body as string)).toEqual({
      materialId: M1,
      page: 5,
      pageCount: 10,
    });
    await act(async () => {
      rilascia();
    });
    await attendi();
    expect(chiamate('PATCH')).toHaveLength(2);
    expect(risultato.current!.view.page).toBe(5);
    expect(risultato.current!.displayPage).toBe(5);
  });

  it('il documento è cambiato nel frattempo: lo dice e rilegge', async () => {
    await monta();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 });
      }
      return new Response(JSON.stringify(servito), { status: 200 });
    });
    const letture = chiamate('GET').length;
    act(() => risultato.current!.goTo(4, 10));
    await attendi();
    expect(risultato.current!.actionError).toBe('changed');
    expect(chiamate('GET').length).toBeGreaterThan(letture);
    // Tornata la pagina di chi presenta.
    expect(risultato.current!.displayPage).toBe(2);
  });

  it('chiude il documento che vede, indicandolo', async () => {
    await monta();
    servito = stato(4, null);
    await act(async () => {
      await risultato.current!.stop();
    });
    const [url, init] = chiamate('DELETE')[0]!;
    expect(url).toBe(`/api/events/${SLUG}/presentation?materialId=${M1}`);
    expect((init as RequestInit).headers).toEqual({ Authorization: 'Bearer TOKEN' });
    expect(risultato.current!.view.materialId).toBeNull();
  });

  it('una chiusura rifiutata resta visibile come errore dell’azione', async () => {
    await monta();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE')
        return new Response(JSON.stringify({ code: 'FORBIDDEN' }), { status: 403 });
      return new Response(JSON.stringify(servito), { status: 200 });
    });
    let esito: unknown;
    await act(async () => {
      esito = await risultato.current!.stop();
    });
    expect(esito).toBe('forbidden');
    expect(risultato.current!.actionError).toBe('forbidden');
    expect(risultato.current!.view.materialId).toBe(M1);
  });

  it('«Presenta tu»: POST sullo stesso documento dalla pagina di chi presenta, e la risposta vale subito', async () => {
    await monta();
    servito = {
      version: 4,
      presentation: {
        ...stato(4, M1, 2).presentation!,
        yours: true,
        startedAt: '2026-10-08T09:30:00.000Z',
      },
    };
    let esito: unknown;
    await act(async () => {
      esito = await risultato.current!.takeOver();
    });
    expect(esito).toBeNull();
    const [, init] = chiamate('POST')[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      materialId: M1,
      page: 2,
    });
    expect(risultato.current!.view.info?.yours).toBe(true);
    expect(risultato.current!.actionError).toBeNull();
  });

  it('il canale annuncia un passaggio di mano sullo stesso documento: si rilegge chi presenta', async () => {
    await monta();
    const prima = chiamate('GET').length;
    servito = {
      version: 5,
      presentation: {
        ...stato(5, M1, 2).presentation!,
        presenterRole: 'SPEAKER',
        startedAt: '2026-10-08T09:30:00.000Z',
      },
    };
    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <Sonda
            pointer={{
              materialId: M1,
              page: 2,
              version: 5,
              startedAt: '2026-10-08T09:30:00.000Z',
            }}
            canPresent
          />
        </SWRConfig>
      );
    });
    await attendi();
    expect(chiamate('GET').length).toBeGreaterThan(prima);
    expect(risultato.current!.view).toMatchObject({ materialId: M1, stale: false });
    expect(risultato.current!.view.info?.presenterRole).toBe('SPEAKER');
  });

  it('chi non può presentare non manda nulla', async () => {
    await monta(null, false);
    act(() => risultato.current!.goTo(4, 10));
    let esito: unknown;
    await act(async () => {
      esito = await risultato.current!.start(M2);
    });
    expect(esito).toBe('forbidden');
    expect(chiamate('PATCH')).toHaveLength(0);
    expect(chiamate('POST')).toHaveLength(0);
  });
});

describe('actionErrorFromResponse', () => {
  it('ogni risposta ha il suo messaggio', () => {
    expect(actionErrorFromResponse(409, 'CONFLICT')).toBe('changed');
    expect(actionErrorFromResponse(409, 'EVENT_CLOSED')).toBe('closed');
    expect(actionErrorFromResponse(422, 'NOT_PRESENTABLE')).toBe('notPresentable');
    // Un materiale o un evento che non c'è più non è «non presentabile».
    expect(actionErrorFromResponse(404)).toBe('generic');
    expect(actionErrorFromResponse(403)).toBe('forbidden');
    expect(actionErrorFromResponse(500)).toBe('generic');
  });
});
