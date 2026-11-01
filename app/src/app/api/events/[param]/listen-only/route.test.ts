// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const segna = vi.hoisted(() => vi.fn());
vi.mock('@/lib/live/seats', () => ({ segnaSoloAscolto: segna }));
vi.mock('@/lib/db', () => ({ prisma: { event: { findUnique: vi.fn() } } }));

import { prisma } from '@/lib/db';
import { generateJitsiJwt } from '@/lib/auth/jwt';

import { POST } from './route';

let ip = 0;
const dichiara = (body: unknown) => {
  ip += 1;
  return POST(
    new Request('http://localhost/api/events/ev/listen-only', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.2.0.${ip}` },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ param: 'ev' }) }
  );
};
const token = (listenOnly: boolean, stanza = 'stanza') =>
  generateJitsiJwt({
    roomName: stanza,
    displayName: 'Ospite',
    uniqueId: 'guest-1',
    isModerator: false,
    ...(listenOnly ? { listenOnly: true } : {}),
  } as never);

beforeAll(() => {
  process.env.JITSI_JWT_SECRET = 'segreto-dei-test-del-solo-ascolto';
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.event.findUnique).mockResolvedValue({
    id: 'e1',
    jitsiRoomName: 'stanza',
  } as never);
});

describe('POST listen-only', () => {
  it("segna l'endpoint quando il token dice solo ascolto", async () => {
    const res = await dichiara({ endpointId: 'ab12', roomToken: await token(true) });
    expect(res.status).toBe(204);
    expect(segna).toHaveBeenCalledWith('e1', 'ab12');
  });

  it("un token che non e' in solo ascolto non segna niente", async () => {
    expect(
      (await dichiara({ endpointId: 'ab12', roomToken: await token(false) })).status
    ).toBe(204);
    expect(segna).not.toHaveBeenCalled();
  });

  it("token di un'altra stanza: 401; corpo non valido: 422", async () => {
    expect(
      (await dichiara({ endpointId: 'ab12', roomToken: await token(true, 'altra') }))
        .status
    ).toBe(401);
    expect((await dichiara({ endpointId: 'non valido!', roomToken: 'x' })).status).toBe(
      422
    );
    expect(segna).not.toHaveBeenCalled();
  });
});
