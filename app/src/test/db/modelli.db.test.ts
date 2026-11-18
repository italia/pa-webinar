// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * I valori del formato su un database vero: dal modello salvato dall'editor
 * all'evento creato dal wizard, passando per le stesse funzioni che li portano
 * nel modulo e nel salvataggio. Poi la regola che dice a quali eventi si chiede la
 * destinazione, sulle righe che la decidono.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { POST as duplica } from '@/app/api/admin/events/[id]/duplicate/route';
import {
  POST as creaModello,
  PUT as aggiornaModello,
} from '@/app/api/admin/templates/route';
import { POST as creaEvento } from '@/app/api/events/route';
import {
  campiDaEvento,
  campiDaModello,
  campiDaSalvare,
} from '@/components/admin/event-wizard/campi-del-formato';
import type {
  WizardForm,
  WizardTemplatePreset,
} from '@/components/admin/event-wizard/wizard-shell';
import { prisma } from '@/lib/db';
import { domandaDestinazione } from '@/lib/events/destination-question';
import {
  decodificaFormato,
  formatoConAccesso,
  formatoPossibile,
  presetDaFormato,
} from '@/lib/events/guided-format';
import { domandePubbliche } from '@/lib/events/post-event-sections';
import { presetDelModello } from '@/lib/events/template-preset';

import {
  creaEvento as evento,
  creaIscrizione,
  creaSessione,
  entraCome,
  richiesta,
  svuotaDatabase,
} from './fixtures';

beforeEach(svuotaDatabase);

const senzaParametri = { params: Promise.resolve({}) };

/** Un corpo di creazione valido, come lo manda il wizard. */
const corpoEvento = (campi: Record<string, unknown>) => ({
  title: { it: 'Evento dal modello' },
  description: { it: 'Una descrizione abbastanza lunga.' },
  startsAt: '2031-03-10T10:00:00.000Z',
  endsAt: '2031-03-10T11:00:00.000Z',
  timezone: 'Europe/Rome',
  maxParticipants: 100,
  ...campi,
});

async function salvaModello(corpo: Record<string, unknown>) {
  const risposta = await creaModello(
    richiesta('/api/admin/templates', 'POST', corpo) as never,
    senzaParametri
  );
  expect(risposta.status).toBe(201);
  return (await risposta.json()) as { id: string };
}

let ultimoIndirizzo = 0;

/** Dal modello sul database all'evento sul database, come fa il wizard. */
async function eventoDalModello(id: string) {
  const riga = await prisma.eventTemplate.findUniqueOrThrow({ where: { id } });
  return eventoDalPreset(presetDelModello(riga));
}

/** Dai valori di partenza all'evento sul database: il seme del modulo e cio' che
 *  il salvataggio ne manda, sulla stessa rotta del wizard. */
async function eventoDalPreset(preset: WizardTemplatePreset, conVideo = true) {
  const registra = preset.recordingEnabled;
  const campi = campiDaModello(preset, registra, conVideo);
  const salvato = campiDaSalvare(
    { ...campi, recordingEnabled: registra } as WizardForm,
    null,
    false
  );
  const creazione = richiesta(
    '/api/events',
    'POST',
    corpoEvento({
      recordingEnabled: registra,
      accessMode: preset.accessMode,
      postEventPublic: preset.postEventPublic,
      ...salvato,
    })
  );
  // Un indirizzo per richiesta: la creazione e' limitata per indirizzo.
  creazione.headers.set('x-forwarded-for', `10.31.0.${(ultimoIndirizzo += 1)}`);
  const risposta = await creaEvento(creazione as never, senzaParametri);
  expect(risposta.status).toBe(201);
  const { id: idEvento } = (await risposta.json()) as { id: string };
  return prisma.event.findUniqueOrThrow({ where: { id: idEvento } });
}

