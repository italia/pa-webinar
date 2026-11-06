// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * La destinazione della registrazione e la guardia di pubblicazione su un
 * database vero: cio' che le rotte scrivono, cio' che si rifiuta e cio' che resta
 * com'era. Nessun finto, salvo i cookie della richiesta.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { POST as duplica } from '@/app/api/admin/events/[id]/duplicate/route';
import { PATCH as pubblica } from '@/app/api/admin/publications/[id]/route';
import { GET as leggi, PUT as aggiorna } from '@/app/api/events/[param]/route';
import { POST as creaChiamata } from '@/app/api/events/instant/route';
import { POST as crea } from '@/app/api/events/route';
import { prisma } from '@/lib/db';

import {
  creaEvento,
  creaSessione,
  entraCome,
  richiesta,
  svuotaDatabase,
} from './fixtures';

const YOUTUBE = 'https://www.youtube.com/watch?v=abc';
const FILE = 'https://storage.example.com/recordings/sala.mp4';
const NON_COPERTA = { code: 'RECORDING_DESTINATION_NOT_COVERED' };
const RISERVATO = {
  recordingEnabled: true,
  recordingDestination: 'REGISTRANTS',
  recordingAudience: 'REGISTRANTS',
} as const;

const CORPO = {
  title: { it: 'Evento di prova' },
  description: { it: 'Descrizione' },
  startsAt: '2030-03-01T09:00:00.000Z',
  endsAt: '2030-03-01T10:00:00.000Z',
  timezone: 'Europe/Rome',
  maxParticipants: 100,
  moderatorName: 'Moderatore 1',
};

function modifica(evento: { id: string; moderatorToken: string }, corpo: unknown) {
  return aggiorna(
    richiesta(`/api/events/${evento.id}`, 'PUT', corpo, evento.moderatorToken) as never,
    { params: Promise.resolve({ param: evento.id }) }
  );
}

function modificaPubblicazione(id: string, corpo: unknown) {
  return pubblica(richiesta(`/api/admin/publications/${id}`, 'PATCH', corpo) as never, {
    params: Promise.resolve({ id }),
  });
}

const riga = (id: string) => prisma.event.findUniqueOrThrow({ where: { id } });

/** Un indirizzo per richiesta: la creazione e' limitata per indirizzo. */
let ultimo = 0;
function creazione(corpo: unknown) {
  const base = richiesta('/api/events', 'POST', corpo);
  base.headers.set('x-forwarded-for', `10.30.0.${(ultimo += 1)}`);
  return crea(base as never, { params: Promise.resolve({}) });
}

beforeEach(async () => {
  await svuotaDatabase();
  await entraCome('ADMIN');
});

describe('alla creazione', () => {
  it('un null esplicito su un evento che registra non resta nullo', async () => {
    const r = await creazione({
      ...CORPO,
      recordingEnabled: true,
      recordingDestination: null,
    });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(await riga(id)).toMatchObject({
      recordingDestination: 'REGISTRANTS',
      recordingAudience: 'REGISTRANTS',
    });
  });

  it('senza registrazione la destinazione resta nulla', async () => {
    const r = await creazione({ ...CORPO, recordingEnabled: false });
    const { id } = (await r.json()) as { id: string };
    expect(await riga(id)).toMatchObject({
      recordingDestination: null,
      recordingAudience: 'PUBLIC',
    });
  });

  it('una chiamata rapida registra e resta senza destinazione', async () => {
    const r = await creaChiamata(
      richiesta('/api/events/instant', 'POST', {
        title: { it: 'Chiamata' },
        moderatorName: 'Moderatore 1',
      }) as never,
      { params: Promise.resolve({}) }
    );
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(await riga(id)).toMatchObject({
      recordingEnabled: true,
      recordingDestination: null,
      eventType: 'INSTANT',
    });
  });
});

