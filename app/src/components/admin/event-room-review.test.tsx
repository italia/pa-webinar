import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));
const conferma = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => conferma }));

import EventRoomReview from './event-room-review';

const t = messages.admin.roomReview;

const MESSAGGI = [
  {
    id: 'm1',
    senderName: 'Anna',
    isModerator: false,
    text: 'Buongiorno a tutti',
    createdAt: '2026-10-10T10:01:00Z',
    isQuestion: false,
    answeredAt: null,
    dismissedAt: null,
  },
  {
    id: 'm2',
    senderName: 'Luca',
    isModerator: false,
    text: 'Quando esce il video?',
    createdAt: '2026-10-10T10:05:00Z',
    isQuestion: true,
    answeredAt: null,
    dismissedAt: null,
  },
];

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

function risposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status });
}

async function attendi() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function disegna() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <EventRoomReview eventId="ev-1" slug="evento-x" token="TOK" concluso />
        </SWRConfig>
      </NextIntlClientProvider>
    );
  });
  await attendi();
}

function pulsante(testo: string) {
  const b = Array.from(container.querySelectorAll('button')).find(
    (x) => x.textContent === testo
  );
  if (!b) throw new Error(`nessun pulsante «${testo}»`);
  return b;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  conferma.mockReset();
  conferma.mockResolvedValue(true);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') return risposta({ ok: true });
    if (url.includes('/room-review')) {
      return risposta({
        domandeChat: [
          {
            id: 'm2',
            senderName: 'Luca',
            text: 'Quando esce il video?',
            answeredAt: null,
            dismissedAt: null,
          },
        ],
        giri: [
          {
            id: 'r1',
            prompt: 'Primo giro',
            createdAt: '2026-10-10T10:10:00Z',
            words: [{ word: 'riuso', count: 2 }],
          },
          {
            id: 'r2',
            prompt: 'Secondo giro',
            createdAt: '2026-10-10T10:20:00Z',
            words: [{ word: 'apertura', count: 1 }],
          },
        ],
      });
    }
    if (url.includes('/chat')) return risposta({ messages: MESSAGGI });
    if (url.includes('/questions')) return risposta({ questions: [] });
    if (url.includes('/polls')) {
      return risposta({
        polls: [
          {
            id: 'p1',
            question: 'Ti è utile?',
            options: ['Sì', 'No'],
            status: 'CLOSED',
            totalVotes: 4,
            optionCounts: [3, 1],
          },
        ],
      });
    }
    return risposta({ active: false });
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

describe('revisione della sala', () => {
  it('la chat si legge con il token di chi modera e si nasconde un messaggio', async () => {
    await disegna();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/events/evento-x/chat?limit=500');
    expect((init as RequestInit).headers).toEqual({ Authorization: 'Bearer TOK' });
    expect(container.textContent).toContain('Buongiorno a tutti');
    const nascondi = container.querySelector(
      `button[aria-label="${t.chat.hideFor.replace('{name}', 'Anna')}"]`
    ) as HTMLButtonElement;
    await act(async () => nascondi.click());
    await attendi();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/events/evento-x/chat/m1',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(toast.success).toHaveBeenCalledWith(t.chat.hidden);
  });

  it('le domande segnate in chat si chiudono dalla scheda Domande', async () => {
    await disegna();
    await act(async () => pulsante(t.tabs.qa).click());
    await attendi();
    expect(container.textContent).toContain('Quando esce il video?');
    await act(async () => pulsante(t.qa.markAnswered).click());
    await attendi();
    const chiamata = fetchMock.mock.calls.find(
      ([, i]) => (i as RequestInit | undefined)?.method === 'PATCH'
    )!;
    expect(chiamata[0]).toBe('/api/events/evento-x/chat/m2/question');
    expect(JSON.parse(String((chiamata[1] as RequestInit).body))).toEqual({
      status: 'ANSWERED',
    });
  });

  it('un sondaggio chiuso si pubblica', async () => {
    await disegna();
    await act(async () => pulsante(t.tabs.polls).click());
    await attendi();
    expect(container.textContent).toContain(t.polls.status.CLOSED);
    await act(async () => pulsante(t.polls.publish).click());
    await attendi();
    const chiamata = fetchMock.mock.calls.find(
      ([, i]) => (i as RequestInit | undefined)?.method === 'PATCH'
    )!;
    expect(chiamata[0]).toBe('/api/events/evento-x/polls/p1');
  });

  it("«Aggiorna il riepilogo pubblico» rifa il riepilogo; se non si puo' lo dice", async () => {
    await disegna();
    await act(async () => pulsante(t.recap.button).click());
    await attendi();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/events/ev-1/recap',
      expect.objectContaining({ method: 'POST' })
    );
    expect(toast.success).toHaveBeenCalledWith(t.recap.done);

    fetchMock.mockImplementationOnce(async () =>
      risposta({ code: 'RETENTION_EXPIRED' }, 409)
    );
    await act(async () => pulsante(t.recap.button).click());
    await attendi();
    expect(toast.error).toHaveBeenCalledWith(t.recap.notPossible);
  });

  it('le schede si muovono con le frecce', async () => {
    await disegna();
    const prima = container.querySelector('[role="tab"]') as HTMLButtonElement;
    await act(async () => {
      prima.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
    });
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')?.textContent
    ).toBe(t.tabs.qa);
  });

  it('nascondere chiede conferma: se si annulla non parte niente', async () => {
    conferma.mockResolvedValue(false);
    await disegna();
    const nascondi = container.querySelector(
      `button[aria-label="${t.chat.hideFor.replace('{name}', 'Anna')}"]`
    ) as HTMLButtonElement;
    await act(async () => nascondi.click());
    await attendi();
    expect(conferma).toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(
        ([, i]) => (i as RequestInit | undefined)?.method === 'DELETE'
      )
    ).toBe(false);
  });

  it("le parole di tutti i giri, non solo dell'ultimo", async () => {
    await disegna();
    await act(async () => pulsante(t.tabs.words).click());
    await attendi();
    expect(container.textContent).toContain('riuso');
    expect(container.textContent).toContain('apertura');
  });

  it('su un evento non concluso (archiviato) niente «Aggiorna il riepilogo»', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
            <EventRoomReview
              eventId="ev-1"
              slug="evento-x"
              token="TOK"
              concluso={false}
            />
          </SWRConfig>
        </NextIntlClientProvider>
      );
    });
    await attendi();
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (b) => b.textContent === t.recap.button
      )
    ).toBe(false);
  });
});
