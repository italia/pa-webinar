import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { finestraNativa } from '@/test/dialog';

import LiveShareButton from './live-share-button';

/**
 * «Condividi» in sala: Esc, un clic fuori o il passaggio a un'altra finestra
 * chiudono il fumetto; con il codice QR aperto sopra, Esc chiude solo il QR e
 * il fumetto resta anche se si passa a un'altra finestra (il QR e' proiettato).
 * Il link da moderatore non ha mai un QR.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function disegna(moderatorToken?: string) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <LiveShareButton
          slug="incontro-di-prova"
          locale="it"
          moderatorToken={moderatorToken}
        />
      </NextIntlClientProvider>
    );
  });
}

const fumetto = () => container.querySelector('.live-share__pop');

function apriFumetto() {
  act(() => container.querySelector<HTMLButtonElement>('.live-share-btn')!.click());
  expect(fumetto()).not.toBeNull();
}

/** Un tasto premuto sulla pagina, dove lo ascoltano anche gli altri pannelli. */
function premi(tasto: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: tasto, bubbles: true, cancelable: true });
  act(() => {
    document.body.dispatchEvent(e);
  });
  return e;
}

function lasciaChiudere() {
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

describe('LiveShareButton', () => {
  it("Esc e il passaggio a un'altra finestra chiudono il fumetto", async () => {
    await disegna();
    apriFumetto();
    premi('Escape');
    lasciaChiudere();
    expect(fumetto()).toBeNull();

    apriFumetto();
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    lasciaChiudere();
    expect(fumetto()).toBeNull();
  });

  it('con il QR aperto Esc non arriva agli altri pannelli e il fumetto resta, anche cambiando finestra', async () => {
    finestraNativa();
    const pannello = vi.fn();
    document.addEventListener('keydown', pannello);
    try {
      await disegna();
      apriFumetto();
      const qr = container.querySelectorAll<HTMLButtonElement>('.live-share__qr');
      expect(qr).toHaveLength(2);
      await act(async () => {
        qr[0]!.click();
        await vi.dynamicImportSettled();
      });
      expect(container.querySelector('dialog.link-qr[open]')).not.toBeNull();

      const esc = premi('Escape');
      // Il <dialog> si chiude da se' con Esc: niente preventDefault.
      expect(esc.defaultPrevented).toBe(false);
      expect(pannello).not.toHaveBeenCalled();
      act(() => {
        window.dispatchEvent(new Event('blur'));
      });
      lasciaChiudere();
      expect(fumetto()).not.toBeNull();

      // Chiuso il QR, tutto torna come prima.
      act(() =>
        container.querySelector('dialog.link-qr')!.dispatchEvent(new Event('close'))
      );
      act(() => {
        window.dispatchEvent(new Event('blur'));
      });
      lasciaChiudere();
      expect(fumetto()).toBeNull();
    } finally {
      document.removeEventListener('keydown', pannello);
    }
  });

  it('il link da moderatore non ha un QR', async () => {
    await disegna('TOKEN_MODERATORE');
    apriFumetto();
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('Mostra link da moderatore'))!
        .click()
    );
    expect(container.querySelector('.live-share__mod-body')).not.toBeNull();
    expect(container.querySelectorAll('.live-share__qr')).toHaveLength(2);
    expect(container.querySelector('.live-share__mod-body .live-share__qr')).toBeNull();
  });
});
