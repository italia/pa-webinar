// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messaggi from '@/i18n/messages/it.json';

import ChatPanel from './chat-panel';

/**
 * L'avviso a non scrivere dati personali, sotto la casella. Lo stesso pannello
 * e' montato in sala, nel cassetto da telefono e in sala d'attesa.
 */
class FintoEventSource {
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  close = vi.fn();
  onerror = null;
  onopen = null;
  onmessage = null;
  readyState = 1;
}

const t = messaggi.live.chat;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('EventSource', FintoEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }))
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function disegna(altre: { isGuest?: boolean; isModerator?: boolean } = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messaggi} timeZone="Europe/Rome">
        <ChatPanel eventSlug="evento" token="" displayName="Persona" {...altre} />
      </NextIntlClientProvider>
    );
  });
}

const casella = () => container.querySelector<HTMLTextAreaElement>('.chat-panel__input')!;

describe('ChatPanel — avviso sui dati personali', () => {
  it('sta sotto la casella, dentro il riquadro che resta sempre visibile', async () => {
    await disegna();
    const avviso = container.querySelector('.chat-panel__notice');
    expect(avviso?.textContent).toBe(t.personalDataNotice);
    expect(container.querySelector('.chat-panel__composer')?.contains(avviso!)).toBe(
      true
    );
    const box = container.querySelector('.chat-panel__compose-box')!;
    expect(
      box.compareDocumentPosition(avviso!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('è collegato alla casella per chi usa uno screen reader', async () => {
    await disegna();
    const id = casella().getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe(t.personalDataNotice);
    expect(casella().getAttribute('aria-label')).toBe(t.inputLabel);
  });

  it.each([
    ['ospite', { isGuest: true }],
    ['chi modera', { isModerator: true }],
  ])('lo legge anche %s', async (_chi, altre) => {
    await disegna(altre);
    expect(container.textContent).toContain(t.personalDataNotice);
  });
});