describe('la copia', () => {
  it('di un evento che registra senza destinazione parte riservata', async () => {
    const originale = await creaEvento({ recordingEnabled: true, status: 'ENDED' });
    const r = await duplica(
      richiesta(`/api/admin/events/${originale.id}/duplicate`, 'POST') as never,
      { params: Promise.resolve({ id: originale.id }) }
    );
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(await riga(id)).toMatchObject({
      status: 'DRAFT',
      recordingDestination: 'REGISTRANTS',
      recordingAudience: 'REGISTRANTS',
    });
    expect(await riga(originale.id)).toMatchObject({
      recordingDestination: null,
      recordingAudience: 'PUBLIC',
    });
  });
});

describe('la modifica di un evento riservato', () => {
  it.each([
    ['il pubblico per tutti', { recordingAudience: 'PUBLIC' }],
    ['un video esterno', { youtubeUrl: YOUTUBE }],
    ['il recupero in diretta', { tempRecordingUrl: FILE }],
    ['togliere la destinazione', { recordingDestination: null }],
  ])('rifiuta %s e lascia la riga com’era', async (_n, corpo) => {
    const evento = await creaEvento({ ...RISERVATO, status: 'ENDED' });
    const r = await modifica(evento, corpo);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject(NON_COPERTA);
    expect(await riga(evento.id)).toMatchObject({ ...RISERVATO, youtubeUrl: null });
  });

  it.each([
    ['la libreria', { libraryListed: true }],
    ['la pagina', { postEventPublic: true }],
    ['la chiusura', { status: 'ENDED', postEventPublic: true, libraryListed: true }],
    ['il file', { recordingUrl: FILE, recordingPublished: true }],
  ])('accetta %s', async (_n, corpo) => {
    const evento = await creaEvento({ ...RISERVATO, status: 'LIVE' });
    expect((await modifica(evento, corpo)).status).toBe(200);
  });

  it('il video caricato si pubblica per gli iscritti', async () => {
    const evento = await creaEvento({ ...RISERVATO, status: 'ENDED' });
    expect((await modificaPubblicazione(evento.id, { recordingUrl: FILE })).status).toBe(
      200
    );
    expect(await riga(evento.id)).toMatchObject({
      ...RISERVATO,
      recordingUrl: FILE,
      recordingPublished: true,
    });
  });

  it('dalla pubblicazione il video esterno si ferma', async () => {
    const evento = await creaEvento({ ...RISERVATO, status: 'ENDED' });
    const r = await modificaPubblicazione(evento.id, { youtubeUrl: YOUTUBE });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject(NON_COPERTA);
    expect((await riga(evento.id)).youtubeUrl).toBeNull();
  });
});

describe('il cambio di destinazione', () => {
  it('prima della sala si allarga', async () => {
    const evento = await creaEvento({ ...RISERVATO, status: 'PUBLISHED' });
    expect((await modifica(evento, { recordingDestination: 'PUBLIC' })).status).toBe(200);
    expect(await riga(evento.id)).toMatchObject({
      recordingDestination: 'PUBLIC',
      recordingAudience: 'PUBLIC',
    });
  });

  it('con una sessione gia’ chiusa non si allarga, e si restringe', async () => {
    const evento = await creaEvento({ ...RISERVATO, status: 'PUBLISHED' });
    await creaSessione(evento.id, { endedAt: new Date() });
    const r = await modifica(evento, { recordingDestination: 'PUBLIC' });
    expect(r.status).toBe(409);
    expect(await riga(evento.id)).toMatchObject(RISERVATO);

    const pubblico = await creaEvento({
      recordingEnabled: true,
      recordingDestination: 'PUBLIC',
      recordingAudience: 'PUBLIC',
      status: 'PUBLISHED',
    });
    await creaSessione(pubblico.id, { endedAt: new Date() });
    expect(
      (await modifica(pubblico, { recordingDestination: 'REGISTRANTS' })).status
    ).toBe(200);
    expect(await riga(pubblico.id)).toMatchObject(RISERVATO);
  });

  it('a evento concluso, con il video esterno gia’ presente, si restringe', async () => {
    const evento = await creaEvento({
      recordingEnabled: true,
      recordingDestination: 'PUBLIC',
      recordingAudience: 'PUBLIC',
      recordingPublished: true,
      recordingUrl: FILE,
      youtubeUrl: YOUTUBE,
      status: 'ENDED',
    });
    expect((await modifica(evento, { recordingDestination: 'REGISTRANTS' })).status).toBe(
      200
    );
    expect(await riga(evento.id)).toMatchObject({
      ...RISERVATO,
      youtubeUrl: YOUTUBE,
      recordingPublished: true,
    });
  });
});

