// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  percorso: (p: string) => p,
}));

import RubricaList from './rubrica-list';

/**
 * L'elenco della rubrica: senza testo elenca con una GET, con un testo cerca con
 * una POST, perche' un nome o un indirizzo non restino negli URL.
 */

let container: HTMLDivElement;
let root: Root;
const risposta = vi.fn();

const riga = {
  id: 'p1',
  displayName: 'Persona 1',
  organization: null,
  organizationRole: null,
  organizationType: null,
  optedInToAddressBook: true,
  optedInAt: null,
  optedOutAt: null,
  lastActiveAt: '2026-01-01T00:00:00.000Z',
  registrationCount: 0,
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  risposta.mockReset();
  risposta.mockResolvedValue({
    ok: true,
    json: async () => ({ rows: [riga], total: 1 }),
  });
  vi.stubGlobal('fetch', risposta);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mostra() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RubricaList />
      </NextIntlClientProvider>
    );
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function scrivi(testo: string) {
  const campo = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      campo,
      testo
    );
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(400);
  });
}

describe('RubricaList', () => {
  it('senza testo elenca con una GET', async () => {
    await mostra();
    const [url, opzioni] = risposta.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/admin/rubrica?');
    expect(opzioni.method).toBeUndefined();
    expect(container.textContent).toContain('Persona 1');
  });

  it("con un testo cerca nel corpo di una POST, mai nell'URL", async () => {
    await mostra();
    await scrivi('giulia');
    const [url, opzioni] = risposta.mock.calls.at(-1)! as [string, RequestInit];
    expect(url).toBe('/api/admin/rubrica');
    expect(opzioni.method).toBe('POST');
    expect(JSON.parse(opzioni.body as string)).toEqual({
      q: 'giulia',
      includeOptedOut: false,
    });
  });

  it('dice quando la ricerca non ha guardato tutte le voci', async () => {
    await mostra();
    risposta.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [], total: 0, scanLimit: 5000 }),
    });
    await scrivi('giulia');
    expect(container.textContent).toContain(
      messages.admin.rubrica.searchPartial.replace('{limit}', '5000')
    );
  });
});
