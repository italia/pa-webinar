// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Il recorder reclama la registrazione che gli e' stata assegnata e riceve il
 * token per entrare in stanza: lo ottiene solo con la chiave interna, entra da
 * semplice partecipante, e il token dura quanto serve all'evento e non di piu'.
 */
import { jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: { recording: { findUnique: vi.fn() } },
}));

vi.mock('@/lib/db', () => ({ prisma }));

import { RECORDER_DISPLAY_NAME } from '@/lib/jitsi/participants';
import { recorderSeat } from '@/lib/recorder/seat';

import { POST } from './route';

const CHIAVE = 'chiave-interna-di-prova';
const SEGRETO_JITSI = 'segreto-di-prova-della-stanza-abbastanza-lungo';
const REGISTRAZIONE_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const EVENTO_ID = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const STANZA = 'call-stanza-di-prova';
const MINUTO = 60;
const ORA = 60 * MINUTO;

function reclama(
  corpo: unknown,
  headers: Record<string, string> = { 'x-api-key': CHIAVE }
) {
  const request = new Request('http://localhost:3000/api/internal/recorder-claim', {
    method: 'POST',
    headers,
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

interface Consegna {
  recordingId: string;
  eventId: string;
  roomName: string;
  jwt: string;
}

async function tokenDa(r: Response) {
  const { jwt } = (await r.json()) as Consegna;
  const { payload } = await jwtVerify(jwt, new TextEncoder().encode(SEGRETO_JITSI), {
    issuer: 'pa-webinar',
    audience: 'jitsi',
  });
  return payload as typeof payload & {
    room: string;
    moderator: boolean;
    affiliation: string;
    context: { user: Record<string, unknown> };
  };
}

function eventoCheFinisceFra(secondi: number) {
  prisma.recording.findUnique.mockResolvedValue({
    id: REGISTRAZIONE_ID,
    eventId: EVENTO_ID,
    event: { jitsiRoomName: STANZA, endsAt: new Date(Date.now() + secondi * 1000) },
  });
}

async function durataDelToken() {
  const token = await tokenDa(await reclama({ recordingId: REGISTRAZIONE_ID }));
  return token.exp! - token.iat!;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.CRON_API_KEY = CHIAVE;
  process.env.JITSI_JWT_SECRET = SEGRETO_JITSI;
  delete process.env.JITSI_JWT_ISSUER;
  delete process.env.JITSI_JWT_AUDIENCE;
  eventoCheFinisceFra(ORA);
});

describe('chi puo’ reclamare', () => {
  it('senza la chiave giusta non si legge niente e non si conia niente', async () => {
    const corpo = { recordingId: REGISTRAZIONE_ID };
    expect((await reclama(corpo, {})).status).toBe(401);
    expect((await reclama(corpo, { 'x-api-key': 'sbagliata' })).status).toBe(401);
    expect((await reclama(corpo, { 'x-api-key': `${CHIAVE}x` })).status).toBe(401);
    expect(prisma.recording.findUnique).not.toHaveBeenCalled();
  });

  it('la chiave vale solo nel suo header', async () => {
    const r = await reclama(
      { recordingId: REGISTRAZIONE_ID },
      { authorization: `Bearer ${CHIAVE}` }
    );
    expect(r.status).toBe(401);
    expect(prisma.recording.findUnique).not.toHaveBeenCalled();
  });

  it('senza CRON_API_KEY configurata non passa nessuno, nemmeno con la chiave vuota', async () => {
    delete process.env.CRON_API_KEY;
    const r = await reclama({ recordingId: REGISTRAZIONE_ID }, { 'x-api-key': '' });
    expect(r.status).toBe(401);
    expect(prisma.recording.findUnique).not.toHaveBeenCalled();
  });

  it('il controllo della chiave viene prima del corpo', async () => {
    expect((await reclama('non json', {})).status).toBe(401);
  });
});

describe('la richiesta', () => {
  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await reclama('non json')).status).toBe(400);
  });

  it('senza un identificativo valido e’ 422, e non si legge niente', async () => {
    for (const corpo of [{}, { recordingId: 'non-un-uuid' }, { recordingId: 42 }, null]) {
      expect((await reclama(corpo)).status).toBe(422);
    }
    expect(prisma.recording.findUnique).not.toHaveBeenCalled();
  });

  it('una registrazione sconosciuta e’ 404, senza token', async () => {
    prisma.recording.findUnique.mockResolvedValue(null);
    const r = await reclama({ recordingId: REGISTRAZIONE_ID });
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain('jwt');
  });

  it('si cerca la registrazione chiesta', async () => {
    await reclama({ recordingId: REGISTRAZIONE_ID });
    expect(prisma.recording.findUnique.mock.calls[0]![0].where).toEqual({
      id: REGISTRAZIONE_ID,
    });
  });
});

describe('il token del recorder', () => {
  it('vale per la stanza dell’evento, da semplice partecipante', async () => {
    const token = await tokenDa(await reclama({ recordingId: REGISTRAZIONE_ID }));
    expect(token.room).toBe(STANZA);
    expect(token.moderator).toBe(false);
    expect(token.affiliation).toBe('member');
    expect(token.context.user).toMatchObject({
      id: recorderSeat(REGISTRAZIONE_ID),
      name: RECORDER_DISPLAY_NAME,
      moderator: 'false',
      affiliation: 'member',
    });
  });

  it('la consegna contiene solo cio’ che serve al recorder', async () => {
    const r = await reclama({ recordingId: REGISTRAZIONE_ID });
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as Consegna;
    expect(Object.keys(corpo).sort()).toEqual([
      'eventId',
      'jwt',
      'recordingId',
      'roomName',
    ]);
    expect(corpo).toMatchObject({
      recordingId: REGISTRAZIONE_ID,
      eventId: EVENTO_ID,
      roomName: STANZA,
    });
    expect(JSON.stringify(corpo)).not.toContain(SEGRETO_JITSI);
  });

  it('dura fino a mezz’ora dopo la fine dell’evento', async () => {
    eventoCheFinisceFra(2 * ORA);
    const durata = await durataDelToken();
    expect(durata).toBeGreaterThan(2 * ORA + 30 * MINUTO - 5);
    expect(durata).toBeLessThanOrEqual(2 * ORA + 30 * MINUTO);
  });

  it('dura almeno dieci minuti, anche a evento finito da un pezzo', async () => {
    eventoCheFinisceFra(-5 * ORA);
    expect(await durataDelToken()).toBe(10 * MINUTO);
  });

  it('non dura mai piu’ di sei ore, anche per un evento lunghissimo', async () => {
    eventoCheFinisceFra(48 * ORA);
    expect(await durataDelToken()).toBe(6 * ORA);
  });

  it('senza il segreto di Jitsi non si conia niente, e non si dice perche’', async () => {
    delete process.env.JITSI_JWT_SECRET;
    const r = await reclama({ recordingId: REGISTRAZIONE_ID });
    expect(r.status).toBe(500);
    await expect(r.json()).resolves.toEqual({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  });
});
