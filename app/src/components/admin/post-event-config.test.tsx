import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import PostEventConfig from './post-event-config';

/**
 * Un interruttore della configurazione post-evento il cui salvataggio non va
 * (sessione scaduta, rete assente) tornava a non dire nulla: restava acceso,
 * mentre la pagina che lo ospita — che cambia solo a salvataggio riuscito —
 * continuava a nascondere i pulsanti della pagina pubblica. Ora torna com'era
 * e lo dice.
 */

const evento = {
  id: 'evento-1',
  moderatorToken: 'TOKEN',
  postEventPublic: false,
  postEventPublicUntil: null,
  libraryListed: false,
  hasPlayableRecording: false,
  postEventShowQA: false,
  postEventShowMaterials: false,
  postEventShowPolls: false,
  postEventShowFeedback: false,
  postEventShowRecap: false,
  postEventShowWordCloud: false,
  postEventEmailEnabled: false,
  feedbackEnabled: false,
  dataRetentionDays: 30,
};

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const onPublicPageChange = vi.fn();

function render() {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <PostEventConfig event={evento} onPublicPageChange={onPublicPageChange} />
      </NextIntlClientProvider>,
    );
  });
}

function interruttore(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(
    `input[aria-label="${messages.postEvent.pageVisible}"]`,
  );
  if (!el) throw new Error('interruttore della pagina pubblica non trovato');
  return el;
}

/** L'avviso del salvataggio (la nota sulla retention è un altro `role="alert"`). */
function avviso(): HTMLElement | null {
  return container.querySelector<HTMLElement>('.text-danger[role="alert"]');
}

async function premi(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  // La risposta del server arriva dopo il click.
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  onPublicPageChange.mockReset();
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

describe('PostEventConfig — salvataggio di un interruttore', () => {
  it('accettato: resta acceso e la pagina lo sa', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    render();
    await premi(interruttore());
    expect(interruttore().checked).toBe(true);
    expect(onPublicPageChange).toHaveBeenCalledWith({ postEventPublic: true });
    expect(avviso()).toBeNull();
  });

  it('rifiutato dal server: torna com’era e lo dice', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }));
    render();
    await premi(interruttore());
    expect(interruttore().checked).toBe(false);
    expect(onPublicPageChange).not.toHaveBeenCalled();
    expect(avviso()?.textContent).toBe(
      messages.common.errorGeneric,
    );
  });

  it('senza rete: torna com’era, lo dice, e nessuna promessa rifiutata resta appesa', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render();
    await premi(interruttore());
    expect(interruttore().checked).toBe(false);
    expect(avviso()).not.toBeNull();
  });

  it('il salvataggio successivo riuscito toglie l’avviso', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    render();
    await premi(interruttore());
    expect(avviso()).not.toBeNull();

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await premi(interruttore());
    expect(interruttore().checked).toBe(true);
    expect(avviso()).toBeNull();
  });
});