describe('dal modello all evento', () => {
  it('ogni valore del modello arriva all evento', async () => {
    await entraCome('ADMIN');
    const { id } = await salvaModello({
      name: 'Webinar',
      recordingEnabled: true,
      recordingDestination: 'PUBLIC',
      offerAddressBook: false,
      audienceAnonymous: true,
      hostsAlwaysRecorded: true,
      postEventShowQA: false,
    });

    const creato = await eventoDalModello(id);

    expect(creato).toMatchObject({
      recordingEnabled: true,
      recordingDestination: 'PUBLIC',
      offerAddressBook: false,
      audienceAnonymous: true,
      hostsAlwaysRecorded: true,
      postEventShowQA: false,
    });
  });

  it('un modello salvato senza questi campi vale i default delle colonne', async () => {
    await entraCome('ADMIN');
    const { id } = await salvaModello({ name: 'Muto', recordingEnabled: true });
    const riga = await prisma.eventTemplate.findUniqueOrThrow({ where: { id } });
    expect(riga).toMatchObject({
      recordingDestination: null,
      offerAddressBook: true,
      audienceAnonymous: false,
      hostsAlwaysRecorded: false,
      postEventShowQA: true,
    });

    expect(await eventoDalModello(id)).toMatchObject({
      recordingDestination: 'REGISTRANTS',
      offerAddressBook: true,
      audienceAnonymous: false,
      hostsAlwaysRecorded: false,
      postEventShowQA: true,
    });
  });

  it('la durata della registrazione passa dal modello all evento; senza, nessuna', async () => {
    await entraCome('ADMIN');
    const { id } = await salvaModello({
      name: 'Archivio',
      recordingEnabled: true,
      recordingDeleteAfterDays: 365,
    });
    const { id: senza } = await salvaModello({ name: 'Storico', recordingEnabled: true });
    const crea = async (idModello: string) => {
      const riga = await prisma.eventTemplate.findUniqueOrThrow({ where: { id: idModello } });
      const creazione = richiesta(
        '/api/events',
        'POST',
        corpoEvento({
          recordingEnabled: true,
          // Come il wizard: il valore di partenza del modulo viene dal modello.
          recordingDeleteAfterDays: presetDelModello(riga).recordingDeleteAfterDays ?? null,
        })
      );
      creazione.headers.set('x-forwarded-for', `10.31.0.${(ultimoIndirizzo += 1)}`);
      const risposta = await creaEvento(creazione as never, senzaParametri);
      expect(risposta.status).toBe(201);
      const { id: idEvento } = (await risposta.json()) as { id: string };
      return prisma.event.findUniqueOrThrow({ where: { id: idEvento } });
    };

    expect((await crea(id)).recordingDeleteAfterDays).toBe(365);
    expect((await crea(senza)).recordingDeleteAfterDays).toBeNull();
  });

  it('un modello che non registra non accende chi conduce', async () => {
    await entraCome('ADMIN');
    const { id } = await salvaModello({
      name: 'Riunione',
      recordingEnabled: false,
      recordingDestination: 'REGISTRANTS',
      hostsAlwaysRecorded: true,
    });

    expect(await eventoDalModello(id)).toMatchObject({
      recordingEnabled: false,
      recordingDestination: null,
      hostsAlwaysRecorded: false,
    });
  });

  it('modificare il modello non tocca gli eventi gia creati', async () => {
    await entraCome('ADMIN');
    const { id } = await salvaModello({
      name: 'Webinar',
      recordingEnabled: true,
      recordingDestination: 'PUBLIC',
    });
    const creato = await eventoDalModello(id);

    const risposta = await aggiornaModello(
      richiesta('/api/admin/templates', 'PUT', {
        id,
        recordingDestination: null,
        audienceAnonymous: true,
      }) as never,
      senzaParametri
    );
    expect(risposta.status).toBe(200);

    expect(await prisma.eventTemplate.findUniqueOrThrow({ where: { id } })).toMatchObject(
      {
        recordingDestination: null,
        audienceAnonymous: true,
      }
    );
    expect(
      await prisma.event.findUniqueOrThrow({ where: { id: creato.id } })
    ).toMatchObject({
      recordingDestination: 'PUBLIC',
      audienceAnonymous: false,
    });
  });
});

