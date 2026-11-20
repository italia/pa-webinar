// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

const { conferma } = vi.hoisted(() => ({ conferma: vi.fn(async () => true) }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => conferma }));

import RedactionEditor from './redaction-editor';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  conferma.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mostra(props: Partial<Parameters<typeof RedactionEditor>[0]> = {}) {
  const fatto = vi.fn();
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RedactionEditor
          requestId="req-1"
          hasVideo
          durationSec={600}
          proposals={[
            { start: 60, end: 180, source: 'presence' },
            { start: 99, end: 105, source: 'speech' },
          ]}
          initial={[{ start: 60, end: 180 }]}
          onSubmitted={fatto}
          {...props}
        />
      </NextIntlClientProvider>
    );
  });
  return fatto;
}

const pulsante = (testo: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === testo
  ) as HTMLButtonElement;

function scriviIn(input: HTMLInputElement, valore: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!;
  setter.call(input, valore);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('l’editor di rimozione', () => {
  it('apre il video dalla rotta in deroga e mostra le proposte e il totale', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          version: 1,
          duration: 600,
          buckets: 3,
          peaks: [0.1, 0.8, 0.3],
        }),
      }))
    );
    await mostra();
    // La forma d'onda sotto la linea del tempo.
    expect(container.querySelector('[role="slider"] polygon')).not.toBeNull();
    expect(container.querySelector('video')?.getAttribute('src')).toBe(
      '/api/admin/recording-removals/req-1/media'
    );
    expect(container.textContent).toContain('1 intervallo · 120 s da coprire');
    expect(
      container.querySelector('[role="slider"]')?.getAttribute('aria-valuemax')
    ).toBe('600');
  });

  it('un tempo scritto a mano si corregge, uno sbagliato si segnala', async () => {
    await mostra();
    const [inizio] = [
      ...container.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]'),
    ];
    await act(async () => scriviIn(inizio!, 'abc'));
    expect(inizio!.getAttribute('aria-invalid')).toBe('true');
    expect(container.textContent).toContain('Tempo non valido');
    await act(async () => scriviIn(inizio!, '2:00'));
    await act(async () =>
      inizio!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    );
    expect(container.textContent).toContain('60 s da coprire');
  });

  it('aggiunge, toglie e riparte dalle proposte', async () => {
    await mostra({ initial: [] });
    expect(container.textContent).toContain('Nessun intervallo da coprire');
    // Con un video, senza intervalli non si invia: si respinge.
    expect(pulsante('Togli la persona dalla registrazione').disabled).toBe(true);
    await act(async () => pulsante('Riparti dalle proposte').click());
    expect(container.textContent).toContain('1 intervallo · 120 s da coprire');
    await act(async () => pulsante('Aggiungi un intervallo qui').click());
    expect(container.textContent).toContain('2 intervalli · 125 s da coprire');
    await act(async () => pulsante('Togli').click());
    expect(container.textContent).toContain('1 intervallo · 5 s da coprire');
  });

  it('invia gli intervalli uniti dopo la conferma', async () => {
    const chiamata = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ status: 'PROCESSING' }),
    }));
    vi.stubGlobal('fetch', chiamata);
    const fatto = await mostra({
      initial: [
        { start: 60, end: 120 },
        { start: 100, end: 180 },
      ],
    });
    await act(async () => pulsante('Togli la persona dalla registrazione').click());
    expect(conferma).toHaveBeenCalled();
    // La forma d'onda si chiede in deroga come il video; poi l'invio.
    expect(chiamata.mock.calls.map((c) => c[0])).toEqual([
      '/api/admin/recording-removals/req-1/waveform',
      '/api/admin/recording-removals/req-1/submit',
    ]);
    expect(JSON.parse(chiamata.mock.calls[1]![1]!.body as string)).toEqual({
      intervals: [{ start: 60, end: 180 }],
    });
    expect(fatto).toHaveBeenCalledWith('PROCESSING');
  });

  it('senza conferma non invia; un errore del server si mostra', async () => {
    const chiamata = vi.fn(async () => ({ ok: false, status: 409 }));
    vi.stubGlobal('fetch', chiamata);
    conferma.mockResolvedValueOnce(false);
    await mostra({ hasVideo: false });
    // Senza video niente player ne' intervalli: si invia e basta.
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('[role="slider"]')).toBeNull();
    await act(async () => pulsante('Togli la persona dalla registrazione').click());
    expect(chiamata).not.toHaveBeenCalled();
    await act(async () => pulsante('Togli la persona dalla registrazione').click());
    expect(container.textContent).toContain('HTTP 409');
  });
});
