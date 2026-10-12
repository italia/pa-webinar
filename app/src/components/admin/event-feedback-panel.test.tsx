import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import type { EventFeedbackReport, FeedbackItemStats } from '@/lib/feedback/event-feedback-report';

import EventFeedbackPanel from './event-feedback-panel';

/**
 * Le valutazioni nella pagina dell'evento in amministrazione: quante sono, la
 * media e la distribuzione per domanda, i commenti, le valutazioni a stelle
 * precedenti. Aperta dal link del moderatore, la richiesta porta il suo token
 * come `Authorization: Bearer`; senza, vale il cookie dello staff.
 */

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const t = messages.admin.feedbackPanel;
const fetchMock = vi.fn();

function domanda(over: Partial<FeedbackItemStats> & Pick<FeedbackItemStats, 'id' | 'type'>): FeedbackItemStats {
  return {
    prompt: { it: `Domanda ${over.id}` },
    options: null,
    scaleMin: null,
    scaleMax: null,
    scaleMinLabel: null,
    scaleMaxLabel: null,
    answered: 0,
    average: null,
    distribution: null,
    ...over,
  };
}

function rapporto(over: Partial<EventFeedbackReport> = {}): EventFeedbackReport {
  return {
    enabled: true,
    questionnaire: { id: 'q-1', title: { it: 'Il tuo feedback' } },
    items: [
      domanda({
        id: 'voto',
        type: 'LIKERT',
        prompt: { it: 'Voto complessivo', en: 'Overall rating' },
        scaleMin: 1,
        scaleMax: 5,
        scaleMinLabel: { it: 'Pessimo' },
        scaleMaxLabel: { it: 'Ottimo' },
        answered: 3,
        average: 4.33,
        distribution: [0, 0, 0, 2, 1],
      }),
      domanda({
        id: 'consiglio',
        type: 'YES_NO',
        prompt: { it: 'Lo consiglieresti?' },
        answered: 3,
        average: 0.67,
        distribution: [1, 2],
      }),
      domanda({
        id: 'modo',
        type: 'SINGLE_CHOICE',
        prompt: { it: 'Come hai seguito?' },
        options: [{ it: 'In sala' }, { it: 'Online' }],
        answered: 2,
        distribution: [1, 1],
      }),
      domanda({ id: 'commento', type: 'OPEN_TEXT', prompt: { it: 'Commento' }, answered: 2 }),
    ],
    responses: [
      {
        id: 'r3',
        submittedAt: '2026-10-02T10:00:00.000Z',
        kind: 'registration',
        answers: { voto: { scale: 5 }, commento: { text: 'Ottimo evento' } },
      },
      {
        id: 'r2',
        submittedAt: '2026-10-01T10:00:00.000Z',
        kind: 'guest',
        answers: { voto: { scale: 4 }, commento: { text: 'Audio da migliorare' } },
      },
      { id: 'r1', submittedAt: '2026-09-30T10:00:00.000Z', kind: 'guest', answers: { voto: { scale: 4 } } },
    ],
    legacy: { count: 0, average: null, entries: [] },
    ...over,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let container: HTMLDivElement;
let root: Root;

async function disegna(token: string | null = null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <EventFeedbackPanel eventId={EVENT_ID} token={token} />
        </SWRConfig>
      </NextIntlClientProvider>,
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

function pulsante(testo: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((el) => el.textContent?.trim() === testo);
}

/** Il riquadro di una domanda, cercato per il testo della domanda. */
function riquadro(prompt: string): HTMLElement {
  const el = Array.from(container.querySelectorAll<HTMLElement>('.feedback-item')).find(
    (d) => d.querySelector('.feedback-item__prompt')?.textContent === prompt,
  );
  if (!el) throw new Error(`nessuna domanda «${prompt}»`);
  return el;
}

function barre(el: HTMLElement): Array<[string, string]> {
  return Array.from(el.querySelectorAll('.feedback-item__bar')).map((b) => [
    b.querySelector('.feedback-item__label')?.textContent ?? '',
    b.querySelector('.feedback-item__n')?.textContent ?? '',
  ]);
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json(200, rapporto()));
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('EventFeedbackPanel — i numeri', () => {
  it('quante valutazioni, e il CSV da scaricare', async () => {
    await disegna();
    expect(container.querySelector('.feedback-panel__count')?.textContent).toBe('3 valutazioni ricevute');
    expect(pulsante(t.downloadCsv)).toBeDefined();
    // Raccolta accesa: nessun avviso.
    expect(container.textContent).not.toContain(t.disabled);
  });

  it('scala: la media con la virgola, le barre dal voto piu’ alto, le etichette degli estremi', async () => {
    await disegna();
    const voto = riquadro('Voto complessivo');
    expect(voto.querySelector('.feedback-item__avg')?.textContent).toBe('Media 4,3 su 5');
    expect(barre(voto)).toEqual([
      ['5', '1'],
      ['4', '2'],
      ['3', '0'],
      ['2', '0'],
      ['1', '0'],
    ]);
    expect(voto.querySelector('.feedback-item__scale')?.textContent).toBe('1 = Pessimo · 5 = Ottimo');
    expect(voto.querySelector('.feedback-item__answered')?.textContent).toBe('3 risposte');
  });

  it('si’/no: la quota di si’, e le barre No e Si’', async () => {
    await disegna();
    const consiglio = riquadro('Lo consiglieresti?');
    expect(consiglio.querySelector('.feedback-item__avg')?.textContent).toBe('Sì: 67%');
    expect(barre(consiglio)).toEqual([
      [t.no, '1'],
      [t.yes, '2'],
    ]);
  });

  it('scelte: una barra per opzione, senza media', async () => {
    await disegna();
    const modo = riquadro('Come hai seguito?');
    expect(modo.querySelector('.feedback-item__avg')).toBeNull();
    expect(barre(modo)).toEqual([
      ['In sala', '1'],
      ['Online', '1'],
    ]);
  });

  it('il testo libero non ha un riquadro di statistiche: diventa la lista dei commenti', async () => {
    await disegna();
    expect(() => riquadro('Commento')).toThrow();
    const commenti = container.querySelector('.feedback-panel__comments')!;
    expect(commenti.querySelector('h3')?.textContent).toBe('Commenti (2)');
    const testi = Array.from(commenti.querySelectorAll('.feedback-panel__comment p')).map((p) => p.textContent);
    expect(testi).toEqual(['Ottimo evento', 'Audio da migliorare']);
    // Una sola domanda aperta: la domanda non si ripete accanto a ogni commento.
    expect(commenti.querySelector('.feedback-panel__comment-q')).toBeNull();
  });

  it('con piu’ domande aperte, ogni commento dice a quale risponde', async () => {
    fetchMock.mockImplementation(async () =>
      json(
        200,
        rapporto({
          items: [
            domanda({ id: 'bene', type: 'OPEN_TEXT', prompt: { it: 'Cosa ti e’ piaciuto?' } }),
            domanda({ id: 'male', type: 'OPEN_TEXT', prompt: { it: 'Cosa miglioreresti?' } }),
          ],
          responses: [
            {
              id: 'r1',
              submittedAt: '2026-10-01T10:00:00.000Z',
              kind: 'guest',
              answers: { bene: { text: 'Il ritmo' }, male: { text: 'L’audio' } },
            },
          ],
        }),
      ),
    );
    await disegna();
    const domande = Array.from(container.querySelectorAll('.feedback-panel__comment-q')).map((s) => s.textContent);
    expect(domande).toEqual(['Cosa ti e’ piaciuto?', 'Cosa miglioreresti?']);
  });

  it('oltre otto commenti: i primi otto, poi «Mostra tutti»', async () => {
    const responses = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`,
      submittedAt: '2026-10-01T10:00:00.000Z',
      kind: 'guest' as const,
      answers: { commento: { text: `Commento ${i}` } },
    }));
    fetchMock.mockImplementation(async () =>
      json(200, rapporto({ items: [domanda({ id: 'commento', type: 'OPEN_TEXT' })], responses })),
    );
    await disegna();

    const visibili = () => container.querySelectorAll('.feedback-panel__comment').length;
    expect(visibili()).toBe(8);
    await act(async () => {
      pulsante('Mostra tutti (10)')!.click();
    });
    expect(visibili()).toBe(10);
    await act(async () => {
      pulsante(t.showFewer)!.click();
    });
    expect(visibili()).toBe(8);
  });

  it('le valutazioni a stelle precedenti, a parte', async () => {
    fetchMock.mockImplementation(async () =>
      json(
        200,
        rapporto({
          legacy: {
            count: 2,
            average: 4.5,
            entries: [
              { rating: 5, comment: 'Bello', createdAt: '2026-06-12T10:00:00.000Z' },
              { rating: 4, comment: null, createdAt: '2026-06-12T09:00:00.000Z' },
            ],
          },
        }),
      ),
    );
    await disegna();

    const vecchie = container.querySelector('.feedback-panel__legacy')!;
    expect(vecchie.querySelector('h3')?.textContent).toBe(t.legacyTitle);
    // Il numero e la media con la virgola, nella frase del pannello.
    expect(vecchie.querySelector('.feedback-panel__note')?.textContent).toBe(
      t.legacySummary.replace('{count}', '2').replace('{average}', '4,5'),
    );
    // Solo quelle con un commento finiscono nella lista.
    const voci = vecchie.querySelectorAll('.feedback-panel__comment');
    expect(voci).toHaveLength(1);
    expect(voci[0]!.textContent).toContain('Bello');
    expect(voci[0]!.textContent).toContain('5 su 5');
  });

  it('raccolta spenta: lo dice', async () => {
    fetchMock.mockImplementation(async () => json(200, rapporto({ enabled: false })));
    await disegna();
    expect(container.textContent).toContain(t.disabled);
  });
});

describe('EventFeedbackPanel — stati', () => {
  it('nessuna valutazione: lo dice, senza CSV ne’ statistiche', async () => {
    fetchMock.mockImplementation(async () => json(200, rapporto({ responses: [] })));
    await disegna();

    expect(container.querySelector('.feedback-panel__count')?.textContent).toBe(t.empty);
    expect(pulsante(t.downloadCsv)).toBeUndefined();
    expect(container.querySelector('.feedback-item')).toBeNull();
    expect(container.querySelector('.feedback-panel__comments')).toBeNull();
  });

  it('una risposta del server non riuscita: l’errore, non un pannello vuoto', async () => {
    fetchMock.mockImplementation(async () => json(403, { code: 'FORBIDDEN' }));
    await disegna();
    expect(container.textContent).toBe(t.loadFailed);
  });
});

describe('EventFeedbackPanel — chi chiede', () => {
  it('dal link del moderatore: il token in Authorization: Bearer', async () => {
    await disegna('TOKEN_MODERATORE');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/admin/events/${EVENT_ID}/feedback`);
    expect(init).toEqual({
      credentials: 'include',
      headers: { Authorization: 'Bearer TOKEN_MODERATORE' },
    });
  });

  it('dallo staff: solo il cookie, nessuna intestazione', async () => {
    await disegna();

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toEqual({ credentials: 'include' });
  });

  it('il CSV passa dalla stessa richiesta autenticata, nella lingua della pagina', async () => {
    // jsdom non crea URL di blob: si sostituiscono il tempo del test.
    const createObjectURL = vi.fn(() => 'blob:csv');
    const revokeObjectURL = vi.fn();
    const originali = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    onTestFinished(() => {
      URL.createObjectURL = originali.create;
      URL.revokeObjectURL = originali.revoke;
    });
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('format=csv')
        ? new Response('﻿submitted_at,respondent\r\n', { status: 200 })
        : json(200, rapporto()),
    );
    await disegna('TOKEN_MODERATORE');

    await act(async () => {
      pulsante(t.downloadCsv)!.click();
    });
    await attendi();

    const csv = fetchMock.mock.calls.find(([url]) => String(url).includes('format=csv'))!;
    expect(csv[0]).toBe(`/api/admin/events/${EVENT_ID}/feedback?format=csv&locale=it`);
    expect(csv[1]).toEqual({
      credentials: 'include',
      headers: { Authorization: 'Bearer TOKEN_MODERATORE' },
    });
    // Il token non finisce nell'indirizzo.
    expect(csv[0]).not.toContain('TOKEN_MODERATORE');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clic).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv');
  });

  it('un CSV che non arriva: lo dice', async () => {
    const avviso = vi.spyOn(window, 'alert').mockImplementation(() => {});
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('format=csv') ? json(500, {}) : json(200, rapporto()),
    );
    await disegna();

    await act(async () => {
      pulsante(t.downloadCsv)!.click();
    });
    await attendi();

    expect(avviso).toHaveBeenCalledWith(t.downloadFailed);
    // Il pulsante torna usabile.
    expect(pulsante(t.downloadCsv)!.disabled).toBe(false);
  });
});