describe('un evento senza destinazione', () => {
  it('non si blocca, e la destinazione resta nulla', async () => {
    const evento = await creaEvento({
      recordingEnabled: true,
      recordingAudience: 'REGISTRANTS',
      status: 'ENDED',
    });
    const r = await modifica(evento, {
      recordingAudience: 'PUBLIC',
      recordingPublished: true,
      youtubeUrl: YOUTUBE,
    });
    expect(r.status).toBe(200);
    expect(await riga(evento.id)).toMatchObject({
      recordingDestination: null,
      recordingAudience: 'PUBLIC',
      recordingPublished: true,
      youtubeUrl: YOUTUBE,
    });
  });

  it('che comincia a registrare parte riservato', async () => {
    const evento = await creaEvento({ recordingEnabled: false, status: 'PUBLISHED' });
    expect((await modifica(evento, { recordingEnabled: true })).status).toBe(200);
    expect(await riga(evento.id)).toMatchObject(RISERVATO);
  });

  it('che comincia a registrare caricando un file parte riservato', async () => {
    const evento = await creaEvento({ recordingEnabled: false, status: 'ENDED' });
    expect((await modificaPubblicazione(evento.id, { recordingUrl: FILE })).status).toBe(
      200
    );
    expect(await riga(evento.id)).toMatchObject({
      ...RISERVATO,
      recordingUrl: FILE,
      recordingPublished: true,
    });

    const r = await modifica(evento, { recordingAudience: 'PUBLIC' });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject(NON_COPERTA);
  });

  it.each([
    ['una chiamata rapida', { eventType: 'INSTANT', recordingEnabled: false }],
    ['un evento storico', { eventType: 'LEGACY', recordingEnabled: false }],
    ['un evento che registrava gia’', { recordingEnabled: true }],
  ] as const)('%s con il file caricato resta senza destinazione', async (_n, campi) => {
    const evento = await creaEvento({ ...campi, status: 'ENDED' });
    expect((await modificaPubblicazione(evento.id, { recordingUrl: FILE })).status).toBe(
      200
    );
    expect(await riga(evento.id)).toMatchObject({
      recordingDestination: null,
      recordingAudience: 'PUBLIC',
      recordingEnabled: true,
      recordingUrl: FILE,
    });
  });
});

describe('la lettura pubblica', () => {
  const postEventShowQA = async (slug: string) => {
    const r = await leggi(richiesta(`/api/events/${slug}`) as never, {
      params: Promise.resolve({ param: slug }),
    });
    return ((await r.json()) as { postEventShowQA: boolean }).postEventShowQA;
  };

  it('dice se le domande si pubblicano davvero', async () => {
    const riservato = await creaEvento({
      ...RISERVATO,
      status: 'ENDED',
      qaEnabled: true,
      postEventShowQA: true,
    });
    const storico = await creaEvento({
      recordingEnabled: true,
      status: 'ENDED',
      qaEnabled: true,
      postEventShowQA: true,
    });
    expect(await postEventShowQA(riservato.slug)).toBe(false);
    expect(await postEventShowQA(storico.slug)).toBe(true);
    expect((await riga(riservato.id)).postEventShowQA).toBe(true);
  });
});
