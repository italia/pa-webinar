import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import PostEventFeedback from './post-event-feedback';

/**
 * La valutazione di fine evento, nella scheda di chiusura (`inline`) o in una
 * finestra (`dialog`).
 *
 * - Senza questionario (raccolta spenta: il server risponde 404) non mostra
 *   niente, e la finestra si chiude da sola invece di restare vuota.
 * - Dopo l'invio il ringraziamento, annunciato da una regione che esiste gia'
 *   prima del testo; chi aveva gia' risposto (409) legge che la sua
 *   valutazione c'e' gia', non un errore.
 * - La finestra e' un <dialog> modale: si chiude con Esc (evento `cancel`),
 *   con la X, con «Salta» o cliccando fuori, e alla chiusura il fuoco torna a
 *   chi l'aveva aperta.
 */

const t = messages.feedback;
const fetchMock = vi.fn();
const SLUG = 'evento-di-prova';

const QUESTIONARIO = {
  id: 'q-fb',
  placement: 'POST_EVENT',
  title: { it: 'Il tuo feedback' },
  description: {},
  items: [
    {
      id: 'voto',
      prompt: { it: 'Voto complessivo' },
      type: 'LIKERT',
      options: null,
      scaleMin: 1,
      scaleMax: 5,
      required: false,
    },
  ],
};

function json(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Il server finto: GET del questionario e POST delle risposte. */
function server({ get, post }: { get: () => Response | Promise<Response>; post?: () => Response }) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return post ? post() : json(201, { id: 'r1', created: true });
    if (url === `/api/events/${SLUG}/questionnaires/POST_EVENT`) return get();
    throw new Error(`richiesta inattesa: ${url}`);
  });
}

let container: HTMLDivElement;
let root: Root;

/** jsdom non apre i <dialog>: showModal e close come nel browser, il tempo del test. */
function finestraNativa() {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
  };
  const showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  const close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  proto.showModal = showModal;
  proto.close = close;
  onTestFinished(() => {
    delete proto.showModal;
    delete proto.close;
  });
  return { showModal, close };
}

function annuncio(): string | null {
  return container.querySelector('[role="status"]')?.textContent ?? null;
}

async function disegna(props: Partial<ComponentProps<typeof PostEventFeedback>> = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <PostEventFeedback eventSlug={SLUG} guestId="guest-1" mode="inline" {...props} />
      </NextIntlClientProvider>,
    );
  });
  await attendi();
}

async function attendi() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function pulsante(testo: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === testo,
  );
  if (!b) throw new Error(`nessun pulsante «${testo}»`);
  return b;
}

async function rispondiEInvia() {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="4/5"]')!.click();
  });
  await act(async () => {
    pulsante(t.submit).click();
  });
  await attendi();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('PostEventFeedback — senza questionario', () => {
  it('nella scheda: niente, nemmeno il titolo', async () => {
    server({ get: () => json(404, { code: 'NOT_FOUND' }) });
    await disegna();

    expect(container.innerHTML).toBe('');
  });

  it('in finestra: si chiude da sola', async () => {
    const onClose = vi.fn();
    server({ get: () => json(404, { code: 'NOT_FOUND' }) });
    await disegna({ mode: 'dialog', onClose });

    expect(onClose).toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });

  it('anche se la rete non risponde', async () => {
    const onClose = vi.fn();
    server({ get: () => Promise.reject(new TypeError('Failed to fetch')) });
    await disegna({ mode: 'dialog', onClose });

    expect(onClose).toHaveBeenCalled();
  });
});

