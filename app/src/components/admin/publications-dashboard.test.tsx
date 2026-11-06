// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

/**
 * La libreria video mostra solo le registrazioni per tutti: nel pannello una
 * registrazione riservata lo dice, e l'azione che la metterebbe in libreria non
 * si puo' usare. Una riga che c'era gia' si puo' togliere.
 */
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ error: vi.fn() }) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  percorso: (p: string) => p,
}));

import PublicationsDashboard from './publications-dashboard';

const t = messages.admin.publications;

const riga = (over: Record<string, unknown> = {}) => ({
  id: 'evento-1',
  slug: 'evento-1',
  title: 'Evento',
  description: '',
  source: 'scheduled',
  eventType: 'SCHEDULED',
  status: 'ENDED',
  startsAt: '2026-10-01T08:00:00.000Z',
  endsAt: '2026-10-01T09:00:00.000Z',
  libraryListed: false,
  postEventPublic: true,
  recordingAudience: 'PUBLIC',
  coverImageUrl: null,
  imageUrl: null,
  youtubeUrl: null,
  hasPublishedRecording: true,
  recordingPublishedAt: null,
  pendingSessionRecordings: 0,
  registrationCount: 0,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

async function mostra(righe: Array<Record<string, unknown>>) {
  const corpo = {
    rows: righe,
    total: righe.length,
    counters: { scheduled: righe.length, instant: 0, legacy: 0, pending: 0, listed: 0 },
  };
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify(corpo), { status: 200 })
  );
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <PublicationsDashboard />
      </NextIntlClientProvider>
    );
  });
  // Il pannello chiede l'elenco dopo una breve attesa.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

const azione = (etichetta: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent === etichetta
  )!;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
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

describe('PublicationsDashboard — registrazione riservata', () => {
  it('lo dice, e non si mette in libreria', async () => {
    await mostra([riga({ recordingAudience: 'REGISTRANTS' })]);
    expect(container.textContent).toContain(t.reservedBadge);
    expect(container.textContent).toContain(t.reservedHelp);
    const bottone = azione(t.actions.list);
    expect(bottone.disabled).toBe(true);
    const motivo = container.querySelector(
      `#${bottone.getAttribute('aria-describedby')}`
    );
    expect(motivo?.textContent).toBe(t.reservedHelp);
  });

  it('una riga gia’ in libreria si puo’ togliere', async () => {
    await mostra([riga({ recordingAudience: 'REGISTRANTS', libraryListed: true })]);
    expect(container.textContent).toContain(t.reservedBadge);
    expect(container.textContent).not.toContain(t.reservedHelp);
    expect(azione(t.actions.unlist).disabled).toBe(false);
  });

  it('una registrazione per tutti resta com’era', async () => {
    await mostra([riga()]);
    expect(container.textContent).not.toContain(t.reservedBadge);
    expect(azione(t.actions.list).disabled).toBe(false);
  });

  it('il motivo e’ legato alla sua riga', async () => {
    await mostra([
      riga({ id: 'a', slug: 'a', recordingAudience: 'REGISTRANTS' }),
      riga({ id: 'b', slug: 'b', recordingAudience: 'REGISTRANTS' }),
    ]);
    const ids = Array.from(container.querySelectorAll('button[aria-describedby]')).map(
      (b) => b.getAttribute('aria-describedby')
    );
    expect(new Set(ids).size).toBe(2);
  });
});
