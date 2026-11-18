// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Il catalogo degli eventi su un database vero: cio' che la creazione scrive,
 * cio' che resta quando il modello cambia nome o si cancella (la chiave esterna
 * SetNull), la copia, la correzione dello staff e le statistiche che ne escono.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { POST as duplica } from '@/app/api/admin/events/[id]/duplicate/route';
import {
  DELETE as cancellaModello,
  POST as creaModello,
  PUT as aggiornaModello,
} from '@/app/api/admin/templates/route';
import { PUT as aggiornaEvento } from '@/app/api/events/[param]/route';
import { POST as creaEvento } from '@/app/api/events/route';
import { statisticheCatalogo } from '@/lib/analytics/catalog-stats-query';
import { prisma } from '@/lib/db';

import {
  creaEvento as evento,
  creaSessione,
  entraCome,
  esci,
  richiesta,
  svuotaDatabase,
} from './fixtures';

beforeEach(svuotaDatabase);

const senzaParametri = { params: Promise.resolve({}) };

let ultimoIndirizzo = 0;

/** Un evento creato dalla rotta del wizard, con i campi dati. */
async function creaDalWizard(campi: Record<string, unknown>) {
  const creazione = richiesta('/api/events', 'POST', {
    title: { it: 'Evento del catalogo' },
    description: { it: 'Una descrizione abbastanza lunga.' },
    startsAt: '2031-03-10T10:00:00.000Z',
    endsAt: '2031-03-10T11:00:00.000Z',
    timezone: 'Europe/Rome',
    maxParticipants: 100,
    ...campi,
  });
  // Un indirizzo per richiesta: la creazione e' limitata per indirizzo.
  creazione.headers.set('x-forwarded-for', `10.32.0.${(ultimoIndirizzo += 1)}`);
  return creaEvento(creazione as never, senzaParametri);
}

async function salvaModello(corpo: Record<string, unknown>) {
  const risposta = await creaModello(
    richiesta('/api/admin/templates', 'POST', corpo) as never,
    senzaParametri
  );
  expect(risposta.status).toBe(201);
  return (await risposta.json()) as { id: string };
}

function salva(id: string, corpo: Record<string, unknown>, token?: string) {
  return aggiornaEvento(richiesta(`/api/events/${id}`, 'PUT', corpo, token) as never, {
    params: Promise.resolve({ param: id }),
  });
}

describe('il catalogo alla creazione', () => {
  it('dalle domande del formato: la famiglia, senza modello', async () => {
    await entraCome('ADMIN');
    const risposta = await creaDalWizard({ formatClass: 'PARTICIPATORY' });
    expect(risposta.status).toBe(201);
    const { id } = (await risposta.json()) as { id: string };
    expect(await prisma.event.findUniqueOrThrow({ where: { id } })).toMatchObject({
      formatClass: 'PARTICIPATORY',
      templateId: null,
      templateName: null,
    });
  });

  it('da un modello: il riferimento, il nome di allora e la sua famiglia', async () => {
    await entraCome('ADMIN');
    const modello = await salvaModello({
      name: 'Riunione del lunedì',
      maxParticipants: 12,
      participantsCanUnmute: true,
      participantsCanStartVideo: true,
    });
    const risposta = await creaDalWizard({ templateId: modello.id, maxParticipants: 12 });
    expect(risposta.status).toBe(201);
    const { id } = (await risposta.json()) as { id: string };
    expect(await prisma.event.findUniqueOrThrow({ where: { id } })).toMatchObject({
      templateId: modello.id,
      templateName: 'Riunione del lunedì',
      formatClass: 'MEETING',
    });
  });

  it('un modello che non esiste e un errore sul campo, non un 500', async () => {
    await entraCome('ADMIN');
    const risposta = await creaDalWizard({
      templateId: '44444444-4444-4444-8444-444444444444',
    });
    expect(risposta.status).toBe(422);
    expect(await prisma.event.count()).toBe(0);
  });

  it('senza modello e senza formato l evento non e catalogato', async () => {
    await entraCome('ADMIN');
    const { id } = (await (await creaDalWizard({})).json()) as { id: string };
    expect(await prisma.event.findUniqueOrThrow({ where: { id } })).toMatchObject({
      templateId: null,
      templateName: null,
      formatClass: null,
    });
  });
});

