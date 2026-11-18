// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

const { conferma } = vi.hoisted(() => ({ conferma: vi.fn(async () => true) }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => conferma }));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  percorso: (p: string) => p,
  useRouter: () => ({ push: vi.fn() }),
}));

import RequestDetail, { type VistaRichiesta } from './request-detail';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function richiesta(over: Partial<VistaRichiesta> = {}): VistaRichiesta {
  return {
    id: 'req-1',
    status: 'OPEN',
    source: 'self-service',
    name: 'Anna Bianchi',
    note: null,
    createdAt: '2026-11-10T10:00:00Z',
    startedAt: null,
    closedAt: null,
    lastError: null,
    proposedIntervals: [{ start: 60, end: 180, source: 'presence' }],
    intervals: [],
    job: null,
    event: { id: 'ev-1', title: { it: 'Incontro' }, startsAt: '2026-11-09T10:00:00Z' },
    recording: { id: 'rec-1', durationSec: 600, hasVideo: true, tracks: 0 },
    externalCopy: false,
    publishedElsewhere: false,
    pipelineEnabled: true,
    ...over,
  };
}

async function mostra(vista: VistaRichiesta, accessAllowed = true) {
  const chiamata = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () =>
      init?.method === 'POST'
        ? { ok: true }
        : { request: url.endsWith('/start') ? vista : vista, accessAllowed },
  }));
  vi.stubGlobal('fetch', chiamata);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RequestDetail id="req-1" />
      </NextIntlClientProvider>
    );
  });
  return chiamata;
}

const pulsante = (testo: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === testo
  ) as HTMLButtonElement;

describe('la pagina di una richiesta di rimozione', () => {
  it('aperta: chi, cosa, e l’editor solo dopo averlo aperto (accesso tracciato)', async () => {
    const chiamata = await mostra(
      richiesta({ externalCopy: true, pipelineEnabled: false })
    );
    expect(container.textContent).toContain('Anna Bianchi');
    expect(container.textContent).toContain('I miei dati');
    expect(container.textContent).toContain('YouTube');
    expect(container.textContent).toContain('La post-produzione è spenta');
    expect(container.querySelector('video')).toBeNull();
    await act(async () => pulsante("Apri l'editor di rimozione").click());
    expect(chiamata).toHaveBeenCalledWith('/api/admin/recording-removals/req-1/start', {
      method: 'POST',
    });
    expect(container.querySelector('video')).not.toBeNull();
  });

  it('con la chiave dell’istanza non c’e’ editor', async () => {
    await mostra(richiesta(), false);
    expect(container.textContent).toContain('Con la chiave dell');
    expect(pulsante("Apri l'editor di rimozione")).toBeUndefined();
  });

  it('respinge con un motivo, dopo la conferma', async () => {
    const chiamata = await mostra(richiesta({ status: 'IN_PROGRESS' }));
    const area = container.querySelector('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )!.set!;
      setter.call(area, 'Non compare');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => pulsante('Respingi').click());
    const invio = chiamata.mock.calls.find((c) => String(c[0]).endsWith('/reject'));
    expect(JSON.parse(invio![1]!.body as string)).toEqual({ note: 'Non compare' });
  });

  it('in elaborazione, chiusa e respinta: lo stato, senza editor', async () => {
    await mostra(richiesta({ status: 'PROCESSING', job: { status: 'RUNNING' } }));
    expect(container.textContent).toContain('Stato del lavoro: RUNNING');
    expect(container.querySelector('textarea')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    await mostra(
      richiesta({
        status: 'CLOSED',
        closedAt: '2026-11-12T10:00:00Z',
        intervals: [{ start: 1, end: 2 }],
      })
    );
    expect(container.textContent).toContain('1 intervallo coperto');
  });
});
