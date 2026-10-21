// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...resto }: { href: string; children: ReactNode }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
  percorso: (p: string) => p,
}));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }),
}));

import InstantCallsList from './instant-calls-list';

/**
 * L'elenco delle chiamate rapide: per ogni chiamata i due link da copiare,
 * con un nome che dice di quale chiamata sono; una chiamata archiviata non
 * li offre; oltre la prima pagina le altre si aggiungono in fondo.
 */

const m = messages.admin.instantCalls;

function riga(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    slug: `chiamata-${id}`,
    title: `Chiamata ${id}`,
    status: 'ENDED',
    createdAt: '2026-10-19T10:00:00.000Z',
    lastActiveAt: null,
    endsAt: '2026-10-19T14:00:00.000Z',
    moderatorName: null,
    moderatorToken: `token-${id}`,
    peakParticipants: 3,
    recordingUrl: null,
    recordingDuration: null,
    recordingFileSize: null,
    callSessionsCount: 1,
    registrationsCount: 0,
    ...patch,
  };
}

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mostra() {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <InstantCallsList locale="it" idleGraceMinutes={45} />
      </NextIntlClientProvider>
    );
  });
  // Il primo caricamento parte dopo l'attesa dei filtri.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

describe('InstantCallsList', () => {
  it('i link da copiare dicono di quale chiamata sono; quella archiviata non li ha', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ rows: [riga('a'), riga('b', { status: 'ARCHIVED' })], total: 2 })
      )
    );
    await mostra();
    const nomi = Array.from(container.querySelectorAll('.chiamata__link button')).map(
      (b) => b.getAttribute('aria-label')
    );
    expect(nomi).toEqual([
      m.copyModeratorLink.replace('{title}', 'Chiamata a'),
      m.copyGuestLink.replace('{title}', 'Chiamata a'),
    ]);
    expect(container.textContent).toContain('3 partecipanti');
    expect(container.textContent).toContain('2 chiamate');
  });

  it('«Mostra altre» chiede la pagina dopo e la aggiunge in fondo', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [riga('a')], total: 2 }))
    );
    await mostra();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [riga('b')], total: 2 }))
    );
    const altre = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === m.loadMore
    );
    await act(async () => altre?.click());
    const [url] = fetchMock.mock.calls[1] as [string];
    expect(url).toContain('offset=1');
    expect(
      Array.from(container.querySelectorAll('.chiamata__titolo')).map(
        (a) => a.textContent
      )
    ).toEqual(['Chiamata a', 'Chiamata b']);
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (b) => b.textContent === m.loadMore
      )
    ).toBe(false);
  });

  it('un elenco che non si legge lo dice, con «Riprova», invece di sembrare vuoto', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await mostra();
    expect(container.querySelector('[role=alert]')?.textContent).toContain(
      messages.common.errorGeneric
    );
    expect(container.textContent).not.toContain(m.noCalls);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [riga('a')], total: 1 }))
    );
    const riprova = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === messages.common.retry
    );
    await act(async () => {
      riprova?.click();
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(container.querySelector('[role=alert]')).toBeNull();
    expect(container.querySelector('.chiamata__titolo')?.textContent).toBe('Chiamata a');
  });
});
