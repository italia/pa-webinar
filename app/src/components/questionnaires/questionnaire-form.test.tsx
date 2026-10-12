import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/en.json';
import itMessages from '@/i18n/messages/it.json';

import QuestionnaireForm from './questionnaire-form';

/**
 * Il questionario parla la lingua della pagina: pulsanti, risposte sì/no,
 * ringraziamento ed errori vengono dai messaggi, non da testi fissi in
 * italiano. Gli errori del server (tecnici, in inglese) diventano una frase
 * scelta dal codice.
 */

const q = messages.questionnaire;
const fetchMock = vi.fn();

const QUESTIONNAIRE = {
  id: 'q-1',
  placement: 'POST_EVENT',
  title: { it: 'Com’è andata?' },
  description: {},
  items: [
    {
      id: 'item-1',
      prompt: { it: 'Lo consiglieresti?', en: 'Would you recommend it?' },
      type: 'YES_NO',
      options: null,
      scaleMin: null,
      scaleMax: null,
      required: true,
    },
  ],
};

function json(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
        <QuestionnaireForm eventSlug="evento" placement="POST_EVENT" guestId="guest-1" />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}

async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function button(text: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === text,
  );
  if (!b) throw new Error(`nessun pulsante «${text}»`);
  return b;
}

async function answerAndSend() {
  const yes = container.querySelector<HTMLInputElement>('#q-item-1-1')!;
  await act(async () => {
    yes.click();
  });
  await act(async () => {
    button(q.submit).click();
  });
  await settle();
}

function alertText(): string {
  return container.querySelector('[role="alert"]')?.textContent ?? '';
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

describe('QuestionnaireForm — testi nella lingua della pagina', () => {
  it('un questionario che non si carica lo dice in inglese', async () => {
    fetchMock.mockResolvedValue(json(500, { error: 'Internal error' }));
    await render();
    expect(alertText()).toBe(q.loadFailed);
  });

  it('anche se la rete non risponde', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await render();
    expect(alertText()).toBe(q.loadFailed);
  });

  it('sì/no e pulsante tradotti; dopo l invio il ringraziamento', async () => {
    fetchMock.mockResolvedValueOnce(json(200, QUESTIONNAIRE)).mockResolvedValueOnce(json(201, {}));
    await render();
    const labels = Array.from(container.querySelectorAll('.form-check-label')).map(
      (l) => l.textContent,
    );
    expect(labels).toEqual([q.yes, q.no]);
    await answerAndSend();
    expect(alertText()).toBe(q.thankYou);
  });

  it('risposte rifiutate dal server: la frase tradotta, non il messaggio tecnico', async () => {
    fetchMock.mockResolvedValueOnce(json(200, QUESTIONNAIRE)).mockResolvedValueOnce(
      json(422, { error: 'Questionnaire answers invalid', code: 'VALIDATION_ERROR' }),
    );
    await render();
    await answerAndSend();
    expect(alertText()).toBe(q.answersInvalid);
    expect(alertText()).not.toContain('Questionnaire answers invalid');
  });

  it('risposte gia inviate', async () => {
    fetchMock.mockResolvedValueOnce(json(200, QUESTIONNAIRE)).mockResolvedValueOnce(
      json(409, { error: 'Response already submitted', code: 'ALREADY_SUBMITTED' }),
    );
    await render();
    await answerAndSend();
    expect(alertText()).toBe(q.alreadySubmitted);
  });

  it('un altro errore, o la rete che cade durante l invio', async () => {
    fetchMock.mockResolvedValueOnce(json(200, QUESTIONNAIRE)).mockResolvedValueOnce(json(500, {}));
    await render();
    await answerAndSend();
    expect(alertText()).toBe(q.submitFailed);

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(async () => {
      button(q.submit).click();
    });
    await settle();
    expect(alertText()).toBe(q.submitFailed);
  });
});

/**
 * La variante «feedback» (la valutazione di fine evento): stelle con il voto
 * scritto accanto, invio possibile solo dopo almeno una risposta (un invio
 * vuoto consuma l'unica risposta concessa senza dire niente), e chi aveva gia'
 * risposto lo sa dal chiamante come un esito, non come un errore.
 */

const tqIt = itMessages.questionnaire;

const FEEDBACK = {
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
      scaleMinLabel: { it: 'Pessimo' },
      scaleMaxLabel: { it: 'Ottimo' },
      required: false,
    },
    {
      id: 'consiglio',
      prompt: { it: 'Lo consiglieresti?' },
      type: 'YES_NO',
      options: null,
      scaleMin: null,
      scaleMax: null,
      required: false,
    },
    {
      id: 'commento',
      prompt: { it: 'Commento' },
      type: 'OPEN_TEXT',
      options: null,
      scaleMin: null,
      scaleMax: null,
      required: false,
    },
  ],
};

async function renderFeedback(
  props: Partial<ComponentProps<typeof QuestionnaireForm>> = {},
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={itMessages} timeZone="Europe/Rome">
        <QuestionnaireForm
          eventSlug="evento"
          placement="POST_EVENT"
          guestId="guest-1"
          variant="feedback"
          hideHeader
          {...props}
        />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}

