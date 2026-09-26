import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/en.json';

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
