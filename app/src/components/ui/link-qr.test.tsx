import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import qrcode from 'qrcode-generator';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { finestraNativa } from '@/test/dialog';

import LinkQr, { disegnoQr, fileSvgQr, nomeFileQr } from './link-qr';

/**
 * Il QR di un link: disegnato qui, dal link stesso, e aperto in un dialogo
 * con il nome del link, l'indirizzo in chiaro e il file da scaricare.
 */

const LINK = 'https://webinar.example.gov.it/it/eventi/incontro-di-prova/live';

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
});

async function disegna(url = LINK, onApertura?: (aperto: boolean) => void) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <LinkQr
          url={url}
          nome="Link per partecipare"
          nomeFile="qr-incontro-di-prova-live"
          onApertura={onApertura}
        />
      </NextIntlClientProvider>
    );
  });
}

describe('disegnoQr', () => {
  it('un tratto del percorso per ogni modulo scuro del codice, con quattro moduli di bordo', async () => {
    const atteso = qrcode(0, 'M');
    atteso.addData(LINK, 'Byte');
    atteso.make();
    const n = atteso.getModuleCount();

    const disegno = (await disegnoQr(LINK))!;
    expect(disegno.lato).toBe(n + 8);

    // Le strisce del percorso, ricostruite modulo per modulo.
    const scuri = new Set<string>();
    for (const [, x, y, w] of disegno.d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let i = 0; i < Number(w); i++)
        scuri.add(`${Number(x) + i - 4},${Number(y) - 4}`);
    }
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        expect(scuri.has(`${c},${r}`), `${r},${c}`).toBe(atteso.isDark(r, c));
      }
    }
  });

  it('caratteri non latini: come li scrive il browser', async () => {
    const codificato = '%CE%B5%CE%BA%CE%B4%CE%B7%CE%BB%CF%8E%CF%83%CE%B5%CE%B9%CF%82';
    const greco = await disegnoQr('https://esempio.gov.it/el/εκδηλώσεις');
    expect(greco).not.toBeNull();
    expect(greco).toEqual(await disegnoQr(`https://esempio.gov.it/el/${codificato}`));
    expect(greco).not.toEqual(await disegnoQr('https://esempio.gov.it/el/x'));
  });

  it('niente codice per un link che il telefono non aprirebbe, o troppo lungo', async () => {
    expect(await disegnoQr('webinar.example.gov.it/it/eventi/x')).toBeNull();
    expect(await disegnoQr('/it/eventi/x')).toBeNull();
    expect(await disegnoQr('javascript:alert(1)')).toBeNull();
    expect(await disegnoQr(`https://esempio.gov.it/${'a'.repeat(5000)}`)).toBeNull();
  });

  it("il file da scaricare e' un SVG nero su bianco", async () => {
    const disegno = (await disegnoQr(LINK))!;
    const svg = fileSvgQr(disegno);
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain(`<path d="${disegno.d}" fill="#000"/>`);
  });

  it('lo stesso nome di file per lo stesso link, dovunque', () => {
    expect(nomeFileQr('incontro', 'pagina')).toBe('qr-incontro');
    expect(nomeFileQr('incontro', 'sala')).toBe('qr-incontro-live');
  });
});

