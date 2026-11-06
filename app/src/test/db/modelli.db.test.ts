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
import type { WizardForm } from '@/components/admin/event-wizard/wizard-shell';
import { prisma } from '@/lib/db';
import { domandaDestinazione } from '@/lib/events/destination-question';
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

/** Dal modello sul database all'evento sul database, come fa il wizard. */
async function eventoDalModello(id: string) {
  const riga = await prisma.eventTemplate.findUniqueOrThrow({ where: { id } });
  const preset = presetDelModello(riga);
  const registra = preset.recordingEnabled;
  const campi = campiDaModello(preset, registra);
  const salvato = campiDaSalvare(
    { ...campi, recordingEnabled: registra } as WizardForm,
    null,
    false
  );
  const risposta = await creaEvento(
    richiesta(
      '/api/events',
      'POST',
      corpoEvento({ recordingEnabled: registra, ...salvato })
    ) as never,
    senzaParametri
  );
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
