// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { suonaAvvisoCattura } from '@/lib/live/capture-tone';

import CaptureNotice, { type CatturaInSala } from './capture-notice';

vi.mock('@/lib/live/capture-tone', () => ({ suonaAvvisoCattura: vi.fn() }));

let container: HTMLDivElement;
let root: Root;

const monta = (stato: Partial<CatturaInSala> = {}) =>
  act(() =>
    root.render(
      <NextIntlClientProvider locale="it" messages={messages}>
        <CaptureNotice video={false} voci={false} trascrizione={false} {...stato} />
      </NextIntlClientProvider>
    )
  );
const testo = () => container.querySelector('.live-capture-notice')?.textContent ?? null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T10:00:00.000Z'));
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('CaptureNotice', () => {
  it("senza cattura non dice niente, ma la regione per i lettori di schermo c'e' gia'", () => {
    monta();
    expect(testo()).toBeNull();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(suonaAvvisoCattura).not.toHaveBeenCalled();
  });

  it('avvisa con testo e suono quando la registrazione parte', () => {
    monta();
    monta({ video: true });
    expect(testo()).toContain('Registrazione avviata');
    expect(suonaAvvisoCattura).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("chi entra a cattura in corso riceve lo stesso avviso, anche se le notizie arrivano una dopo l'altra", () => {
    monta({ video: true });
    act(() => vi.advanceTimersByTime(500));
    monta({ video: true, trascrizione: true });
    expect(testo()).toContain('Registrazione avviata');
    expect(testo()).toContain('Trascrizione avviata');
    expect(suonaAvvisoCattura).toHaveBeenCalledTimes(1);
  });

  it("con le voci gia' in registrazione dice quando parte e si ferma il video", () => {
    monta({ voci: true });
    act(() => vi.advanceTimersByTime(11_000));
    monta({ voci: true, video: true });
    expect(testo()).toContain('Registrazione avviata');
    expect(suonaAvvisoCattura).toHaveBeenLastCalledWith(true);
    act(() => vi.advanceTimersByTime(11_000));
    monta({ voci: true });
    expect(testo()).toContain('Registrazione terminata');
    expect(suonaAvvisoCattura).toHaveBeenLastCalledWith(false);
  });

  it("dopo qualche secondo se ne va da solo, e si puo' chiudere prima", () => {
    monta({ video: true });
    act(() => vi.advanceTimersByTime(10_000));
    expect(testo()).toBeNull();
    monta();
    act(() =>
      container.querySelector<HTMLButtonElement>('.live-capture-notice__chiudi')?.click()
    );
    expect(testo()).toBeNull();
  });

  it('una rilettura con lo stesso stato non ripete il suono', () => {
    monta({ video: true });
    monta({ video: true });
    expect(suonaAvvisoCattura).toHaveBeenCalledTimes(1);
  });
});
