import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

/**
 * La scena della presentazione: cosa vede chi assiste e cosa può fare chi
 * presenta. pdf.js è finto (il disegno sul canvas non si prova qui): conta il
 * documento scaricato dalla rotta giusta, il numero di pagina annunciato e la
 * navigazione da tastiera, condivisa per chi presenta e personale per chi
 * assiste.
 */
const { compito, openPdf } = vi.hoisted(() => {
  const doc = { numPages: 5, getPage: vi.fn(), destroy: vi.fn() };
  const compito = {
    promise: Promise.resolve(doc),
    destroy: vi.fn(async () => undefined),
  };
  return { doc, compito, openPdf: vi.fn(async () => compito) };
});
vi.mock('./pdf-loader', () => ({ openPdf }));

import PresentationStage from './presentation-stage';
import { PresentationContext, type PresentationControls } from './use-presentation';

const tp = messages.presentation;
const M1 = '55555555-5555-4555-8555-555555555555';
const FILE_URL = `/api/events/evento-di-prova/presentation/file?m=${M1}`;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

function controlli(over: Partial<PresentationControls> = {}): PresentationControls {
  return {
    view: {
      version: 4,
      materialId: M1,
      page: 2,
      fileUrl: FILE_URL,
      stale: false,
      info: {
        materialId: M1,
        page: 2,
        pageCount: 5,
        title: 'Slide della sessione',
        presenterName: 'Relatrice di prova',
        presenterRole: 'SPEAKER',
        yours: false,
        startedAt: '2026-10-21T09:00:00.000Z',
        fileUrl: FILE_URL,
      },
    },
    displayPage: 2,
    canPresent: false,
    start: vi.fn(async () => null),
    takeOver: vi.fn(async () => null),
    goTo: vi.fn(),
    stop: vi.fn(async () => null),
    busy: false,
    actionError: null,
    refresh: vi.fn(),
    ...over,
  };
}

/** Chi presenta adesso: può presentare e la presentazione è sua. */
function presentatore(over: Partial<PresentationControls> = {}): PresentationControls {
  const base = controlli({ canPresent: true, ...over });
  return { ...base, view: { ...base.view, info: { ...base.view.info!, yours: true } } };
}

