// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import RecordingRemoval, { type RimozioneVista } from './recording-removal';

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

async function mostra(rimozione: RimozioneVista) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RecordingRemoval token="tok" registrationId="reg-1" rimozione={rimozione} />
      </NextIntlClientProvider>
    );
  });
}

const pulsante = (testo: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === testo) as
    HTMLButtonElement | undefined;

describe('non comparire nella registrazione, da «I miei dati»', () => {
  it('non c’e’ dove l’evento non ha una registrazione', async () => {
    await mostra({ available: false, requests: [] });
    expect(container.textContent).toBe('');
  });

  it('chiede conferma, dice cosa non raggiunge, poi invia e mostra lo stato', async () => {
    const chiamata = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ requested: 1 }),
    }));
    vi.stubGlobal('fetch', chiamata);
    await mostra({ available: true, requests: [] });

    await act(async () =>
      pulsante('Non voglio comparire in questa registrazione')!.click()
    );
    expect(container.textContent).toContain('YouTube');
    expect(chiamata).not.toHaveBeenCalled();

    await act(async () => pulsante('Invia la richiesta')!.click());
    expect(chiamata).toHaveBeenCalledWith(
      '/api/gdpr/recording-removal',
      expect.objectContaining({ method: 'POST' })
    );
    expect(JSON.parse(chiamata.mock.calls[0]![1]!.body as string)).toEqual({
      token: 'tok',
      registrationId: 'reg-1',
    });
    expect(container.textContent).toContain('Richiesta inviata');
    expect(container.textContent).toContain('in lavorazione');
    // Con una richiesta aperta il pulsante non torna.
    expect(pulsante('Non voglio comparire in questa registrazione')).toBeUndefined();
  });

  it('se l’invio non riesce lo dice e lascia riprovare', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 }))
    );
    await mostra({ available: true, requests: [] });
    await act(async () =>
      pulsante('Non voglio comparire in questa registrazione')!.click()
    );
    await act(async () => pulsante('Invia la richiesta')!.click());
    expect(container.textContent).toContain('Non è stato possibile inviare la richiesta');
    expect(pulsante('Invia la richiesta')).toBeDefined();
  });

  it('mostra le richieste chiuse e respinte, e ne lascia fare una nuova', async () => {
    await mostra({
      available: true,
      requests: [
        {
          status: 'CLOSED',
          createdAt: '2026-11-01T10:00:00Z',
          closedAt: '2026-11-03T10:00:00Z',
        },
        {
          status: 'REJECTED',
          createdAt: '2026-11-05T10:00:00Z',
          closedAt: '2026-11-06T10:00:00Z',
        },
      ],
    });
    expect(container.textContent).toContain('completata il 3 novembre 2026');
    expect(container.textContent).toContain('respinta');
    expect(pulsante('Non voglio comparire in questa registrazione')).toBeDefined();
  });
});
