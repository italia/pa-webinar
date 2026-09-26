import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import FileOrUrlInput from './file-or-url-input';
import { UploadsAvailabilityProvider } from './uploads-availability';

/**
 * Il campo "file o URL" dell'area admin su un'installazione senza storage per
 * i file: non propone un caricamento destinato a fallire, e se il server
 * risponde che lo storage manca lo dice in italiano invece di mostrare il
 * messaggio tecnico destinato all'operatore.
 */
const t = messages.admin.fileOrUrl;
const fetchMock = vi.fn();

let container: HTMLDivElement;
let root: Root;

function disegna(children: ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        {children}
      </NextIntlClientProvider>,
    );
  });
}

function campo(value: string | null) {
  return (
    <FileOrUrlInput id="logo" label="Logo" value={value} onChange={vi.fn()} assetType="image" />
  );
}

function senzaStorage(children: ReactNode) {
  return <UploadsAvailabilityProvider available={false}>{children}</UploadsAvailabilityProvider>;
}

/** Sceglie un file nel campo e lascia arrivare la risposta del server. */
async function scegliFile() {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('campo file non trovato');
  const file = new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function risposta(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
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
});

describe('FileOrUrlInput senza storage per i file', () => {
  it('offre solo l’URL e spiega perché', () => {
    disegna(senzaStorage(campo(null)));
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('input[type="url"]')).not.toBeNull();
    expect(container.textContent).toContain(t.uploadsUnavailable);
  });

  it('la casella dell’URL segue il valore arrivato dopo il primo disegno', () => {
    disegna(senzaStorage(campo(null)));
    disegna(senzaStorage(campo('https://example.org/logo.png')));
    const url = container.querySelector<HTMLInputElement>('input[type="url"]');
    expect(url?.value).toBe('https://example.org/logo.png');
  });
});

describe('FileOrUrlInput con il caricamento proposto', () => {
  it('fuori dal provider resta com’era: caricamento e URL', () => {
    disegna(campo(null));
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(container.textContent).not.toContain(t.uploadsUnavailable);
  });

  it('se il server risponde STORAGE_UNAVAILABLE lo dice nella lingua della pagina', async () => {
    fetchMock.mockResolvedValue(
      risposta(503, {
        error: 'Files storage is not configured on this instance.',
        code: 'STORAGE_UNAVAILABLE',
      }),
    );
    disegna(campo(null));
    await scegliFile();
    expect(fetchMock).toHaveBeenCalledOnce();
    const avviso = container.querySelector('[role="alert"]');
    expect(avviso?.textContent).toBe(t.uploadsUnavailable);
  });

  it('gli altri errori del server restano come prima', async () => {
    fetchMock.mockResolvedValue(
      risposta(422, { error: 'Messaggio del server', code: 'VALIDATION_ERROR' }),
    );
    disegna(campo(null));
    await scegliFile();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Messaggio del server');
  });
});
