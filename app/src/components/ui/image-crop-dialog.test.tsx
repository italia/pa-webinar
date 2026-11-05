import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import ImageCropDialog from './image-crop-dialog';

/**
 * L'immagine del ritaglio arriva da `URL.createObjectURL`: un indirizzo del
 * browser, verificato dove nasce. Se non passa, il ritaglio dice che
 * l'immagine non si apre: una cornice vuota si confermerebbe alla cieca.
 */
class ImmagineFinta {
  static ultima: ImmagineFinta | null = null;
  naturalWidth = 1600;
  naturalHeight = 900;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';

  constructor() {
    ImmagineFinta.ultima = this;
  }
}

const creaIndirizzo = vi.fn<(file: Blob) => string>();
const revocaIndirizzo = vi.fn<(url: string) => void>();
const { createObjectURL, revokeObjectURL } = URL;
const RITAGLIO = { rapporto: 16 / 9, larghezza: 1600, fascia: 3 };
let contenitore: HTMLDivElement;
let radice: Root;

async function apri() {
  await act(async () => {
    radice.render(
      <NextIntlClientProvider locale="it" messages={messages}>
        <ImageCropDialog
          file={new File(['x'], 'foto.png', { type: 'image/png' })}
          ritaglio={RITAGLIO}
          onConferma={() => {}}
          onAnnulla={() => {}}
        />
      </NextIntlClientProvider>
    );
  });
  await act(async () => {
    ImmagineFinta.ultima?.onload?.();
  });
}

const sorgenti = () =>
  Array.from(document.querySelectorAll('.ritaglio-immagine img')).map((el) =>
    el.getAttribute('src')
  );

beforeEach(() => {
  ImmagineFinta.ultima = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('Image', ImmagineFinta);
  URL.createObjectURL = creaIndirizzo;
  URL.revokeObjectURL = revocaIndirizzo;
  revocaIndirizzo.mockClear();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(450);
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  radice = createRoot(contenitore);
});

afterEach(() => {
  act(() => radice.unmount());
  contenitore.remove();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('il ritaglio di un file scelto', () => {
  it("mostra l'immagine dall'indirizzo del browser, in cornice e nella fascia", async () => {
    creaIndirizzo.mockReturnValue('blob:http://localhost/0b0e1c2d');
    await apri();
    const viste = sorgenti();
    expect(viste).toHaveLength(3);
    expect(new Set(viste)).toEqual(new Set(['blob:http://localhost/0b0e1c2d']));
  });

  it('un indirizzo che non passa la verifica non arriva alla pagina', async () => {
    creaIndirizzo.mockReturnValue('javascript:alert(1)');
    await apri();
    expect(sorgenti()).toEqual([]);
    expect(document.querySelector('.ritaglio-immagine [role="alert"]')?.textContent).toBe(
      messages.admin.fileOrUrl.crop.error
    );
    expect(ImmagineFinta.ultima?.src ?? '').not.toContain('javascript:');
    expect(revocaIndirizzo).toHaveBeenCalledWith('javascript:alert(1)');
  });
});
