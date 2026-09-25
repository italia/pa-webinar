// @vitest-environment jsdom
/**
 * Il cambio di stato dell'evento rilegge i materiali.
 *
 * Quello che il pubblico vede nel pannello «Materiali» dipende dalla fase
 * dell'evento: al passaggio in diretta compaiono i materiali «solo durante» e
 * spariscono quelli «solo prima». Nessuno tocca un materiale, quindi nessun
 * avviso `poke` lo annuncia: senza questa rilettura, con il canale vivo, il
 * pannello aspetterebbe il giro lento di polling.
 *
 * Lo stato arriva anche a ogni apertura dello stream, uguale a quello che il
 * pannello ha appena letto: quello non deve costare una GET a ogni
 * partecipante.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('swr', () => ({ mutate }));

import { useLiveState, type LiveStateHook } from './use-live-state';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeEventSource {
  static ultima: FakeEventSource | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.ultima = this;
  }
  close() {}
  invia(busta: unknown) {
    this.onmessage?.({ data: JSON.stringify(busta) } as MessageEvent<string>);
  }
}

const SLUG = 'evento-di-prova';
const ts = '2026-09-25T10:00:00.000Z';

/** I filtri passati a `mutate`, applicati a una chiave SWR. */
function chiaviRilette(chiave: unknown): boolean {
  return mutate.mock.calls.some(
    ([filtro]) => typeof filtro === 'function' && (filtro as (k: unknown) => boolean)(chiave),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  mutate.mockReset();
  vi.stubGlobal('EventSource', FakeEventSource);
});

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Monta l'hook in un componente sonda; `result.current` è l'ultimo valore. */
function montaHook() {
  const result: { current: LiveStateHook | null } = { current: null };
  function Sonda() {
    result.current = useLiveState(SLUG);
    return null;
  }
  root = createRoot(document.createElement('div'));
  act(() => root!.render(createElement(Sonda)));
  return { result: result as { current: LiveStateHook } };
}

function apri() {
  const hook = montaHook();
  const sorgente = FakeEventSource.ultima!;
  act(() => {
    sorgente.invia({ op: 'hello', pushAvailable: true });
    sorgente.invia({ op: 'eventStatus', status: 'PUBLISHED', ts });
  });
  act(() => {
    vi.advanceTimersByTime(4_000);
  });
  return { hook, sorgente };
}

const MATERIALI = [`/api/events/${SLUG}/materials`, 'TOKEN'];

describe('useLiveState — stato dell’evento e materiali', () => {
  it('il primo stato, all’apertura, non rilegge i materiali', () => {
    const { hook } = apri();
    expect(hook.result.current.eventStatus).toBe('PUBLISHED');
    expect(chiaviRilette(MATERIALI)).toBe(false);
  });

  it('lo stesso stato ripetuto (una riconnessione) non rilegge', () => {
    const { sorgente } = apri();
    act(() => {
      sorgente.invia({ op: 'eventStatus', status: 'PUBLISHED', ts });
      vi.advanceTimersByTime(4_000);
    });
    expect(chiaviRilette(MATERIALI)).toBe(false);
  });

  it('il passaggio in diretta rilegge i materiali, e solo loro', () => {
    const { hook, sorgente } = apri();
    act(() => {
      sorgente.invia({ op: 'eventStatus', status: 'LIVE', ts });
      vi.advanceTimersByTime(4_000);
    });
    expect(hook.result.current.eventStatus).toBe('LIVE');
    expect(chiaviRilette(MATERIALI)).toBe(true);
    expect(chiaviRilette(`/api/events/${SLUG}/questions`)).toBe(false);
  });

  it('anche la chiusura', () => {
    const { sorgente } = apri();
    act(() => {
      sorgente.invia({ op: 'eventStatus', status: 'LIVE', ts });
      vi.advanceTimersByTime(4_000);
    });
    mutate.mockReset();
    act(() => {
      sorgente.invia({ op: 'eventStatus', status: 'ENDED', ts });
      vi.advanceTimersByTime(4_000);
    });
    expect(chiaviRilette(MATERIALI)).toBe(true);
  });
});