function invio(): HTMLButtonElement {
  return button(tqIt.submit);
}

function stella(n: number, max = 5): HTMLButtonElement {
  const b = container.querySelector<HTMLButtonElement>(`button[aria-label="${n}/${max}"]`);
  if (!b) throw new Error(`nessuna stella ${n}/${max}`);
  return b;
}

/** Scrive in un campo controllato da React come farebbe la tastiera. */
async function scrivi(el: HTMLTextAreaElement, testo: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, testo);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function hint(): string | null {
  return container.querySelector('.qf-feedback__hint')?.textContent ?? null;
}

describe('QuestionnaireForm — variante feedback', () => {
  it('senza risposte l’invio e’ spento e lo dice; una stella lo accende', async () => {
    fetchMock.mockResolvedValueOnce(json(200, FEEDBACK));
    await renderFeedback();

    expect(invio().disabled).toBe(true);
    expect(hint()).toBe(tqIt.answerOne);

    await act(async () => {
      stella(4).click();
    });

    expect(invio().disabled).toBe(false);
    expect(hint()).toBeNull();
  });

  it('accanto alle stelle il voto scritto: «4 su 5»', async () => {
    fetchMock.mockResolvedValueOnce(json(200, FEEDBACK));
    await renderFeedback();

    const valore = () => container.querySelector('.qf-stars__value')?.textContent;
    expect(valore()).toBe('');

    await act(async () => {
      stella(4).click();
    });

    expect(valore()).toBe('4 su 5');
    expect(stella(4).getAttribute('aria-pressed')).toBe('true');
    expect(stella(5).getAttribute('aria-pressed')).toBe('false');
    // Le etichette degli estremi della scala.
    expect(container.querySelector('.qf-stars__labels')?.textContent).toBe('PessimoOttimo');
  });

  it('un commento di soli spazi non e’ una risposta; un testo vero si’', async () => {
    fetchMock.mockResolvedValueOnce(json(200, FEEDBACK));
    await renderFeedback();
    const area = container.querySelector<HTMLTextAreaElement>('#q-commento')!;
    // L'etichetta e' legata al campo.
    expect(container.querySelector('label[for="q-commento"]')?.textContent).toBe('Commento');

    await scrivi(area, '    ');
    expect(invio().disabled).toBe(true);

    await scrivi(area, 'Molto utile');
    expect(invio().disabled).toBe(false);
  });

  it('il «no» di una domanda si’/no conta come risposta', async () => {
    fetchMock.mockResolvedValueOnce(json(200, FEEDBACK));
    await renderFeedback();

    await act(async () => {
      container.querySelector<HTMLInputElement>('#q-consiglio-0')!.click();
    });
    expect(invio().disabled).toBe(false);
  });

  it('invia solo le domande toccate, con il voto delle stelle', async () => {
    const onSubmitted = vi.fn();
    fetchMock.mockResolvedValueOnce(json(200, FEEDBACK)).mockResolvedValueOnce(json(201, {}));
    await renderFeedback({ onSubmitted });

    await act(async () => {
      stella(4).click();
    });
    await act(async () => {
      invio().click();
    });
    await settle();

    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/api/events/evento/questionnaires/POST_EVENT/responses');
    expect(JSON.parse(init.body)).toEqual({
      answers: [{ itemId: 'voto', valueScale: 4 }],
      guestId: 'guest-1',
    });
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it('gia’ inviato (409): con onAlreadySubmitted decide il chiamante, nessun errore', async () => {
    const onAlreadySubmitted = vi.fn();
    const onSubmitted = vi.fn();
    fetchMock.mockResolvedValueOnce(json(200, FEEDBACK)).mockResolvedValueOnce(
      json(409, { error: 'Response already submitted', code: 'ALREADY_SUBMITTED' }),
    );
    await renderFeedback({ onAlreadySubmitted, onSubmitted });

    await act(async () => {
      stella(5).click();
    });
    await act(async () => {
      invio().click();
    });
    await settle();

    expect(onAlreadySubmitted).toHaveBeenCalledTimes(1);
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(alertText()).toBe('');
  });

  it('onAlreadySubmitted non scatta per gli altri errori', async () => {
    const onAlreadySubmitted = vi.fn();
    fetchMock.mockResolvedValueOnce(json(200, FEEDBACK)).mockResolvedValueOnce(
      json(422, { error: 'Questionnaire answers invalid', code: 'VALIDATION_ERROR' }),
    );
    await renderFeedback({ onAlreadySubmitted });

    await act(async () => {
      stella(3).click();
    });
    await act(async () => {
      invio().click();
    });
    await settle();

    expect(onAlreadySubmitted).not.toHaveBeenCalled();
    expect(alertText()).toBe(tqIt.answersInvalid);
  });

  it('fuori dalla valutazione l’invio resta acceso anche senza risposte', async () => {
    fetchMock.mockResolvedValueOnce(json(200, FEEDBACK));
    await renderFeedback({ variant: 'default' });

    expect(invio().disabled).toBe(false);
    expect(hint()).toBeNull();
  });
});
