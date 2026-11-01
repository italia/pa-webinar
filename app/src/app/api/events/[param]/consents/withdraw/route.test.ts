// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const ritira = vi.hoisted(() => vi.fn());
vi.mock('@/lib/live/consent-withdrawal', () => ({ ritiraConsensi: ritira }));
vi.mock('@/lib/db', () => ({ prisma: { event: { findUnique: vi.fn() } } }));

import { prisma } from '@/lib/db';
import { generateJitsiJwt } from '@/lib/auth/jwt';

import { POST } from './route';

const SLUG = 'evento-prova';
const STANZA = 'stanza-prova';
let ip = 0;

async function post(body: unknown): Promise<Response> {
  ip += 1;
  const request = new Request(
    `http://localhost:3000/api/events/${SLUG}/consents/withdraw`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${ip}` },
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
  process.env.JITSI_JWT_SECRET = 'segreto-dei-test-per-il-ritiro-dei-consensi';
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.event.findUnique).mockResolvedValue({
    id: 'e1',
    jitsiRoomName: STANZA,
  } as never);
  ritira.mockResolvedValue({ registrazione: true, trascrizione: true });
});

describe('POST consents/withdraw', () => {
  it('ritira per i posti provati dai token della sala, anche di chi modera', async () => {
    const res = await post({
      roomTokens: [
        await tokenSala('guest-a'),
        await tokenSala('mod-e1-b', { moderatore: true }),
      ],
      recording: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      withdrawn: { recording: true, transcription: true },
    });
    expect(ritira).toHaveBeenCalledWith('e1', ['guest-a', 'mod-e1-b'], {
      registrazione: true,
    });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it("i token di un'altra stanza o non firmati dal portale non provano niente", async () => {
    const res = await post({
      roomTokens: [await tokenSala('guest-a', { stanza: 'altra' }), 'non-un-token'],
      recording: false,
    });
    expect(res.status).toBe(401);
    expect(ritira).not.toHaveBeenCalled();
  });

  it('vale solo il posto provato: un token buono e uno no', async () => {
    await post({
      roomTokens: [
        await tokenSala('guest-a'),
        await tokenSala('guest-b', { stanza: 'altra' }),
      ],
      recording: false,
    });
    expect(ritira).toHaveBeenCalledWith('e1', ['guest-a'], { registrazione: false });
  });

  it('corpo non valido: 422, nessun ritiro', async () => {
    expect((await post({ roomTokens: [], recording: true })).status).toBe(422);
    expect((await post({ roomTokens: ['x'], recording: 'si' })).status).toBe(422);
    expect((await post({ roomTokens: ['x'], recording: true, altro: 1 })).status).toBe(
      422
    );
    expect(ritira).not.toHaveBeenCalled();
  });

  it('evento inesistente: 404', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue(null);
    expect(
      (await post({ roomTokens: [await tokenSala('guest-a')], recording: true })).status
    ).toBe(404);
  });
});
