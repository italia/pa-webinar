// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import RegistrationConsents, { type ConsensiVista } from './registration-consents';

let container: HTMLDivElement;
let root: Root;
const dato = { dato: true, ritiratoIl: null };

const monta = (
  consensi: Partial<ConsensiVista>,
  altri: { comunicazioniRitirateIl?: string; onComunicazioniRitirate?: (q: string) => void } = {}
) =>
  act(() =>
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RegistrationConsents
          token="tok en"
          registrationId="r1"
          consensi={{
            recording: null,
            transcription: null,
            futureCommunications: null,
            ...consensi,
          }}
          {...altri}
        />
      </NextIntlClientProvider>
    )
  );
const pulsante = (nome: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === nome);
const clic = async (nome: string) => {
  await act(async () => {
    pulsante(nome)?.click();
  });
};

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

describe('RegistrationConsents', () => {
  it('senza consensi chiesti non mostra niente', () => {
    monta({});
    expect(container.textContent).toBe('');
  });

  it('il ritiro chiede una conferma, poi manda il consenso di questa iscrizione', async () => {
    const richiesta = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', richiesta);
    monta({ futureCommunications: dato });

    await clic('Ritira il consenso');
    expect(richiesta).not.toHaveBeenCalled();
    await clic('Ritira');

    expect(richiesta).toHaveBeenCalledWith(
      '/api/gdpr/consents',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          token: 'tok en',
          registrationId: 'r1',
          consent: 'futureCommunications',
        }),
      })
    );
    expect(container.textContent).toContain('Ritirato il');
  });

  it('ritirando la registrazione mostra ritirata anche la trascrizione', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
    monta({ recording: dato, transcription: dato });

    await clic('Ritira il consenso');
    await clic('Ritira');

    expect(container.textContent?.match(/Ritirato il/g)).toHaveLength(2);
  });

  it('prima di ritirare dice cosa cambia', async () => {
    monta({ transcription: dato });
    await clic('Ritira il consenso');
    expect(container.textContent).toContain(
      'le tue frasi già trascritte perdono testo e nome'
    );
  });

  it('il ritiro delle comunicazioni si riporta sulle altre schede', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
    const avvisa = vi.fn();
    monta({ futureCommunications: dato }, { onComunicazioniRitirate: avvisa });

    await clic('Ritira il consenso');
    await clic('Ritira');

    expect(avvisa).toHaveBeenCalledWith(expect.any(String));
  });

  it('una scheda riceve il ritiro fatto da un\'altra', () => {
    monta(
      { futureCommunications: dato },
      { comunicazioniRitirateIl: '2026-11-05T10:00:00.000Z' }
    );
    expect(pulsante('Ritira il consenso')).toBeUndefined();
  });

  it('un link scaduto chiede un link nuovo, non di riprovare', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 }))
    );
    monta({ futureCommunications: dato });

    await clic('Ritira il consenso');
    await clic('Ritira');

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      messages.gdpr.export.linkInvalid
    );
  });

  it("un errore lo dice e lascia il consenso com'era", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 }))
    );
    monta({ futureCommunications: dato });

    await clic('Ritira il consenso');
    await clic('Ritira');

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Ritirato il');
  });
});
