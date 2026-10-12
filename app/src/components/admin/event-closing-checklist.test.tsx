import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import type { StatoChiusura } from '@/lib/events/closing';

vi.mock('@/i18n/navigation', async () => {
  const { createElement } = await import('react');
  return {
    Link: ({ href, children, ...rest }: { href: unknown; children?: unknown }) =>
      createElement('a', { href: String(href), ...rest }, children as never),
    percorso: (p: string) => p,
  };
});

import EventClosingChecklist from './event-closing-checklist';

const t = messages.admin.closing;

const STATO: StatoChiusura = {
  daFare: 2,
  voci: [
    { voce: 'registrazione', stato: 'da-fare', caso: 'daPubblicare' },
    { voce: 'trascrizione', stato: 'da-fare', caso: 'prontaAi', recordingId: 'rec-1' },
    { voce: 'resoconto', stato: 'non-serve', caso: 'senzaPipeline' },
    {
      voce: 'sala',
      stato: 'fatto',
      caso: 'rivista',
      numeri: {
        messaggi: 12,
        domande: 3,
        sondaggi: 1,
        nuvole: 0,
      },
    },
    { voce: 'materiali', stato: 'fatto', caso: 'presenti', numeri: { materiali: 2 } },
    {
      voce: 'valutazioni',
      stato: 'in-corso',
      caso: 'emailInPartenza',
      numeri: { valutazioni: 0 },
    },
    { voce: 'pagina', stato: 'fatto', caso: 'visibile' },
  ],
};

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

async function disegna(props: { token?: string | null; onMateriali?: () => void } = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <EventClosingChecklist
            eventId="ev-1"
            token={props.token ?? null}
            conTrascrizioneDaiSottotitoli={false}
            onMateriali={props.onMateriali ?? vi.fn()}
          />
        </SWRConfig>
      </NextIntlClientProvider>
    );
  });
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify(STATO)));
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

describe("Chiudi l'evento", () => {
  it('dice quante cose restano e lo stato di ogni voce', async () => {
    await disegna();
    expect(container.textContent).toContain('2 cose da completare');
    expect(container.querySelectorAll('.chiusura__voce')).toHaveLength(7);
    expect(container.textContent).toContain(t.registrazione.daPubblicare);
    expect(container.textContent).toContain('Messaggi: 12 · domande: 3 · sondaggi: 1');
    expect(container.querySelector('.chiusura__voce--non-serve')?.textContent).toContain(
      t.stato.nonServe
    );
  });

  it("lo staff apre la trascrizione nell'editor della registrazione", async () => {
    await disegna();
    const link = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === t.azioni.rivedi
    );
    expect(link?.getAttribute('href')).toBe('/admin/postprod/rec-1');
  });

  it('chi arriva dal link del moderatore manda il token e non riceve link allo staff', async () => {
    await disegna({ token: 'TOK' });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toEqual({ Authorization: 'Bearer TOK' });
    expect(
      Array.from(container.querySelectorAll('a')).some((a) =>
        a.getAttribute('href')?.includes('/admin/postprod')
      )
    ).toBe(false);
  });

  it('«Vai ai materiali» apre la scheda dei contenuti', async () => {
    const onMateriali = vi.fn();
    await disegna({ onMateriali });
    const b = Array.from(container.querySelectorAll('button')).find(
      (x) => x.textContent === t.azioni.materiali
    )!;
    act(() => b.click());
    expect(onMateriali).toHaveBeenCalled();
  });

  it('tutto fatto: lo dice', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...STATO, daFare: 0 })));
    await disegna();
    expect(container.textContent).toContain(t.summaryDone);
  });

  it('se lo stato non si legge, lo dice senza mostrare voci', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    await disegna();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(t.error);
    expect(container.querySelectorAll('.chiusura__voce')).toHaveLength(0);
  });
});