describe('dal formato all evento', () => {
  /** Cio' che ogni formato lascia sulla riga dell'evento, dalla risposta scritta
   *  nell'indirizzo: la tabella dei formati. */
  const VIDEO_RISERVATO = {
    recordingEnabled: true,
    recordingDestination: 'REGISTRANTS',
    recordingAudience: 'REGISTRANTS',
  };
  const VIDEO_PUBBLICO = {
    recordingEnabled: true,
    recordingDestination: 'PUBLIC',
    recordingAudience: 'PUBLIC',
  };
  const RIUNIONE = {
    ...VIDEO_RISERVATO,
    audienceAnonymous: false,
    postEventShowQA: false,
    offerAddressBook: false,
    hostsAlwaysRecorded: false,
    postEventPublic: false,
  };
  const PARTECIPATIVO = {
    ...VIDEO_PUBBLICO,
    audienceAnonymous: false,
    postEventShowQA: true,
    offerAddressBook: true,
    hostsAlwaysRecorded: false,
    postEventPublic: true,
  };
  const PUBBLICO = {
    ...VIDEO_PUBBLICO,
    audienceAnonymous: true,
    postEventShowQA: true,
    offerAddressBook: true,
    hostsAlwaysRecorded: false,
    postEventPublic: true,
  };
  const INVITO = { ...PARTECIPATIVO, ...VIDEO_RISERVATO, postEventPublic: false };

  it.each([
    ['riunione', 'piccolo.tutti.riservata.tutti', RIUNIONE],
    ['partecipativo', 'medio.tutti.pubblica.tutti', PARTECIPATIVO],
    ['pubblico per numero', 'grande.tutti.pubblica.tutti', PUBBLICO],
    ['pubblico con soli relatori', 'piccolo.relatori.pubblica.tutti', PUBBLICO],
    ['su invito', 'medio.tutti.riservata.invitati', { ...INVITO, accessMode: 'INVITATION' }],
    ['vecchio indirizzo, riunione', 'piccolo.tutti.si.tutti', RIUNIONE],
    ['vecchio indirizzo, partecipativo', 'medio.tutti.si.tutti', PARTECIPATIVO],
    ['vecchio indirizzo, pubblico', 'medio.relatori.si.tutti', PUBBLICO],
    ['vecchio indirizzo, su invito', 'medio.tutti.si.invitati', { ...INVITO, accessMode: 'INVITATION' }],
  ])('%s', async (_nome, indirizzo, atteso) => {
    await entraCome('ADMIN');
    const formato = decodificaFormato(indirizzo);
    expect(formato).not.toBeNull();
    expect(await eventoDalPreset(presetDaFormato(formato!, 'Formato'))).toMatchObject(atteso);
  });

  it('senza registrazione nessuna destinazione, e le domande restano', async () => {
    await entraCome('ADMIN');
    const formato = decodificaFormato('medio.tutti.no.tutti');
    expect(await eventoDalPreset(presetDaFormato(formato!, 'Formato'))).toMatchObject({
      recordingEnabled: false,
      recordingDestination: null,
      recordingAudience: 'PUBLIC',
      postEventShowQA: true,
      offerAddressBook: true,
    });
  });

  it.each(['medio.tutti.pubblica.tutti', 'medio.tutti.riservata.tutti'])(
    'dove il video della sala non c e l evento e quello annunciato: %s',
    async (indirizzo) => {
      await entraCome('ADMIN');
      const preset = presetDaFormato(
        formatoPossibile(decodificaFormato(indirizzo)!, true, false),
        'Formato',
      );
      expect(preset.recordingDestination).toBe('REGISTRANTS');
      expect(
        domandePubbliche({ ...preset, recordingAudience: preset.recordingDestination ?? 'PUBLIC' }),
      ).toBe(false);
      const riga = await eventoDalPreset(preset, false);
      expect(riga).toMatchObject(VIDEO_RISERVATO);
      expect(domandePubbliche(riga)).toBe(false);
    },
  );

  it('un video pubblico passato agli inviti torna riservato', async () => {
    await entraCome('ADMIN');
    const formato = formatoConAccesso(decodificaFormato('medio.tutti.pubblica.tutti')!, 'invitati');
    expect(await eventoDalPreset(presetDaFormato(formato, 'Formato'))).toMatchObject({
      ...INVITO,
      accessMode: 'INVITATION',
    });
  });
});

