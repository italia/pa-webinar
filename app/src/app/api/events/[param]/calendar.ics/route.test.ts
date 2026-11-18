// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: { event: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/ical/organizer', () => ({
  nomeOrganizzatoreCalendario: vi.fn(async () => 'Ente di prova'),
}));

import { GET } from './route';

const ORA = Date.now();
const evento = (over: Record<string, unknown> = {}) => ({
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'evento',
  status: 'PUBLISHED',
  eventType: 'SCHEDULED',
  title: { it: 'Titolo riservato' },
  description: { it: 'Descrizione' },
  startsAt: new Date(ORA + 3_600_000),
  endsAt: new Date(ORA + 7_200_000),
  timezone: 'Europe/Rome',
  updatedAt: new Date(ORA),
  postEventPublic: false,
  postEventPublicUntil: null,
  ...over,
});

const leggi = () =>
  GET(
    new Request(
      'http://localhost/api/events/evento/calendar.ics'
    ) as unknown as NextRequest,
    { params: Promise.resolve({ param: 'evento' }) } as never
  );

beforeEach(() => vi.clearAllMocks());

describe('GET calendar.ics', () => {
  it('un evento in programma ha il suo file', async () => {
    prisma.event.findUnique.mockResolvedValue(evento());
    const r = await leggi();
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Titolo riservato');
  });

  it('un evento concluso con la pagina visibile lo tiene', async () => {
    prisma.event.findUnique.mockResolvedValue(
      evento({ status: 'ENDED', postEventPublic: true })
    );
    expect((await leggi()).status).toBe(200);
  });

  it.each([
    ['in bozza', { status: 'DRAFT' }],
    ['archiviato', { status: 'ARCHIVED' }],
    ['concluso con la pagina privata', { status: 'ENDED' }],
    [
      'concluso con la finestra scaduta',
      {
        status: 'ENDED',
        postEventPublic: true,
        postEventPublicUntil: new Date(ORA - 1000),
      },
    ],
    ['chiamata rapida non conclusa', { status: 'LIVE', eventType: 'INSTANT' }],
  ])('%s: 404, senza il titolo', async (_n, over) => {
    prisma.event.findUnique.mockResolvedValue(evento(over));
    const r = await leggi();
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain('Titolo riservato');
  });

  it('un evento che non esiste: 404', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    expect((await leggi()).status).toBe(404);
  });
});
