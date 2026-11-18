// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import type { VoceNelVideo } from '@/lib/live/consent-rule';

import RegistrationConsents, { type ConsensiVista, type OffertaVista } from './registration-consents';

let container: HTMLDivElement;
let root: Root;
const dato = { dato: true, ritiratoIl: null };

const monta = (
  consensi: Partial<ConsensiVista>,
  altri: {
    comunicazioniRitirateIl?: string;
    onComunicazioniRitirate?: (q: string) => void;
    voce?: VoceNelVideo;
    rubricaConfermata?: boolean;
    onRubricaConfermata?: () => void;
    offerta?: OffertaVista | null;
    locale?: string;
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

    it('confermata, lo dice a chi ospita le schede', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status: 200 }))
      );
      const avvisa = vi.fn();
      monta({ addressBookPending: true }, { onRubricaConfermata: avvisa });

      await clic(conferma);

      expect(avvisa).toHaveBeenCalledOnce();
    });

    it('una conferma non riuscita non arriva alle altre schede', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status: 500 }))
      );
      const avvisa = vi.fn();
      monta({ addressBookPending: true }, { onRubricaConfermata: avvisa });

      await clic(conferma);

      expect(avvisa).not.toHaveBeenCalled();
    });

    it('la conferma da un’altra scheda la chiude e mostra il consenso dato', () => {
      monta({ addressBookPending: true }, { rubricaConfermata: true });

      expect(pulsante(conferma)).toBeUndefined();
      expect(pulsante(annulla)).toBeUndefined();
      expect(container.textContent).toContain(messages.live.consents.given);
    });

    it('la conferma da un’altra scheda non ridà un consenso a chi non aspettava', () => {
      monta(
        {
          addressBookPending: false,
          futureCommunications: { dato: false, ritiratoIl: '2026-11-05T10:00:00.000Z' },
        },
        { rubricaConfermata: true }
      );

      expect(container.textContent).toContain('Ritirato il');
      expect(container.textContent).not.toContain(messages.live.consents.given);
    });

    it('un ritiro dopo la conferma vale anche sulla scheda chiusa dalla conferma', () => {
      monta(
        { addressBookPending: true },
        { rubricaConfermata: true, comunicazioniRitirateIl: '2026-11-05T10:00:00.000Z' }
      );

      expect(pulsante(conferma)).toBeUndefined();
      expect(container.textContent).toContain('Ritirato il');
      expect(container.textContent).not.toContain(messages.live.consents.given);
    });

    it('se la spunta non aspetta piu’ toglie i pulsanti e lo dice, senza errore generico', async () => {
      const richiesta = vi.fn(async () => new Response('{}', { status: 404 }));
      vi.stubGlobal('fetch', richiesta);
      const avvisa = vi.fn();
      monta({ addressBookPending: true }, { onRubricaConfermata: avvisa });

      await clic(conferma);

      expect(pulsante(conferma)).toBeUndefined();
      expect(pulsante(annulla)).toBeUndefined();
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        messages.gdpr.export.addressBookPendingGone
      );
      expect(container.textContent).not.toContain(messages.live.consents.given);
      expect(avvisa).not.toHaveBeenCalled();
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

  describe('un consenso dato di nuovo', () => {
    const ritirato = { dato: false, ritiratoIl: '2026-11-05T10:00:00.000Z' };
    const offerta: OffertaVista = {
      recording: { destination: 'REGISTRANTS', voice: 'rimovibile', eventText: 'Testo dell’ente.' },
      transcription: { text: 'multitrack', voice: 'rimovibile', needsRecording: true },
      futureCommunications: true,
    };
    const g = messages.gdpr.consent;
    const l = messages.live.consents;

    it('mostra il testo della casella e lo manda con il testo letto', async () => {
      const richiesta = vi.fn(async () => new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', richiesta);
      monta({ recording: ritirato }, { offerta, locale: 'it' });

      expect(container.textContent).toContain(`Testo dell’ente. ${g.recordingReserved}`);
      await clic(l.recording.give);

      expect(richiesta).toHaveBeenCalledWith(
        '/api/gdpr/consents',
        expect.objectContaining({
          body: JSON.stringify({
            token: 'tok en',
            registrationId: 'r1',
            consent: 'recording',
            give: true,
            locale: 'it',
            recordingDestination: 'REGISTRANTS',
          }),
        })
      );
      expect(container.textContent).toContain(messages.gdpr.export.consentGiveDone);
      expect(pulsante(l.withdraw)).toBeDefined();
    });

    it('senza offerta non si da: resta solo lo stato', () => {
      monta({ recording: ritirato }, { offerta: { ...offerta, recording: null } });
      expect(pulsante(l.recording.give)).toBeUndefined();
    });

    it('la trascrizione aspetta il consenso alla registrazione', () => {
      monta({ recording: ritirato, transcription: ritirato }, { offerta });
      expect(pulsante(l.transcription.give)?.disabled).toBe(true);
      expect(container.textContent).toContain(l.transcription.needsRecording);
    });

    it('un testo cambiato a pagina aperta lo dice', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ code: 'CONSENT_TEXT_CHANGED' }), { status: 409 })
        )
      );
      monta({ recording: ritirato }, { offerta });
      await clic(l.recording.give);
      expect(container.textContent).toContain(messages.gdpr.export.consentGiveTextChanged);
      expect(pulsante(l.withdraw)).toBeUndefined();
    });

    it("le comunicazioni ridate valgono anche dopo un ritiro fatto da un'altra scheda", async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
      const confermata = vi.fn();
      monta(
        { futureCommunications: ritirato },
        { offerta, comunicazioniRitirateIl: ritirato.ritiratoIl, onRubricaConfermata: confermata }
      );
      expect(container.textContent).toContain(messages.gdpr.export.consentFutureGiveEffect);
      await clic(messages.gdpr.export.consentFutureGive);
      expect(confermata).toHaveBeenCalled();
      expect(pulsante(l.withdraw)).toBeDefined();
    });

    it('con una spunta in attesa si conferma quella, non un secondo pulsante', () => {
      monta({ futureCommunications: ritirato, addressBookPending: true }, { offerta });
      expect(pulsante(messages.gdpr.export.consentFutureGive)).toBeUndefined();
      expect(pulsante(messages.gdpr.export.addressBookPendingConfirm)).toBeDefined();
    });
  });
});