describe('dall evento al wizard', () => {
  it('i valori della riga tornano nel modulo, e un salvataggio senza cambi non li rimanda', async () => {
    const riga = await evento({
      status: 'DRAFT',
      recordingEnabled: true,
      recordingDestination: 'REGISTRANTS',
      offerAddressBook: false,
      audienceAnonymous: true,
      hostsAlwaysRecorded: true,
      postEventShowQA: false,
    });

    const campi = campiDaEvento(riga);

    expect(campi).toEqual({
      recordingDestination: 'REGISTRANTS',
      offerAddressBook: false,
      audienceAnonymous: true,
      hostsAlwaysRecorded: true,
      postEventShowQA: false,
    });
    expect(campiDaSalvare(campi as WizardForm, campi, false)).toEqual({
      recordingDestination: undefined,
      offerAddressBook: undefined,
      audienceAnonymous: true,
      hostsAlwaysRecorded: true,
      postEventShowQA: undefined,
    });
  });

  it('un evento nato prima delle colonne legge i loro default', async () => {
    const riga = await evento({ status: 'PUBLISHED', recordingEnabled: true });
    expect(campiDaEvento(riga)).toMatchObject({
      recordingDestination: null,
      offerAddressBook: true,
      postEventShowQA: true,
    });
  });
});

describe('a chi si chiede la destinazione', () => {
  it('a un evento mai aperto e senza iscrizioni', async () => {
    const riga = await evento({ status: 'PUBLISHED' });
    expect(await domandaDestinazione(riga)).toEqual({
      salaGiaAperta: false,
      daChiedere: true,
    });
  });

  it('non a un evento con iscrizioni', async () => {
    const riga = await evento({ status: 'PUBLISHED' });
    await creaIscrizione(riga.id);
    expect(await domandaDestinazione(riga)).toEqual({
      salaGiaAperta: false,
      daChiedere: false,
    });
  });

  it('non a un evento la cui sala si e aperta, anche se ora e chiusa', async () => {
    const riga = await evento({ status: 'PUBLISHED' });
    await creaSessione(riga.id, { endedAt: new Date() });
    expect(await domandaDestinazione(riga)).toEqual({
      salaGiaAperta: true,
      daChiedere: false,
    });
  });

  it('non a un evento concluso', async () => {
    const riga = await evento({ status: 'ENDED' });
    expect(await domandaDestinazione(riga)).toEqual({
      salaGiaAperta: true,
      daChiedere: false,
    });
  });

  it('a una copia, anche di un evento con iscrizioni e sessioni', async () => {
    await entraCome('ADMIN');
    const origine = await evento({ status: 'ENDED', recordingEnabled: true });
    await creaIscrizione(origine.id);
    await creaSessione(origine.id);

    const risposta = await duplica(
      richiesta(`/api/admin/events/${origine.id}/duplicate`, 'POST', {}) as never,
      { params: Promise.resolve({ id: origine.id }) }
    );
    expect(risposta.status).toBe(201);
    const { id } = (await risposta.json()) as { id: string };

    const copia = await prisma.event.findUniqueOrThrow({ where: { id } });
    expect(copia.status).toBe('DRAFT');
    expect(await domandaDestinazione(copia)).toEqual({
      salaGiaAperta: false,
      daChiedere: true,
    });
  });

  it('la copia eredita la destinazione dichiarata', async () => {
    await entraCome('ADMIN');
    const origine = await evento({
      status: 'ENDED',
      recordingEnabled: true,
      recordingDestination: 'PUBLIC',
      offerAddressBook: false,
    });

    const risposta = await duplica(
      richiesta(`/api/admin/events/${origine.id}/duplicate`, 'POST', {}) as never,
      { params: Promise.resolve({ id: origine.id }) }
    );
    const { id } = (await risposta.json()) as { id: string };

    expect(await prisma.event.findUniqueOrThrow({ where: { id } })).toMatchObject({
      recordingDestination: 'PUBLIC',
      offerAddressBook: false,
    });
  });
});
