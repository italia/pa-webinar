import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import QuestionList from './question-list';

/**
 * Il pollice in su nel pannello Q&A, dal lato di chi lo clicca.
 *
 * - Chi non è iscritto (ospite, relatore) vota con l'identificativo stabile
 *   del browser: la lettura lo porta come `?guestId=`, il voto nel corpo, e il
 *   token di sala, se c'è, come `Authorization: Bearer`.
 * - Dopo il voto il pannello rilegge l'elenco e il pulsante dice «Votata».
 * - Un voto respinto lo dice, invece di lasciare un pulsante che non fa nulla.
 *
 * E la risposta scritta: chi conduce la scrive dalla scheda della domanda,
 * tutti la leggono sotto la domanda, e chi l'ha fatta vede il segno «La tua
 * domanda».
 */

const SLUG = 'evento-di-prova';
const QID = '4f37abe2-1bc6-4d0a-8d94-4dd75ff5db8b';
const t = messages.qa;

let container: HTMLDivElement;
let root: Root;
let votata: boolean;
let conteggio: number;
let esitoVoto: number;
let risposta: string | null;
let esitoModifica: number;
const fetchMock = vi.fn();

async function render(props: {
  token?: string;
  isModerator?: boolean;
  voterAccessToken?: string;
  voterGuestId?: string;
  myQuestionIds?: ReadonlySet<string>;
}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <QuestionList
            eventSlug={SLUG}
            token={props.token ?? ''}
            isModerator={props.isModerator ?? false}
            voterAccessToken={props.voterAccessToken}
            voterGuestId={props.voterGuestId}
            myQuestionIds={props.myQuestionIds}
          />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
  });
  await attendi();
}

/** Lascia finire le richieste in volo e i render che ne seguono. */
async function attendi() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const pulsanteVoto = () =>
  container.querySelector<HTMLButtonElement>(
    `button[aria-label="${t.upvote}"], button[aria-label="${t.upvoted}"]`,
  );
const avvisi = () =>
  Array.from(container.querySelectorAll('[role="alert"]')).map((el) => el.textContent);