describe('il modello dopo la creazione', () => {
  it('cambiare nome al modello non cambia il nome di allora; cancellarlo toglie solo il riferimento', async () => {
    await entraCome('ADMIN');
    const modello = await salvaModello({ name: 'Webinar', maxParticipants: 300 });
    const { id } = (await (await creaDalWizard({ templateId: modello.id })).json()) as {
      id: string;
    };

    const rinomina = await aggiornaModello(
      richiesta('/api/admin/templates', 'PUT', {
        id: modello.id,
        name: 'Webinar 2',
      }) as never,
      senzaParametri
    );
    expect(rinomina.status).toBe(200);
    expect(await prisma.event.findUniqueOrThrow({ where: { id } })).toMatchObject({
      templateId: modello.id,
      templateName: 'Webinar',
    });

    const cancella = await cancellaModello(
      richiesta(`/api/admin/templates?id=${modello.id}`, 'DELETE') as never,
      senzaParametri
    );
    expect(cancella.status).toBe(200);
    expect(await prisma.event.findUniqueOrThrow({ where: { id } })).toMatchObject({
      templateId: null,
      templateName: 'Webinar',
      formatClass: 'PUBLIC',
    });
  });

  it('la copia di un evento e dello stesso tipo, dallo stesso modello', async () => {
    await entraCome('ADMIN');
    const modello = await salvaModello({ name: 'Corso' });
    const origine = await evento({
      status: 'ENDED',
      templateId: modello.id,
      templateName: 'Corso (nome di allora)',
      formatClass: 'PARTICIPATORY',
    });

    const risposta = await duplica(
      richiesta(`/api/admin/events/${origine.id}/duplicate`, 'POST', {}) as never,
      { params: Promise.resolve({ id: origine.id }) }
    );
    expect(risposta.status).toBe(201);
    const { id } = (await risposta.json()) as { id: string };
    expect(await prisma.event.findUniqueOrThrow({ where: { id } })).toMatchObject({
      templateId: modello.id,
      templateName: 'Corso (nome di allora)',
      formatClass: 'PARTICIPATORY',
    });
  });
});

describe('la correzione del catalogo', () => {
  it('lo staff dell evento la corregge, anche a evento concluso', async () => {
    await entraCome('ADMIN');
    const modello = await salvaModello({ name: 'Conferenza' });
    const e = await evento({ status: 'ENDED' });

    const r = await salva(
      e.id,
      { formatClass: 'PUBLIC', templateId: modello.id },
      e.moderatorToken
    );
    expect(r.status).toBe(200);
    expect(await prisma.event.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({
      formatClass: 'PUBLIC',
      templateId: modello.id,
      templateName: 'Conferenza',
    });

    // Togliere il modello toglie anche il nome; la famiglia resta.
    const via = await salva(e.id, { templateId: null }, e.moderatorToken);
    expect(via.status).toBe(200);
    expect(await prisma.event.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({
      formatClass: 'PUBLIC',
      templateId: null,
      templateName: null,
    });
  });

  it('«nessun modello» toglie anche il nome di un modello cancellato', async () => {
    await entraCome('ADMIN');
    const e = await evento({
      status: 'ENDED',
      templateId: null,
      templateName: 'Cancellato',
    });
    const r = await salva(e.id, { templateId: null }, e.moderatorToken);
    expect(r.status).toBe(200);
    expect(await prisma.event.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({
      templateId: null,
      templateName: null,
    });
  });

  it('un modello che non esiste e un errore sul campo', async () => {
    await entraCome('ADMIN');
    const e = await evento({ status: 'PUBLISHED' });
    const r = await salva(
      e.id,
      { templateId: '55555555-5555-4555-8555-555555555555' },
      e.moderatorToken
    );
    expect(r.status).toBe(422);
  });

  it('con il solo link di conduzione non si cambia, ma lo stesso valore passa', async () => {
    esci();
    const e = await evento({ status: 'PUBLISHED', formatClass: 'MEETING' });

    const cambia = await salva(e.id, { formatClass: 'PUBLIC' }, e.moderatorToken);
    expect(cambia.status).toBe(403);

    const uguale = await salva(e.id, { formatClass: 'MEETING' }, e.moderatorToken);
    expect(uguale.status).toBe(200);
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: e.id } })).formatClass
    ).toBe('MEETING');
  });

  it('un salvataggio che non lo manda non lo tocca', async () => {
    await entraCome('ADMIN');
    const e = await evento({
      status: 'PUBLISHED',
      formatClass: 'MEETING',
      templateName: 'Vecchio',
    });
    const r = await salva(e.id, { qaEnabled: false }, e.moderatorToken);
    expect(r.status).toBe(200);
    expect(await prisma.event.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({
      formatClass: 'MEETING',
      templateName: 'Vecchio',
    });
  });
});

