// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import inglese from '@/i18n/messages/en.json';
import messages from '@/i18n/messages/it.json';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('t=tok'),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...resto }: { href: string; children: ReactNode }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
  percorso: (p: string) => p,
}));

import MyDataPage from './page';

const m = messages.gdpr.export;
let container: HTMLDivElement;
let root: Root;

async function monta(corpo: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(corpo), { status: 200 }))
  );
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <MyDataPage />
      </NextIntlClientProvider>
    );
  });
}

const VUOTO = { data: [], profilePhoto: null, grants: [] };
const PROVA = {
  id: 'p1',
  eventId: 'e1',
  kind: 'recording',
  givenAt: '2026-09-01T08:00:00.000Z',
  withdrawnAt: null,
  event: { title: { it: 'Evento passato' }, startsAt: '2026-09-02T08:00:00.000Z' },
};
const RUBRICA = {
  name: 'Anna Bianchi',
  email: 'anna@example.com',
  organization: 'Comune',
  optedIn: true,
  optedOutAt: null,
  expiresAt: '2028-01-31T08:00:00.000Z',
  optOutToken: 'uscita.firma',
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

describe('I miei dati', () => {
  it('senza niente dice che non ci sono dati', async () => {
    await monta(VUOTO);
    expect(container.textContent).toContain(m.noData);
  });

  it('una risposta di prima, senza i campi nuovi, non rompe la pagina', async () => {
    await monta({ data: [] });
    expect(container.textContent).toContain(m.noData);
  });

  it('chi ha solo prove conservate le vede e puo’ ritirarle', async () => {
    await monta({
      ...VUOTO,
      retainedConsentProofs: [PROVA],
      consentsToken: 'tok-consensi',
    });
    expect(container.textContent).not.toContain(m.noData);
    expect(container.textContent).toContain(m.proofsTitle);
    expect(container.textContent).toContain('Evento passato');
    expect(
      [...container.querySelectorAll('button')].some(
        (b) => b.textContent?.trim() === messages.live.consents.withdraw
      )
    ).toBe(true);
  });

  it('il testo sui consensi di sala promette solo il ritiro che la sala puo fare', () => {
    // La finestra raggiunge i posti dell'ingresso in corso, e quelli di prima solo
    // con l'account dello staff: una concessione nominale non li ritrova.
    expect(m.roomProofsIntro).toContain('ingresso in corso');
    expect(m.roomProofsIntro).toContain('account dello staff');
    expect(inglese.gdpr.export.roomProofsIntro).toContain('current entry');
    expect(inglese.gdpr.export.roomProofsIntro).toContain('staff account');
  });

  it('chi ha condotto vede i consensi dati in sala, anche senza altri dati', async () => {
    await monta({
      ...VUOTO,
      roomConsentProofs: [
        {
          kind: 'transcription',
          givenAt: '2026-09-01T08:00:00.000Z',
          withdrawnAt: '2026-09-03T08:00:00.000Z',
          superseded: false,
          event: { title: { it: 'Riunione' }, startsAt: '2026-09-02T08:00:00.000Z' },
        },
      ],
    });
    const testo = container.textContent ?? '';
    expect(testo).toContain(m.roomProofsTitle);
    expect(testo).toContain(m.roomProofsIntro);
    expect(testo).toContain('Riunione');
    expect(testo).toContain(messages.live.consents.transcription.title);
    expect(testo).toContain('Dato il 1 settembre 2026');
    expect(testo).toContain('Ritirato il 3 settembre 2026');
    expect(testo).not.toContain(m.noData);
  });

  it('chi e’ solo in rubrica vede i suoi dati, la scadenza e il link per uscirne', async () => {
    await monta({ ...VUOTO, addressBook: RUBRICA, retainedConsentProofs: [] });
    expect(container.textContent).not.toContain(m.noData);
    expect(container.textContent).toContain(m.addressBookTitle);
    expect(container.textContent).toContain('anna@example.com');
    expect(container.textContent).toContain('Comune');
    expect(container.textContent).toContain('31 gennaio 2028');
    const link = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === m.addressBookOptOut
    );
    expect(link?.getAttribute('href')).toBe('/rubrica/opt-out?token=uscita.firma');
  });

  it('una voce di chi ne e’ uscito dice quando, senza scadenza e senza link', async () => {
    await monta({
      ...VUOTO,
      addressBook: {
        ...RUBRICA,
        optedIn: false,
        optedOutAt: '2026-03-01T08:00:00.000Z',
        expiresAt: null,
        optOutToken: null,
      },
    });
    expect(container.textContent).toContain('Ritirato il 1 marzo 2026');
    expect(container.textContent).not.toContain('Conserviamo');
    expect(container.textContent).not.toContain(m.addressBookOptOut);
  });

  it('la conferma su una scheda chiude la spunta in attesa sulle altre', async () => {
    const iscrizione = (id: string, titolo: string) => ({
      event: { title: { it: titolo }, startsAt: '2026-12-01T08:00:00.000Z' },
      registration: {
        id,
        displayName: 'Anna Bianchi',
        email: 'anna@example.com',
        organization: null,
        registeredAt: '2026-11-01T08:00:00.000Z',
        consentGiven: true,
        consentTimestamp: '2026-11-01T08:00:00.000Z',
        consents: {
          recording: null,
          transcription: null,
          futureCommunications: null,
          addressBookPending: true,
        },
      },
      questions: [],
      pollVotes: [],
    });
    await monta({
      ...VUOTO,
      consentsToken: 'consensi',
      data: [iscrizione('r1', 'Primo'), iscrizione('r2', 'Secondo')],
    });
    const pulsanti = (nome: string) =>
      [...container.querySelectorAll('button')].filter((b) => b.textContent?.trim() === nome);
    expect(pulsanti(m.addressBookPendingConfirm)).toHaveLength(2);

    await act(async () => {
      pulsanti(m.addressBookPendingConfirm)[0]?.click();
    });

    expect(pulsanti(m.addressBookPendingConfirm)).toHaveLength(0);
    expect(pulsanti(m.addressBookPendingCancel)).toHaveLength(0);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    const dati = container.textContent?.split(messages.live.consents.given).length ?? 0;
    expect(dati - 1).toBe(2);
  });

  it('una voce senza nome ed email li lascia vuoti, senza rompere', async () => {
    await monta({
      ...VUOTO,
      addressBook: {
        ...RUBRICA,
        name: null,
        email: null,
        organization: null,
        expiresAt: null,
      },
    });
    expect(container.textContent).toContain(m.addressBookTitle);
    expect(container.textContent).toContain('—');
  });

  describe('correggere e cancellare un’iscrizione', () => {
    const iscrizione = (id: string, titolo: string) => ({
      event: { title: { it: titolo }, startsAt: '2026-12-01T08:00:00.000Z' },
      registration: {
        id,
        displayName: 'Ana Bianchi',
        email: 'anna@example.com',
        organization: 'Comune',
        registeredAt: '2026-11-01T08:00:00.000Z',
        consentGiven: true,
        consentTimestamp: '2026-11-01T08:00:00.000Z',
        consents: { recording: null, transcription: null, futureCommunications: null },
      },
      questions: [],
      pollVotes: [],
    });
    const DUE = {
      ...VUOTO,
      consentsToken: 'consensi',
      data: [iscrizione('r1', 'Primo'), iscrizione('r2', 'Secondo')],
    };
    const pulsanti = (nome: string) =>
      [...container.querySelectorAll('button')].filter((b) => b.textContent?.trim() === nome);
    const scriviCodice = (valore: string) =>
      act(() => {
        const el = container.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, valore);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const clic = async (el: HTMLElement | undefined) => {
      await act(async () => {
        el?.click();
      });
    };
    /** La pagina e' gia' caricata: le chiamate successive rispondono in ordine. */
    const risposte = (...elenco: Array<[number, Record<string, unknown>]>) => {
      const coda = [...elenco];
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          const [status, corpo] = coda.shift()!;
          return new Response(JSON.stringify(corpo), { status });
        })
      );
    };

    it('la correzione di tutte le iscrizioni si vede su ogni scheda', async () => {
      await monta(DUE);
      risposte(
        [202, { issuedAt: 1 }],
        [200, { displayName: 'Anna Bianchi', organization: null }]
      );
      await clic(pulsanti(m.editButton)[0]);
      const tutte = [...container.querySelectorAll('label')].find((l) =>
        l.textContent?.startsWith('Tutte le mie iscrizioni (2)')
      )!;
      act(() => (document.getElementById(tutte.htmlFor) as HTMLInputElement).click());
      await clic(pulsanti(m.codeSend)[0]);
      scriviCodice('123456');
      await clic(pulsanti(m.codeConfirmEdit)[0]);
      const testo = container.textContent ?? '';
      expect(testo.split('Anna Bianchi').length - 1).toBe(2);
      expect(testo).not.toContain('Ana Bianchi');
      expect(testo).toContain(m.editDone);
    });

    it('una scheda cancellata lo dice, senza piu’ dati ne’ pulsanti', async () => {
      await monta(DUE);
      risposte([202, { issuedAt: 1 }], [200, { deleted: 1, consentProofsKept: 1 }]);
      await clic(pulsanti(m.cancelButton)[0]);
      await clic(pulsanti(m.codeSend)[0]);
      scriviCodice('123456');
      await clic(pulsanti(m.codeConfirmCancel)[0]);
      expect(container.textContent).toContain(m.cancelDone);
      expect(container.textContent).toContain('È rimasta 1 prova di consenso');
      expect(pulsanti(m.cancelButton)).toHaveLength(1);
      expect(pulsanti(m.editButton)).toHaveLength(1);
    });
  });
});
