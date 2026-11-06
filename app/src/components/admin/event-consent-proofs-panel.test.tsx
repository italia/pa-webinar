// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

import messages from '@/i18n/messages/it.json';

import EventConsentProofsPanel from './event-consent-proofs-panel';

let container: HTMLDivElement;
let root: Root;

const riepilogo = {
  summary: {
    recording: { given: 3, withdrawn: 1 },
    transcription: { given: 1, withdrawn: 0 },
  },
  total: 4,
  retained: 0,
};

async function monta(corpo: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(corpo), { status }))
  );
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <EventConsentProofsPanel eventId="evento-1" locale="it" />
        </SWRConfig>
      </NextIntlClientProvider>
    );
  });
}

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

describe('EventConsentProofsPanel', () => {
  it('senza prove conservate non ne parla', async () => {
    await monta(riepilogo);
    expect(container.textContent).toContain('acconsentono 3');
    expect(container.textContent).not.toContain('conservat');
  });

  it('dice quante prove sono conservate', async () => {
    await monta({ ...riepilogo, retained: 2 });
    expect(container.textContent).toContain(
      '2 prove sono conservate finché il video o la trascrizione restano pubblicati.'
    );
  });

  it('una sola prova ha il singolare', async () => {
    await monta({ ...riepilogo, retained: 1 });
    expect(container.textContent).toContain('1 prova è conservata');
  });

  it('un evento ripulito con le sole prove conservate non dice «nessun consenso»', async () => {
    await monta({ ...riepilogo, retained: 4 });
    expect(container.textContent).not.toContain(messages.admin.consentProofs.none);
  });

  it('senza prove lo dice', async () => {
    await monta({ ...riepilogo, total: 0 });
    expect(container.textContent).toContain(messages.admin.consentProofs.none);
  });

  it('un errore di lettura lo dice', async () => {
    await monta({}, 500);
    expect(container.textContent).toContain(messages.admin.consentProofs.loadFailed);
  });
});
