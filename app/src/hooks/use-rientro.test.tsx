import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ATTESA_INGRESSO_MS,
  DURATA_MASSIMA_RIENTRO_MS,
  RIENTRO_LUNGO_MS,
} from '@/lib/jitsi/riconnessione';

import { useRientro, type EsitoToken, type Rientro } from './use-rientro';

/**
 * Il rientro nella chiamata dopo una caduta: quando rimonta, con quale token,
 * quando riprova e quando lascia la scelta alla persona.
 */

type Risposta = Response | 'rete';

let risposte: Risposta[];
let fetchMock: ReturnType<typeof vi.fn>;
let stato: Rientro;
let container: HTMLDivElement;
let root: Root;

const opzioni = {
  inSala: true,
  richiediToken: vi.fn(async (): Promise<EsitoToken> => 'fatto'),
  onConcluso: vi.fn(),
  onRinuncia: vi.fn(),
};

function Prova() {
  stato = useRientro({
    inSala: opzioni.inSala,
    slug: 'evento',
    richiediToken: opzioni.richiediToken,
    onConcluso: opzioni.onConcluso,
    onRinuncia: opzioni.onRinuncia,
  });
  return null;
}

const rendi = () => act(() => root.render(<Prova />));
const avanza = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
/** Il tempo che passa a piccoli passi: React applica gli stati fra un passo e l'altro. */
async function avanzaAPassi(ms: number, passo = 1_000) {
  for (let fatto = 0; fatto < ms; fatto += passo)
    await avanza(Math.min(passo, ms - fatto));
}
const stato_ = (status: string) =>
  new Response(JSON.stringify({ status }), { status: 200 });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  risposte = [];
  fetchMock = vi.fn(async () => {
    const r = risposte.shift() ?? 'rete';
    if (r === 'rete') throw new TypeError('Failed to fetch');
    return r;
  });
  vi.stubGlobal('fetch', fetchMock);
  opzioni.inSala = true;
  opzioni.richiediToken = vi.fn(async (): Promise<EsitoToken> => 'fatto');
  opzioni.onConcluso = vi.fn();
  opzioni.onRinuncia = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  rendi();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useRientro', () => {
  it('a portale raggiungibile rimonta subito, con un token nuovo chiesto al portale', async () => {
    risposte = [stato_('LIVE')];
    act(() => {
      expect(stato.avvia()).toBe(true);
    });
    expect(stato.rientro).toMatchObject({ tentativo: 1, montata: false });
    expect(stato.montaggio).toBe(0);
    await avanza(500);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/events/evento/lifecycle',
      expect.anything()
    );
    expect(opzioni.richiediToken).toHaveBeenCalledTimes(1);
    expect(stato.montaggio).toBe(1);
    expect(stato.rientro?.montata).toBe(true);
    act(() => stato.concludi());
    expect(stato.rientro).toBeNull();
  });

  it('un rientro già in corso non ne fa partire un altro', () => {
    act(() => {
      expect(stato.avvia()).toBe(true);
      expect(stato.avvia()).toBe(false);
    });
  });

  it('a rete assente riprova con attese crescenti, e subito quando torna online', async () => {
    act(() => void stato.avvia());
    await avanza(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stato.rientro?.tentativo).toBe(2);
    await avanza(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stato.rientro?.tentativo).toBe(3);
    // Il terzo tentativo aspetterebbe quattro secondi: la rete torna prima.
    risposte = [stato_('LIVE')];
    await avanza(100);
    act(() => void window.dispatchEvent(new Event('online')));
    await avanza(500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(stato.rientro?.montata).toBe(true);
    expect(stato.montaggio).toBe(1);
  });

  it('un token nuovo che non arriva per la rete fa riprovare, non sbagliare', async () => {
    opzioni.richiediToken = vi.fn(async (): Promise<EsitoToken> => 'rete');
    rendi();
    risposte = [stato_('LIVE')];
    act(() => void stato.avvia());
    await avanza(500);
    expect(stato.rientro).toMatchObject({ tentativo: 2, montata: false });
    expect(stato.montaggio).toBe(0);
  });

  it('una risposta definitiva sul token chiude il rientro a chi l’ha gestita', async () => {
    opzioni.richiediToken = vi.fn(async (): Promise<EsitoToken> => 'gestito');
    rendi();
    risposte = [stato_('LIVE')];
    act(() => void stato.avvia());
    await avanza(500);
    expect(stato.montaggio).toBe(0);
    // La fase della sala cambia (errore, fine): il rientro si chiude.
    opzioni.inSala = false;
    rendi();
    expect(stato.rientro).toBeNull();
  });

  it('evento concluso nel frattempo: la chiusura, nessun rientro', async () => {
    risposte = [stato_('ENDED')];
    act(() => void stato.avvia());
    await avanza(500);
    expect(opzioni.onConcluso).toHaveBeenCalledTimes(1);
    expect(stato.rientro).toBeNull();
    expect(stato.montaggio).toBe(0);
  });

  it('evento non in diretta: decide il portale, con un token nuovo', async () => {
    // Chi conduce rientra anche prima dell'avvio: il portale gli dà il token.
    risposte = [stato_('PUBLISHED')];
    act(() => void stato.avvia());
    await avanza(500);
    expect(opzioni.richiediToken).toHaveBeenCalledTimes(1);
    expect(stato.montaggio).toBe(1);
  });

  it('evento tornato in attesa o chiuso agli ingressi: il portale risponde e il rientro non rimonta', async () => {
    opzioni.richiediToken = vi.fn(async (): Promise<EsitoToken> => 'gestito');
    rendi();
    risposte = [stato_('IDLE')];
    act(() => void stato.avvia());
    await avanza(500);
    expect(opzioni.richiediToken).toHaveBeenCalledTimes(1);
    expect(stato.montaggio).toBe(0);
  });

  it('una chiamata rimontata che non entra in tempo si rimonta da capo, con un token nuovo', async () => {
    risposte = [stato_('LIVE'), stato_('LIVE')];
    act(() => void stato.avvia());
    await avanza(500);
    expect(stato.montaggio).toBe(1);
    expect(opzioni.richiediToken).toHaveBeenCalledTimes(1);
    await avanza(ATTESA_INGRESSO_MS);
    expect(stato.rientro).toMatchObject({ tentativo: 2, montata: false });
    await avanza(2_000);
    expect(opzioni.richiediToken).toHaveBeenCalledTimes(2);
    expect(stato.montaggio).toBe(2);
    expect(stato.rientro?.montata).toBe(true);
  });

  it('rimontaggi che non entrano mai: anche così, dopo il tempo massimo la scelta passa alla persona', async () => {
    fetchMock.mockImplementation(async () => stato_('LIVE'));
    act(() => void stato.avvia());
    await avanzaAPassi(DURATA_MASSIMA_RIENTRO_MS + ATTESA_INGRESSO_MS + 20_000);
    expect(opzioni.onRinuncia).toHaveBeenCalledTimes(1);
    expect(stato.rientro).toBeNull();
  });

  it('dopo un po’ il testo cambia; troppo a lungo e la scelta passa alla persona', async () => {
    act(() => void stato.avvia());
    expect(stato.lungo).toBe(false);
    await avanzaAPassi(RIENTRO_LUNGO_MS);
    expect(stato.lungo).toBe(true);
    await avanzaAPassi(DURATA_MASSIMA_RIENTRO_MS);
    expect(opzioni.onRinuncia).toHaveBeenCalledTimes(1);
    expect(stato.rientro).toBeNull();
    // Le prove sono state poche: le attese crescono fino a un tetto.
    expect(fetchMock.mock.calls.length).toBeLessThan(60);
  });

  it('fuori dalla sala un rientro si annulla e non prova più', async () => {
    act(() => void stato.avvia());
    opzioni.inSala = false;
    rendi();
    expect(stato.rientro).toBeNull();
    await avanza(10_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
