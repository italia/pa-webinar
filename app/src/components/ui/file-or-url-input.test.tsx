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

describe('FileOrUrlInput — immagini di altri siti', () => {
  it('avvisa che un\'immagine presa da un altro sito non comparirà', () => {
    disegna(campo('https://altro-sito.example/copertina.png'));
    expect(container.textContent).toContain(t.externalImage);
  });

  it('nessun avviso per un\'immagine servita dal portale', () => {
    disegna(campo(`${window.location.origin}/api/files/copertina.png`));
    expect(container.textContent).not.toContain(t.externalImage);
  });

  it('un file servito da un\'altra installazione e\' esterno anche se il percorso e\' /api/assets/', () => {
    disegna(campo('https://altra-pa.example/api/assets/logo.png'));
    expect(container.textContent).toContain(t.externalImage);
  });

  it('le anteprime di YouTube, ammesse dalla CSP, non avvisano', () => {
    disegna(campo('https://i.ytimg.com/vi/abc/hqdefault.jpg'));
    expect(container.textContent).not.toContain(t.externalImage);
  });

  it('con il caricamento disponibile consiglia di caricare il file', () => {
    disegna(campo('https://altro-sito.example/copertina.png'));
    expect(container.querySelector('[role="status"]')?.textContent).toContain(t.externalImageUpload);
  });

  it('un campo che non finisce nelle pagine puo\' fare a meno dell\'avviso', () => {
    disegna(
      <FileOrUrlInput
        id="seo"
        label="SEO"
        value="https://altro-sito.example/anteprima.png"
        onChange={vi.fn()}
        assetType="image"
        avvisoImmagineEsterna={false}
      />,
    );
    expect(container.textContent).not.toContain(t.externalImage);
  });

  it('l\'avviso e\' una regione di stato e consiglia il caricamento solo se c\'e\'', () => {
    disegna(senzaStorage(campo('https://altro-sito.example/copertina.png')));
    const stato = container.querySelector('[role="status"]');
    expect(stato?.textContent).toContain(t.externalImage);
    expect(stato?.textContent).not.toContain(t.externalImageUpload);
    expect(container.querySelector('input[type="url"]')?.getAttribute('aria-describedby')).toBe(stato?.id);
  });

  it('nessun avviso per un indirizzo relativo o un\'immagine inline', () => {
    disegna(campo('/api/files/copertina.png'));
    expect(container.textContent).not.toContain(t.externalImage);
    disegna(campo('data:image/png;base64,iVBORw0KGgo='));
    expect(container.textContent).not.toContain(t.externalImage);
  });
});

describe('formato richiesto: il ritaglio prima del caricamento', () => {
  let misura = { w: 1600, h: 900 };
  class ImmagineFinta {
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      this.naturalWidth = misura.w;
      this.naturalHeight = misura.h;
      setTimeout(() => this.onload?.(), 0);
    }
  }

  beforeEach(() => {
    vi.stubGlobal('Image', ImmagineFinta);
    URL.createObjectURL = () => 'blob:prova';
    URL.revokeObjectURL = () => {};
    fetchMock.mockResolvedValue(
      risposta(200, {
        url: 'https://webinar.example.gov.it/api/assets/image/a.jpg',
        key: 'k',
        mime: 'image/jpeg',
        size: 1,
        filename: 'a.jpg',
      }),
    );
  });

  const copertina = (ritaglio?: { rapporto: number; larghezza: number }) => (
    <FileOrUrlInput
      id="cover"
      label="Copertina"
      value={null}
      onChange={vi.fn()}
      assetType="image"
      uploadsEnabled
      ritaglio={ritaglio}
    />
  );

  it('un\'immagine gia\' 16:9 si carica com\'e\'', async () => {
    misura = { w: 1600, h: 900 };
    disegna(copertina({ rapporto: 16 / 9, larghezza: 1600 }));
    await scegliFile();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(t.crop.title);
  });

  it('un\'immagine di altro formato apre il ritaglio; annullando non si carica niente', async () => {
    misura = { w: 1000, h: 1000 };
    disegna(copertina({ rapporto: 16 / 9, larghezza: 1600 }));
    await scegliFile();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(t.crop.title);
    const annulla = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent === t.crop.cancel,
    )!;
    await act(async () => annulla.click());
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('senza formato richiesto nessun ritaglio, qualunque sia la forma', async () => {
    misura = { w: 1000, h: 1000 };
    disegna(copertina());
    await scegliFile();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