describe('LinkQr', () => {
  it("il pulsante dice di quale link, e apre il codice gia' disegnato", async () => {
    const { showModal, close } = finestraNativa();
    const onApertura = vi.fn();
    await disegna(LINK, onApertura);

    const pulsante = container.querySelector('button')!;
    expect(pulsante.getAttribute('aria-label')).toBe('QR — Link per partecipare');
    expect(container.querySelector('[role="img"]')).toBeNull();
    // Quando il dialogo si apre, il codice c'e' gia'.
    showModal.mockImplementation(function (this: HTMLDialogElement) {
      expect(this.querySelector('[role="img"]')).not.toBeNull();
      this.setAttribute('open', '');
    });
    await act(async () => {
      pulsante.click();
      await vi.dynamicImportSettled();
    });
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(onApertura).toHaveBeenLastCalledWith(true);

    const dialogo = container.querySelector('dialog')!;
    expect(dialogo.querySelector('h2')!.textContent).toBe(
      'Codice QR: Link per partecipare'
    );
    expect(dialogo.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe(
      'Codice QR del link «Link per partecipare»'
    );
    expect(dialogo.querySelector('path')!.getAttribute('d')).toBe(
      (await disegnoQr(LINK))!.d
    );
    expect(dialogo.textContent).toContain(LINK);

    const chiudi = Array.from(dialogo.querySelectorAll('button')).find(
      (b) => b.textContent === 'Chiudi'
    )!;
    act(() => chiudi.click());
    expect(close).toHaveBeenCalledTimes(1);
    expect(onApertura).toHaveBeenLastCalledWith(false);
  });

  it('se sparisce con il codice aperto, lo dice a chi lo ospita', async () => {
    finestraNativa();
    const onApertura = vi.fn();
    await disegna(LINK, onApertura);
    await act(async () => {
      container.querySelector('button')!.click();
      await vi.dynamicImportSettled();
    });
    expect(onApertura).toHaveBeenLastCalledWith(true);
    act(() => root.render(<></>));
    expect(onApertura).toHaveBeenLastCalledWith(false);
  });

  it("nessun pulsante per un link che non e' un indirizzo web assoluto", async () => {
    await disegna('webinar.example.gov.it/it/eventi/incontro-di-prova');
    expect(container.querySelector('button')).toBeNull();
  });

  it('lo sfondo chiude solo se il clic comincia sullo sfondo', async () => {
    const { close } = finestraNativa();
    await disegna();
    await act(async () => {
      container.querySelector('button')!.click();
      await vi.dynamicImportSettled();
    });
    const dialogo = container.querySelector('dialog')!;
    const testo = dialogo.querySelector('.link-qr__link')!;

    // Si seleziona l'indirizzo e si rilascia fuori: il clic arriva al dialogo.
    act(() => {
      testo.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      dialogo.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(close).not.toHaveBeenCalled();

    act(() => {
      dialogo.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      dialogo.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('«Scarica» salva il file SVG con il nome dato', async () => {
    finestraNativa();
    const statici = URL as unknown as {
      createObjectURL?: (b: Blob) => string;
      revokeObjectURL?: (u: string) => void;
    };
    const prima = { crea: statici.createObjectURL, rilascia: statici.revokeObjectURL };
    const creaUrl = vi.fn((_: Blob) => 'blob:qr');
    statici.createObjectURL = creaUrl;
    statici.revokeObjectURL = vi.fn();
    const clic = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe('qr-incontro-di-prova-live.svg');
        expect(this.href).toBe('blob:qr');
      });
    onTestFinished(() => {
      statici.createObjectURL = prima.crea;
      statici.revokeObjectURL = prima.rilascia;
      clic.mockRestore();
    });
    await disegna();
    await act(async () => {
      container.querySelector('button')!.click();
      await vi.dynamicImportSettled();
    });

    const scarica = Array.from(container.querySelectorAll('dialog button')).find((b) =>
      b.textContent?.startsWith('Scarica')
    ) as HTMLButtonElement;
    act(() => scarica.click());
    expect(clic).toHaveBeenCalledTimes(1);
    const blob = creaUrl.mock.calls[0]![0];
    expect(blob.type).toBe('image/svg+xml');
    expect(await blob.text()).toBe(fileSvgQr((await disegnoQr(LINK))!));
  });
});

describe("LinkQr, quando il codice non si puo' fare", () => {
  it('se la libreria non si carica il dialogo lo dice, senza scaricare niente', async () => {
    finestraNativa();
    vi.doMock('qrcode-generator', () => {
      throw new Error('chunk non trovato');
    });
    onTestFinished(() => {
      vi.doUnmock('qrcode-generator');
    });
    vi.resetModules();
    const { default: LinkQrFresco } = await import('./link-qr');
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <LinkQrFresco url={LINK} nome="Link per partecipare" nomeFile="qr-x" />
        </NextIntlClientProvider>
      );
    });
    await act(async () => {
      container.querySelector('button')!.click();
      await vi.dynamicImportSettled();
    });
    const dialogo = container.querySelector('dialog')!;
    expect(dialogo.hasAttribute('open')).toBe(true);
    expect(dialogo.querySelector('[role="alert"]')!.textContent).toBe(
      messages.common.qr.error
    );
    expect(dialogo.querySelector('[role="img"]')).toBeNull();
    expect(
      Array.from(dialogo.querySelectorAll('button')).some((b) =>
        b.textContent?.startsWith('Scarica')
      )
    ).toBe(false);
  });
});