async function render(
  ctrl: PresentationControls,
  props: {
    token?: string;
    isRecording?: boolean;
    minimized?: boolean;
    onToggleMinimized?: () => void;
  } = {}
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <PresentationContext.Provider value={ctrl}>
          <PresentationStage
            token={props.token ?? ''}
            isRecording={props.isRecording ?? false}
            minimized={props.minimized ?? false}
            onToggleMinimized={props.onToggleMinimized ?? (() => {})}
          />
        </PresentationContext.Provider>
      </NextIntlClientProvider>
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

const scena = () => container.querySelector<HTMLElement>('section.presentation-stage')!;
const indicatore = () =>
  container.querySelector('.presentation-stage__indicator')?.textContent;
function tasto(key: string) {
  act(() => {
    scena().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}
function pulsante(testo: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === testo || b.getAttribute('aria-label') === testo
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(Math, 'random').mockReturnValue(0);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 })
  );
  vi.stubGlobal('fetch', fetchMock);
  openPdf.mockClear();
  compito.destroy.mockClear();
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

describe('PresentationStage — chi assiste', () => {
  it('scarica il documento dalla rotta della presentazione e annuncia la pagina', async () => {
    await render(controlli(), { token: 'TOKEN_ISCRITTO' });
    expect(fetchMock).toHaveBeenCalledWith(FILE_URL, {
      cache: 'no-store',
      headers: { Authorization: 'Bearer TOKEN_ISCRITTO' },
    });
    expect(openPdf).toHaveBeenCalledTimes(1);
    expect(container.querySelector('h2')?.textContent).toBe('Slide della sessione');
    expect(container.textContent).toContain(
      tp.presentedBy.replace('{name}', 'Relatrice di prova')
    );
    const ind = container.querySelector('.presentation-stage__indicator')!;
    expect(ind.textContent).toBe('Pagina 2 di 5');
    expect(ind.getAttribute('aria-live')).toBe('polite');
    // La slide ha un nome per chi usa un lettore di schermo.
    expect(container.querySelector('canvas')?.getAttribute('aria-label')).toBe(
      'Slide della sessione. Pagina 2 di 5'
    );
  });

  it('un ospite scarica senza intestazione Authorization', async () => {
    await render(controlli());
    expect(fetchMock).toHaveBeenCalledWith(FILE_URL, { cache: 'no-store' });
  });

  it('sfoglia da solo con le frecce, poi torna alla pagina di chi presenta', async () => {
    const ctrl = controlli();
    await render(ctrl);
    tasto('ArrowRight');
    expect(indicatore()).toBe('Pagina 3 di 5');
    expect(ctrl.goTo).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      'Stai guardando la pagina 3; chi presenta è alla pagina 2.'
    );
    act(() => pulsante(tp.backToPresenter)!.click());
    expect(indicatore()).toBe('Pagina 2 di 5');
    expect(pulsante(tp.backToPresenter)).toBeUndefined();
  });

  it('finché il documento non è aperto non si sfoglia', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const ctrl = controlli({ canPresent: true });
    await render(ctrl);
    expect(
      container.querySelector('.presentation-stage__status[role="status"]')?.textContent
    ).toContain(tp.loading);
    expect(pulsante(tp.next)?.disabled).toBe(true);
    tasto('ArrowRight');
    expect(ctrl.goTo).not.toHaveBeenCalled();
  });

  it('quando chi presenta arriva alla pagina su cui sfogliava, lo segue di nuovo', async () => {
    const ctrl = controlli();
    await render(ctrl);
    tasto('ArrowRight');
    tasto('ArrowRight');
    expect(indicatore()).toBe('Pagina 4 di 5');
    // Chi presenta passa alla 4, poi alla 5: chi assiste va con lui.
    await render({
      ...ctrl,
      displayPage: 4,
      view: { ...ctrl.view, page: 4, version: 5 },
    });
    expect(pulsante(tp.backToPresenter)).toBeUndefined();
    await render({
      ...ctrl,
      displayPage: 5,
      view: { ...ctrl.view, page: 5, version: 6 },
    });
    expect(indicatore()).toBe('Pagina 5 di 5');
  });

  it('nessun comando di chi presenta', async () => {
    await render(controlli());
    expect(pulsante(tp.stop)).toBeUndefined();
    expect(pulsante(tp.takeOver)).toBeUndefined();
    expect(container.querySelector('input[type=number]')).toBeNull();
    expect(container.querySelector('[role="note"]')).toBeNull();
  });

  it('annuncia ai lettori di schermo cosa si presenta e chi lo presenta', async () => {
    await render(controlli());
    const annuncio = Array.from(container.querySelectorAll('[role="status"]')).find(
      (el) => !el.classList.contains('presentation-stage__status')
    );
    expect(annuncio?.getAttribute('aria-live')).toBe('polite');
    expect(annuncio?.textContent).toBe(
      `Slide della sessione. ${tp.presentedBy.replace('{name}', 'Relatrice di prova')}`
    );
  });

  it('un documento che non si scarica lo dice, e si può riprovare', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 404 }));
    const ctrl = controlli();
    await render(ctrl);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      tp.loadError
    );
    act(() => pulsante(tp.retry)!.click());
    await attendi();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ctrl.refresh).toHaveBeenCalled();
  });
});

