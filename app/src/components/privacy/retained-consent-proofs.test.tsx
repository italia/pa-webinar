// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import RetainedConsentProofs, {
  type ProvaConservataVista,
} from './retained-consent-proofs';

let container: HTMLDivElement;
let root: Root;

const prova = (
  id: string,
  kind: ProvaConservataVista['kind'],
  altri: Partial<ProvaConservataVista> = {}
): ProvaConservataVista => ({
  id,
  eventId: 'e1',
  kind,
  role: 'registrant',
  name: null,
  superseded: false,
  givenAt: '2026-09-01T08:00:00.000Z',
  withdrawnAt: null,
  event: { title: { it: 'Evento passato' }, startsAt: '2026-09-02T08:00:00.000Z' },
  ...altri,
});

const monta = (prove: ProvaConservataVista[]) =>
  act(() =>
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RetainedConsentProofs token="tok" prove={prove} />
      </NextIntlClientProvider>
    )
  );
const pulsanti = (nome: string) =>
  [...container.querySelectorAll('button')].filter((b) => b.textContent?.trim() === nome);
const elenco = () => container.querySelector('ul')?.textContent;
const clic = async (nome: string) => {
  await act(async () => {
    pulsanti(nome)[0]?.click();
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

describe('RetainedConsentProofs', () => {
  it('dice di quale evento e di quale consenso, e da quando', () => {
    monta([prova('p1', 'recording')]);
    expect(container.textContent).toContain('Prove dei consensi conservate');
    expect(container.textContent).toContain('Evento passato');
    expect(container.textContent).toContain("Registrazione dell'evento");
    expect(container.textContent).toContain('Dato il 1 settembre 2026');
  });

  it('mostra il nome conservato, se c’e’', () => {
    monta([
      prova('p1', 'recording', { name: 'Anna Bianchi' }),
      prova('p2', 'transcription'),
    ]);
    const voci = container.querySelectorAll('li');
    expect(voci[0]?.textContent).toContain('Nome: Anna Bianchi');
    expect(voci[1]?.textContent).not.toContain('Nome');
  });

  it('il ritiro chiede una conferma, poi manda la prova', async () => {
    const richiesta = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', richiesta);
    monta([prova('p1', 'transcription')]);

    await clic('Ritira il consenso');
    expect(richiesta).not.toHaveBeenCalled();
    await clic('Ritira');

    expect(richiesta).toHaveBeenCalledWith(
      '/api/gdpr/consents',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'tok', proofId: 'p1', consent: 'transcription' }),
      })
    );
    expect(container.textContent).toContain('Ritirato il');
    expect(pulsanti('Ritira il consenso')).toHaveLength(0);
  });

  it('la conferma dice cosa cambia prima del ritiro', async () => {
    monta([prova('p1', 'recording'), prova('p2', 'transcription', { eventId: 'e2' })]);

    await clic('Ritira il consenso');
    const gruppo = () => container.querySelector('[role="group"]')?.textContent;
    expect(gruppo()).toContain(messages.gdpr.export.proofWithdrawEffect.recording);
    expect(gruppo()).not.toContain(messages.gdpr.export.proofWithdrawHost);
    await clic('Annulla');

    await act(async () => pulsanti('Ritira il consenso')[1]?.click());
    expect(gruppo()).toContain(messages.gdpr.export.proofWithdrawEffect.transcription);
  });

  it('a chi conduce dice che le trascrizioni piu’ vecchie non lo riconoscono', async () => {
    monta([prova('p1', 'transcription', { role: 'host' })]);
    await clic('Ritira il consenso');
    expect(container.querySelector('[role="group"]')?.textContent).toContain(
      messages.gdpr.export.proofWithdrawHost
    );
  });

  it('l’esito annuncia entrambi i consensi quando la registrazione porta via la trascrizione', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
    monta([prova('p1', 'recording'), prova('p2', 'transcription')]);

    await clic('Ritira il consenso');
    await clic('Ritira');

    const esito = container.querySelector('[role="status"]')?.textContent;
    expect(esito).toContain("Registrazione dell'evento");
    expect(esito).toContain('Trascrizione dei tuoi interventi');
  });

  it('l’esito nomina solo il consenso ritirato se la trascrizione non c’era', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
    monta([prova('p1', 'recording'), prova('p2', 'transcription', { eventId: 'e2' })]);

    await clic('Ritira il consenso');
    await clic('Ritira');

    expect(container.querySelector('[role="status"]')?.textContent).not.toContain(
      'Trascrizione dei tuoi interventi'
    );
  });

  it('si puo’ tornare indietro dalla conferma', async () => {
    monta([prova('p1', 'recording')]);
    await clic('Ritira il consenso');
    await clic('Annulla');
    expect(pulsanti('Ritira il consenso')).toHaveLength(1);
  });

  it('ritirare la registrazione ritira la trascrizione dello stesso evento, non degli altri', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
    monta([
      prova('p1', 'recording'),
      prova('p2', 'transcription'),
      prova('p3', 'transcription', { eventId: 'e2' }),
    ]);

    await clic('Ritira il consenso');
    await clic('Ritira');

    expect(elenco()?.match(/Ritirato il/g)).toHaveLength(2);
    expect(pulsanti('Ritira il consenso')).toHaveLength(1);
  });

  it('ritirare la trascrizione non tocca la registrazione', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
    monta([prova('p2', 'transcription'), prova('p1', 'recording')]);

    await clic('Ritira il consenso');
    await clic('Ritira');

    expect(elenco()?.match(/Ritirato il/g)).toHaveLength(1);
    expect(pulsanti('Ritira il consenso')).toHaveLength(1);
  });

  it('una prova gia’ ritirata non ha il pulsante', () => {
    monta([prova('p1', 'recording', { withdrawnAt: '2026-10-01T08:00:00.000Z' })]);
    expect(pulsanti('Ritira il consenso')).toHaveLength(0);
    expect(container.textContent).toContain('Ritirato il 1 ottobre 2026');
  });

  it('un periodo sostituito si dice, e non si ritira: si ritira il consenso che l’ha sostituito', () => {
    monta([prova('p1', 'recording', { superseded: true }), prova('p2', 'recording')]);
    expect(
      container.textContent?.match(/Sostituito da un consenso successivo/g)
    ).toHaveLength(1);
    expect(pulsanti('Ritira il consenso')).toHaveLength(1);
  });

  it('dopo il ritiro il periodo sostituito resta riconoscibile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
    monta([prova('p1', 'recording', { superseded: true }), prova('p2', 'recording')]);

    await clic('Ritira il consenso');
    await clic('Ritira');

    expect(container.textContent).toContain('Sostituito da un consenso successivo');
    expect(pulsanti('Ritira il consenso')).toHaveLength(0);
  });

  it.each([
    [401, messages.gdpr.export.linkInvalid],
    [429, messages.gdpr.export.rateLimited],
    [500, messages.live.consents.error],
  ])('la risposta %i lo dice e lascia il consenso com’era', async (status, testo) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status }))
    );
    monta([prova('p1', 'recording')]);

    await clic('Ritira il consenso');
    await clic('Ritira');

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(testo);
    expect(container.textContent).not.toContain('Ritirato il');
  });

  it('la conferma prende il fuoco, e «Annulla» lo riporta alla riga', async () => {
    monta([prova('p1', 'recording')]);

    await clic('Ritira il consenso');
    expect(document.activeElement).toBe(container.querySelector('[role="group"]'));

    await clic('Annulla');
    expect(document.activeElement?.textContent).toBe('Evento passato');
  });

  it('dopo il ritiro il fuoco resta sulla riga e l’esito si annuncia', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
    monta([prova('p1', 'recording')]);
    const annuncio = container.querySelector('[role="status"]');
    expect(annuncio?.textContent).toBe('');

    await clic('Ritira il consenso');
    await clic('Ritira');

    expect(document.activeElement?.textContent).toBe('Evento passato');
    // La zona c'era gia': e' il cambio del testo che si annuncia.
    expect(container.querySelector('[role="status"]')).toBe(annuncio);
    expect(annuncio?.textContent).toContain("Registrazione dell'evento");
    expect(annuncio?.textContent).toContain('Ritirato il');
  });

  it('l’esito dice l’evento, e due ritiri dello stesso consenso si annunciano entrambi', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
    monta([
      prova('p1', 'recording'),
      prova('p2', 'recording', {
        eventId: 'e2',
        event: { title: { it: 'Altro evento' }, startsAt: '2026-09-03T08:00:00.000Z' },
      }),
    ]);
    const annuncio = container.querySelector('[role="status"]');

    await clic('Ritira il consenso');
    await clic('Ritira');
    const primo = annuncio?.textContent;
    expect(primo).toContain('Evento passato');

    await clic('Ritira il consenso');
    await clic('Ritira');
    expect(annuncio?.textContent).toContain('Altro evento');
    expect(annuncio?.textContent).not.toBe(primo);
  });

  it('un esito uguale al precedente si annuncia lo stesso: la zona si vuota mentre si ritira', async () => {
    let risposta: (r: Response) => void = () => undefined;
    const richiesta = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((r) => (risposta = r)));
    vi.stubGlobal('fetch', richiesta);
    // Due eventi di una serie: stesso titolo, stesso consenso, stesso giorno.
    monta([prova('p1', 'recording'), prova('p2', 'recording', { eventId: 'e2' })]);
    const annuncio = container.querySelector('[role="status"]');

    await clic('Ritira il consenso');
    await clic('Ritira');
    const primo = annuncio?.textContent;
    expect(primo).toContain('Ritirato il');

    await clic('Ritira il consenso');
    await clic('Ritira');
    expect(annuncio?.textContent).toBe('');

    await act(async () => risposta(new Response('{}', { status: 200 })));
    expect(annuncio?.textContent).toBe(primo);
  });

  it('dopo un errore il fuoco resta nella conferma', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 }))
    );
    monta([prova('p1', 'recording')]);

    await clic('Ritira il consenso');
    await clic('Ritira');

    expect(document.activeElement).toBe(container.querySelector('[role="group"]'));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('una rete che cade lo dice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('rete');
      })
    );
    monta([prova('p1', 'recording')]);

    await clic('Ritira il consenso');
    await clic('Ritira');

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      messages.live.consents.error
    );
  });
});
