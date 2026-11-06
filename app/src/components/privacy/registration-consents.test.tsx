// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import type { VoceNelVideo } from '@/lib/live/consent-rule';

import RegistrationConsents, { type ConsensiVista } from './registration-consents';

let container: HTMLDivElement;
let root: Root;
const dato = { dato: true, ritiratoIl: null };

const monta = (
  consensi: Partial<ConsensiVista>,
  altri: {
    comunicazioniRitirateIl?: string;
    onComunicazioniRitirate?: (q: string) => void;
    voce?: VoceNelVideo;
  } = {}
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

  describe('la conferma del ritiro della registrazione', () => {
    const { withdraw, withdrawTranscript } = messages.live.consents.recording;
    const ritiroAvviato = async (
      consensi: Partial<ConsensiVista>,
      voce: VoceNelVideo
    ) => {
      monta(consensi, { voce });
      await clic('Ritira il consenso');
      return container.querySelector('[role="group"]')?.textContent;
    };

    it.each([
      ['rimovibile', withdraw.voce],
      ['fissa', withdraw.soloAscolto],
    ] as const)('voce %s: annuncia anche la trascrizione data', async (voce, testo) => {
      const conferma = await ritiroAvviato({ recording: dato, transcription: dato }, voce);
      expect(conferma).toContain(`${testo} ${withdrawTranscript}`);
    });

    it('senza video annuncia comunque la trascrizione data', async () => {
      const conferma = await ritiroAvviato({ recording: dato, transcription: dato }, 'assente');
      expect(conferma).toContain(withdrawTranscript);
    });

    it('senza una trascrizione data non la nomina', async () => {
      const conferma = await ritiroAvviato({ recording: dato, transcription: null }, 'rimovibile');
      expect(conferma).toContain(withdraw.voce);
      expect(conferma).not.toContain(withdrawTranscript);
    });

    it('una trascrizione gia ritirata non la nomina', async () => {
      const conferma = await ritiroAvviato(
        { recording: dato, transcription: { dato: false, ritiratoIl: '2026-11-05T10:00:00.000Z' } },
        'rimovibile'
      );
      expect(conferma).not.toContain(withdrawTranscript);
    });
  });

  it('prima di ritirare dice cosa cambia', async () => {
    monta({ transcription: dato });
    await clic('Ritira il consenso');
    expect(container.textContent).toContain(
      'le tue frasi già trascritte dai sottotitoli perdono testo e nome'
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

  describe('la spunta della rubrica in attesa', () => {
    const { addressBookPendingConfirm: conferma, addressBookPendingCancel: annulla } =
      messages.gdpr.export;

    it('compare da sola, con cosa cambia, anche senza altri consensi', () => {
      monta({ addressBookPending: true });
      expect(container.textContent).toContain(messages.gdpr.export.addressBookPendingEffect);
      expect(pulsante(conferma)).toBeDefined();
      expect(pulsante(annulla)).toBeDefined();
    });

    it('si annulla come un ritiro delle comunicazioni, su tutte le schede', async () => {
      const richiesta = vi.fn(async () => new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', richiesta);
      const avvisa = vi.fn();
      monta({ addressBookPending: true }, { onComunicazioniRitirate: avvisa });

      await clic(annulla);

      expect(richiesta).toHaveBeenCalledWith(
        '/api/gdpr/consents',
        expect.objectContaining({
          body: JSON.stringify({
            token: 'tok en',
            registrationId: 'r1',
            consent: 'futureCommunications',
          }),
        })
      );
      expect(avvisa).toHaveBeenCalledWith(expect.any(String));
      expect(pulsante(conferma)).toBeUndefined();
      expect(container.textContent).toContain('Ritirato il');
    });

    it('si conferma con un pulsante, e diventa un consenso dato', async () => {
      const richiesta = vi.fn(async () => new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', richiesta);
      monta({ addressBookPending: true });

      await clic(conferma);

      expect(richiesta).toHaveBeenCalledWith(
        '/api/gdpr/consents',
        expect.objectContaining({
          body: JSON.stringify({
            token: 'tok en',
            registrationId: 'r1',
            confirmAddressBook: true,
          }),
        })
      );
      expect(pulsante(conferma)).toBeUndefined();
      expect(container.textContent).toContain(messages.live.consents.given);
    });

    it('se la conferma non riesce resta in attesa, e lo dice', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status: 500 }))
      );
      monta({ addressBookPending: true });

      await clic(conferma);

      expect(pulsante(conferma)).toBeDefined();
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    });

    it('sparisce quando un’altra scheda ritira le comunicazioni', () => {
      monta(
        { addressBookPending: true },
        { comunicazioniRitirateIl: '2026-11-05T10:00:00.000Z' }
      );
      expect(pulsante(conferma)).toBeUndefined();
    });
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