describe('PresentationStage — chi presenta', () => {
  it('le frecce girano la pagina per tutta la sala, con il numero di pagine', async () => {
    const ctrl = presentatore();
    await render(ctrl, { token: 'TOKEN_MOD' });
    tasto('ArrowRight');
    expect(ctrl.goTo).toHaveBeenLastCalledWith(3, 5);
    tasto('ArrowLeft');
    expect(ctrl.goTo).toHaveBeenLastCalledWith(1, 5);
    tasto('End');
    expect(ctrl.goTo).toHaveBeenLastCalledWith(5, 5);
    // Un tasto qualunque non fa nulla.
    tasto('a');
    expect(ctrl.goTo).toHaveBeenCalledTimes(3);
  });

  it('le frecce dentro il campo della pagina non girano le slide', async () => {
    const ctrl = presentatore();
    await render(ctrl, { token: 'TOKEN_MOD' });
    const campo = container.querySelector<HTMLInputElement>('input[type=number]')!;
    act(() => {
      campo.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
    });
    expect(ctrl.goTo).not.toHaveBeenCalled();
  });

  it('chiude la presentazione', async () => {
    const ctrl = presentatore();
    await render(ctrl, { token: 'TOKEN_MOD' });
    act(() => pulsante(tp.stop)!.click());
    expect(ctrl.stop).toHaveBeenCalled();
  });

  it('con la registrazione in corso, avvisa che il riquadro non finisce nel video', async () => {
    await render(controlli({ canPresent: true }), { isRecording: true });
    expect(container.querySelector('[role="note"]')?.textContent).toBe(tp.recordingNote);
  });

  it('anche senza registrazione dice che le pagine stanno nel riquadro della sala, non nella chiamata', async () => {
    await render(controlli({ canPresent: true }));
    expect(container.querySelector('[role="note"]')?.textContent).toBe(tp.roomOnlyNote);
  });

  it('chi può presentare e non presenta adesso prende la presentazione con «Presenta tu»', async () => {
    const ctrl = controlli({ canPresent: true });
    await render(ctrl, { token: 'TOKEN_RELATORE' });
    const prendi = pulsante(tp.takeOver)!;
    expect(prendi).toBeDefined();
    expect(prendi.getAttribute('aria-describedby')).toBeTruthy();
    act(() => prendi.click());
    await attendi();
    // Dalla pagina che sta guardando: quella di chi presenta.
    expect(ctrl.takeOver).toHaveBeenCalledWith(2);
    // Il focus passa alla scena: le frecce girano subito le pagine.
    expect(document.activeElement).toBe(scena());
  });

  it('chi presenta adesso non vede «Presenta tu»', async () => {
    await render(presentatore());
    expect(pulsante(tp.takeOver)).toBeUndefined();
    expect(pulsante(tp.stop)).toBeDefined();
  });

  it('chi può presentare ma non presenta sfoglia solo per sé, e prende dalla pagina a cui è arrivato', async () => {
    const ctrl = controlli({ canPresent: true });
    await render(ctrl, { token: 'TOKEN_RELATORE' });
    // Nessun campo per la pagina, ma può chiudere.
    expect(container.querySelector('input[type=number]')).toBeNull();
    expect(pulsante(tp.stop)).toBeDefined();
    tasto('ArrowRight');
    tasto('ArrowRight');
    expect(ctrl.goTo).not.toHaveBeenCalled();
    expect(indicatore()).toBe('Pagina 4 di 5');
    act(() => pulsante(tp.takeOver)!.click());
    await attendi();
    expect(ctrl.takeOver).toHaveBeenCalledWith(4);
  });

  it('un cambio di pagina non riuscito lo dice', async () => {
    await render(presentatore({ actionError: 'changed' }));
    expect(container.textContent).toContain(tp.errors.changed);
  });

  it('una pagina rifiutata perché ora presenta un altro lo dice come avviso', async () => {
    await render(controlli({ canPresent: true, actionError: 'notPresenter' }));
    const avviso = container.querySelector('[role="alert"]');
    expect(avviso?.textContent).toBe(tp.errors.notPresenter);
  });
});

describe('PresentationStage — ridotta', () => {
  it('una riga con titolo e pagina, e il pulsante per riaprirla', async () => {
    const riapri = vi.fn();
    await render(controlli(), { minimized: true, onToggleMinimized: riapri });
    expect(container.querySelector('.presentation-stage--minimized')).not.toBeNull();
    expect(container.textContent).toContain(
      tp.minimizedSummary.replace('{title}', 'Slide della sessione')
    );
    expect(container.querySelector('canvas')).toBeNull();
    act(() => pulsante(tp.expand)!.click());
    expect(riapri).toHaveBeenCalled();
  });
});

describe('PresentationStage — cambio di documento', () => {
  it('il documento precedente si chiude', async () => {
    await render(controlli());
    const altro = '66666666-6666-4666-8666-666666666666';
    const url2 = `/api/events/evento-di-prova/presentation/file?m=${altro}`;
    await render(
      controlli({
        view: {
          version: 5,
          materialId: altro,
          page: 1,
          fileUrl: url2,
          stale: true,
          info: null,
        },
        displayPage: 1,
      })
    );
    expect(compito.destroy).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenLastCalledWith(url2, { cache: 'no-store' });
    // Il titolo non è ancora arrivato: la scena dice comunque cos'è.
    expect(container.querySelector('h2')?.textContent).toBe(tp.label);
  });
});