describe('PostEventFeedback — nella scheda di chiusura', () => {
  it('titolo, promessa di anonimato e il modulo con il pulsante «Invia feedback»', async () => {
    server({ get: () => json(200, QUESTIONARIO) });
    await disegna();

    const sezione = container.querySelector('section.event-feedback')!;
    expect(sezione).not.toBeNull();
    const titolo = container.querySelector('h2')!;
    expect(titolo.textContent).toBe(t.heading);
    expect(sezione.getAttribute('aria-labelledby')).toBe(titolo.id);
    expect(container.textContent).toContain(t.intro);
    expect(pulsante(t.submit).disabled).toBe(true);
    // Il titolo del questionario non si ripete: lo dice gia' la scheda.
    expect(container.textContent).not.toContain('Il tuo feedback');
  });

  it('dopo l’invio: il ringraziamento al posto del modulo, annunciato', async () => {
    server({ get: () => json(200, QUESTIONARIO) });
    await disegna();
    // La regione che annuncia c'e' gia', vuota, mentre si compila.
    expect(annuncio()).toBe('');

    await rispondiEInvia();

    expect(container.querySelector('.event-feedback__done-title')?.textContent).toBe(t.thankYou);
    expect(container.querySelector('.event-feedback__done-text')?.textContent).toBe(t.thankYouDetail);
    expect(annuncio()).toContain(t.thankYou);
    expect(annuncio()).toContain(t.thankYouDetail);
    expect(container.querySelector('h2')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('gia’ inviata (409): «hai gia’ lasciato la tua valutazione», nessun errore', async () => {
    server({
      get: () => json(200, QUESTIONARIO),
      post: () => json(409, { error: 'Response already submitted', code: 'ALREADY_SUBMITTED' }),
    });
    await disegna();
    await rispondiEInvia();

    expect(container.querySelector('.event-feedback__done-title')?.textContent).toBe(t.alreadyDone);
    expect(container.querySelector('.event-feedback__done-text')).toBeNull();
    expect(annuncio()).toBe(t.alreadyDone);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('chi e’ iscritto risponde col suo token, chi no con l’identificativo del browser', async () => {
    server({ get: () => json(200, QUESTIONARIO) });
    await disegna({ accessToken: 'TOKEN_ISCRIZIONE', guestId: undefined });
    await rispondiEInvia();

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toBe(`/api/events/${SLUG}/questionnaires/POST_EVENT/responses`);
    expect(JSON.parse(post[1].body)).toEqual({
      answers: [{ itemId: 'voto', valueScale: 4 }],
      accessToken: 'TOKEN_ISCRIZIONE',
    });
  });
});

describe('PostEventFeedback — in finestra', () => {
  it('un <dialog> aperto come modale, col titolo', async () => {
    const { showModal } = finestraNativa();
    server({ get: () => json(200, QUESTIONARIO) });
    await disegna({ mode: 'dialog', onClose: vi.fn() });

    const dialogo = container.querySelector('dialog')!;
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialogo.open).toBe(true);
    expect(dialogo.getAttribute('aria-labelledby')).toBe(container.querySelector('h2')!.id);
    expect(
      container.querySelector(`button[aria-label="${messages.common.close}"]`),
    ).not.toBeNull();
  });

  it('Esc (cancel), la X, «Salta» e il clic fuori chiudono; un clic dentro no', async () => {
    finestraNativa();
    const onClose = vi.fn();
    server({ get: () => json(200, QUESTIONARIO) });
    await disegna({ mode: 'dialog', onClose });
    const dialogo = container.querySelector('dialog')!;

    // Esc: il browser manda `cancel`; la chiusura la decide il chiamante.
    const esc = new Event('cancel', { cancelable: true });
    await act(async () => {
      dialogo.dispatchEvent(esc);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(esc.defaultPrevented).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(`button[aria-label="${messages.common.close}"]`)!.click();
    });
    expect(onClose).toHaveBeenCalledTimes(2);

    await act(async () => {
      pulsante(t.skip).click();
    });
    expect(onClose).toHaveBeenCalledTimes(3);

    // Il clic sullo sfondo di un <dialog> modale arriva al <dialog> stesso.
    await act(async () => {
      dialogo.click();
    });
    expect(onClose).toHaveBeenCalledTimes(4);

    await act(async () => {
      container.querySelector<HTMLElement>('.event-feedback__dialog-body')!.click();
    });
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('chiusa la finestra, il fuoco torna a chi l’aveva aperta', async () => {
    const { close } = finestraNativa();
    const apri = document.createElement('button');
    document.body.appendChild(apri);
    onTestFinished(() => apri.remove());
    apri.focus();

    server({ get: () => json(200, QUESTIONARIO) });
    await disegna({ mode: 'dialog', onClose: vi.fn() });
    // Il fuoco si sposta altrove mentre la finestra e' aperta.
    container.querySelector<HTMLButtonElement>(`button[aria-label="${messages.common.close}"]`)!.focus();
    expect(document.activeElement).not.toBe(apri);

    await act(async () => {
      root.render(<></>);
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(apri);
  });

  it('dopo l’invio resta il ringraziamento, senza «Salta»', async () => {
    finestraNativa();
    server({ get: () => json(200, QUESTIONARIO) });
    await disegna({ mode: 'dialog', onClose: vi.fn() });
    await rispondiEInvia();

    expect(container.querySelector('.event-feedback__done-title')?.textContent).toBe(t.thankYou);
    expect(() => pulsante(t.skip)).toThrow();
  });
});
