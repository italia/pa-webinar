// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import AdminLoginPage from './page';

const fetchMock = vi.fn();
let container: HTMLDivElement;
let root: Root;

function render() {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <AdminLoginPage />
      </NextIntlClientProvider>
    );
  });
}

async function accedi(chiave: string) {
  const campo = container.querySelector<HTMLInputElement>('#admin-key')!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set;
  act(() => {
    setter?.call(campo, chiave);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const form = campo.closest('form')!;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
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

describe('accesso con la chiave dell istanza — il messaggio dice il perche', () => {
  it('chiave rifiutata: chiave non valida', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    render();
    await accedi('sbagliata');
    expect(container.textContent).toContain(messages.admin.login.invalidKey);
  });

  it('troppi tentativi dalla stessa rete: aspettare, non «chiave non valida»', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
    render();
    await accedi('giusta');
    expect(container.textContent).toContain(messages.apiErrors.rateLimited);
    expect(container.textContent).not.toContain(messages.admin.login.invalidKey);
  });

  it('rete caduta: la richiesta non e partita', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render();
    await accedi('giusta');
    expect(container.textContent).toContain(messages.admin.staffLogin.error);
    expect(container.textContent).not.toContain(messages.admin.login.invalidKey);
  });
});
