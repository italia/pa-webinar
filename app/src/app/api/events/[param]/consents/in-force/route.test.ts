// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const leggi = vi.hoisted(() => vi.fn());
vi.mock('@/lib/live/consents-in-force', () => ({ consensiInVigoreDeiPosti: leggi }));
vi.mock('@/lib/db', () => ({ prisma: { event: { findUnique: vi.fn() } } }));

import { generateJitsiJwt } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db';

import { POST } from './route';

const SLUG = 'evento-prova';
const STANZA = 'stanza-prova';
const EVENTO = { id: 'e1', jitsiRoomName: STANZA, recordingDestination: 'PUBLIC' };
let ip = 0;

async function post(body: unknown, indirizzo = `10.2.0.${(ip += 1)}`): Promise<Response> {
  const request = new Request(
    `http://localhost:3000/api/events/${SLUG}/consents/in-force`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': indirizzo },
      body: JSON.stringify(body),
    }
  );
  return POST(request as unknown as NextRequest, {
    params: Promise.resolve({ param: SLUG }),
  });
}

const tokenSala = (
  posto: string,
  opzioni: { stanza?: string; moderatore?: boolean } = {}
) =>
  generateJitsiJwt({
    roomName: opzioni.stanza ?? STANZA,
    displayName: 'Persona',
    uniqueId: posto,
    isModerator: opzioni.moderatore ?? false,
  });

beforeAll(() => {
  process.env.JITSI_JWT_SECRET = 'segreto-dei-test-per-la-lettura-dei-consensi';
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.event.findUnique).mockResolvedValue(EVENTO as never);
  leggi.mockResolvedValue({ recording: true, transcription: false });
});

describe('POST consents/in-force', () => {
  it('il limite per indirizzo scala con quelli della sala', async () => {
    vi.stubEnv('ROOM_RATE_LIMIT_MULTIPLIER', '2');
    const token = await tokenSala('guest-a');
    const stati: number[] = [];
    for (let i = 0; i < 601; i += 1) {
      stati.push((await post({ roomTokens: [token] }, '10.3.0.1')).status);
    }
    vi.unstubAllEnvs();
    expect(stati.slice(0, 600).every((s) => s === 200)).toBe(true);
    expect(stati[600]).toBe(429);
  });

  it('risponde per i posti provati, nell ordine dei token, anche di chi modera', async () => {
    const res = await post({
      roomTokens: [
        await tokenSala('guest-a'),
        await tokenSala('mod-e1-b', { moderatore: true }),
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      recording: true,
      transcription: false,
      recordingDestination: 'PUBLIC',
    });
    expect(leggi).toHaveBeenCalledWith(EVENTO, ['guest-a', 'mod-e1-b'], 'PUBLIC');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('un token di un altra stanza non conta come posto', async () => {
    await post({
      roomTokens: [
        await tokenSala('guest-a'),
        await tokenSala('guest-b', { stanza: 'altra' }),
      ],
    });
    expect(leggi).toHaveBeenCalledWith(EVENTO, ['guest-a'], 'PUBLIC');
  });

  it('senza un token valido non si legge niente', async () => {
    const res = await post({
      roomTokens: [await tokenSala('guest-a', { stanza: 'altra' }), 'non-un-token'],
    });
    expect(res.status).toBe(401);
    expect(leggi).not.toHaveBeenCalled();
  });

  it('corpo non valido: 422', async () => {
    expect((await post({ roomTokens: [] })).status).toBe(422);
    expect((await post({ roomTokens: ['x'], altro: 1 })).status).toBe(422);
    expect(leggi).not.toHaveBeenCalled();
  });

  it('evento inesistente: 404', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(null);
    expect((await post({ roomTokens: ['x'] })).status).toBe(404);
  });

  it('un ufficio dietro un solo indirizzo regge una sala che chiede insieme', async () => {
    const roomTokens = [await tokenSala('guest-a')];
    const esiti = await Promise.all(
      Array.from({ length: 200 }, () => post({ roomTokens }, '10.2.9.9'))
    );
    expect(esiti.every((r) => r.status === 200)).toBe(true);
  });
});