describe('le statistiche del catalogo', () => {
  it('contano gli eventi del mese per tipo e modello, con picco e durata delle sessioni', async () => {
    const ora = new Date('2026-11-18T12:00:00Z');
    const modello = await prisma.eventTemplate.create({ data: { name: 'Riunione' } });
    const quando = new Date('2026-11-10T09:00:00Z');
    const base = { startsAt: quando, endsAt: new Date(quando.getTime() + 3_600_000) };

    const tenuta = await evento({
      ...base,
      status: 'ENDED',
      formatClass: 'MEETING',
      templateId: modello.id,
      templateName: 'Riunione',
      peakParticipants: 8,
    });
    await creaSessione(tenuta.id, {
      startedAt: quando,
      endedAt: new Date(quando.getTime() + 40 * 60_000),
    });
    await creaSessione(tenuta.id, {
      startedAt: new Date(quando.getTime() + 50 * 60_000),
      endedAt: new Date(quando.getTime() + 60 * 60_000),
    });
    await evento({
      ...base,
      status: 'PUBLISHED',
      formatClass: 'MEETING',
      templateId: modello.id,
    });
    // Una bozza non conta; un evento di un anno fa nemmeno.
    await evento({ ...base, status: 'DRAFT', formatClass: 'MEETING' });
    await evento({
      startsAt: new Date('2025-10-01T09:00:00Z'),
      endsAt: new Date('2025-10-01T10:00:00Z'),
      status: 'ENDED',
      formatClass: 'MEETING',
    });
    const rapida = await evento({
      ...base,
      eventType: 'INSTANT',
      status: 'ENDED',
      peakParticipants: 3,
    });
    await creaSessione(rapida.id, {
      startedAt: quando,
      endedAt: new Date(quando.getTime() + 600_000),
    });

    const s = await statisticheCatalogo(3, 'Europe/Rome', ora);

    expect(s.months).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(s.byType.find((g) => g.type === 'MEETING')).toMatchObject({
      events: 2,
      held: 1,
      avgParticipants: 8,
      avgDurationMinutes: 50,
    });
    expect(s.byType.find((g) => g.type === 'INSTANT')).toMatchObject({
      events: 1,
      held: 1,
      avgParticipants: 3,
      avgDurationMinutes: 10,
    });
    expect(s.byTemplate.find((g) => g.templateId === modello.id)).toMatchObject({
      name: 'Riunione',
      events: 2,
    });
    expect(
      s.byType.find((g) => g.type === 'MEETING')?.byMonth.map((c) => c.events)
    ).toEqual([0, 0, 2]);
  });
});