function chiamate(metodo: 'GET' | 'POST' | 'PATCH') {
  return fetchMock.mock.calls.filter(
    ([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === metodo,
  ) as [string, RequestInit | undefined][];
}

async function clicca(b: HTMLButtonElement) {
  await act(async () => {
    b.click();
  });
  await attendi();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  votata = false;
  conteggio = 2;
  esitoVoto = 200;
  risposta = null;
  esitoModifica = 200;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      if (esitoModifica !== 200) return new Response('{}', { status: esitoModifica });
      const corpo = JSON.parse(String(init.body)) as { answer?: string | null };
      if (corpo.answer !== undefined) risposta = corpo.answer || null;
      return new Response('{}', { status: 200 });
    }
    if (init?.method === 'POST') {
      if (esitoVoto !== 200) {
        return new Response(JSON.stringify({ code: 'RATE_LIMIT' }), { status: esitoVoto });
      }
      votata = !votata;
      conteggio += votata ? 1 : -1;
      return new Response(JSON.stringify({ upvoted: votata, upvoteCount: conteggio }), {
        status: 200,
      });
    }
    const conIdentita = url.includes('guestId=');
    return new Response(
      JSON.stringify({
        questions: [
          {
            id: QID,
            authorName: 'Ospite A',
            text: 'Ci sarà la registrazione?',
            answerText: risposta,
            status: risposta ? 'ANSWERED' : 'PENDING',
            upvoteCount: conteggio,
            hasUpvoted: conIdentita && votata,
            createdAt: '2026-09-25T10:00:00.000Z',
            highlightedAt: null,
            answeredAt: null,
          },
        ],
        totalCount: 1,
        canUpvote: conIdentita,
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('QuestionList — pollice in su con l’identificativo del browser', () => {
  it('l’ospite legge col proprio identificativo, vota e ritrova il voto', async () => {
    await render({ voterGuestId: 'guest_prova' });

    expect(chiamate('GET')[0]?.[0]).toBe(`/api/events/${SLUG}/questions?guestId=guest_prova`);
    expect(pulsanteVoto()?.getAttribute('aria-label')).toBe(t.upvote);

    await clicca(pulsanteVoto()!);

    const [url, init] = chiamate('POST')[0]!;
    expect(url).toBe(`/api/events/${SLUG}/questions/${QID}/upvote`);
    expect(JSON.parse(String(init?.body))).toEqual({ guestId: 'guest_prova' });
    // Senza token di sala non parte nessun Bearer vuoto.
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();

    // Il pannello rilegge l'elenco, e il pulsante segue il server.
    expect(chiamate('GET').length).toBeGreaterThanOrEqual(2);
    expect(pulsanteVoto()?.getAttribute('aria-label')).toBe(t.upvoted);
    expect(pulsanteVoto()?.textContent).toContain('3');
  });

  it('il relatore vota col browser e mostra il token di sala come prova di presenza', async () => {
    await render({ token: 'TOKEN_RELATORE', voterGuestId: 'guest_relatore' });
    await clicca(pulsanteVoto()!);

    const [, init] = chiamate('POST')[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ guestId: 'guest_relatore' });
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN_RELATORE');
  });

  it('un voto respinto lo dice', async () => {
    esitoVoto = 429;
    await render({ voterGuestId: 'guest_prova' });
    await clicca(pulsanteVoto()!);

    expect(avvisi()).toContain(t.errors.upvoteFailed);
    expect(pulsanteVoto()?.getAttribute('aria-label')).toBe(t.upvote);
  });

  it('senza identità di voto si vede il numero, non il pulsante', async () => {
    await render({});
    expect(pulsanteVoto()).toBeNull();
    expect(container.textContent).toContain('2');
  });

  it('chi conduce vede il contatore e non il pulsante', async () => {
    await render({ token: 'TOKEN_MODERATORE', isModerator: true, voterGuestId: 'guest_mod' });
    expect(pulsanteVoto()).toBeNull();
  });
});

describe('QuestionList — risposta scritta', () => {
  const pulsante = (testo: string) =>
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(testo));

  async function scrivi(testo: string) {
    const area = container.querySelector('textarea')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(area, testo);
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('chi conduce scrive la risposta e la vede sotto la domanda', async () => {
    await render({ token: 'TOKEN_MODERATORE', isModerator: true });
    await clicca(pulsante(t.moderator.answer)!);

    const area = container.querySelector('textarea')!;
    expect(container.querySelector(`label[for="${area.id}"]`)?.textContent).toBe(
      t.moderator.answerFieldLabel.replace('{name}', 'Ospite A'),
    );
    // Vuota non si pubblica.
    expect(pulsante(t.moderator.sendAnswer)!.disabled).toBe(true);

    await scrivi('Sì, entro una settimana.');
    await clicca(pulsante(t.moderator.sendAnswer)!);

    const [url, init] = chiamate('PATCH')[0]!;
    expect(url).toBe(`/api/events/${SLUG}/questions/${QID}`);
    expect(JSON.parse(String(init?.body))).toEqual({ answer: 'Sì, entro una settimana.' });
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN_MODERATORE');
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('.qa-answer__text')?.textContent).toBe('Sì, entro una settimana.');
    expect(pulsante(t.moderator.editAnswer)).toBeDefined();
  });

  it('una risposta respinta lo dice e lascia aperto il modulo', async () => {
    esitoModifica = 500;
    await render({ token: 'TOKEN_MODERATORE', isModerator: true });
    await clicca(pulsante(t.moderator.answer)!);
    await scrivi('Sì.');
    await clicca(pulsante(t.moderator.sendAnswer)!);

    expect(avvisi()).toContain(t.errors.actionFailed);
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Sì.');
  });

  it('il pubblico legge la risposta, e chi ha fatto la domanda vede il segno', async () => {
    risposta = 'Sì, entro una settimana.';
    await render({ voterGuestId: 'guest_prova', myQuestionIds: new Set([QID]) });

    expect(container.querySelector('.qa-answer__text')?.textContent).toBe(risposta);
    expect(container.querySelector('.qa-mine-badge')?.textContent).toBe(t.yourQuestionLabel);
    expect(pulsante(t.moderator.answer)).toBeUndefined();
  });

  it('senza la domanda fra le proprie, nessun segno', async () => {
    await render({ voterGuestId: 'guest_prova', myQuestionIds: new Set() });
    expect(container.querySelector('.qa-mine-badge')).toBeNull();
  });
});
