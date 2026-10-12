import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ posto: vi.fn(), consenso: vi.fn() }));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
vi.mock('@/lib/captions/room', () => ({ postoDellEndpoint: m.posto, consensoTrascrizione: m.consenso }));

import { GET } from './route';

const EVENTO = '11111111-2222-4333-8444-555555555555';
const chiedi = (q: string) =>
  GET(new Request(`http://localhost/api/internal/recorder/consent${q}`) as unknown as NextRequest, {
    params: Promise.resolve({}),
  } as never);

beforeEach(() => vi.clearAllMocks());

describe('GET /api/internal/recorder/consent', () => {
  it('si registra solo chi ha dato il consenso', async () => {
    m.posto.mockResolvedValue('mod-x');
    m.consenso.mockResolvedValueOnce({ dato: true, nome: 'M' });
    expect(await (await chiedi(`?eventId=${EVENTO}&endpoint=ab`)).json()).toEqual({ record: true });
    // Per la traccia audio vale il consenso dato con ogni versione del testo.
    expect(m.consenso).toHaveBeenLastCalledWith(EVENTO, 'mod-x', 1);
    m.consenso.mockResolvedValueOnce({ dato: false, nome: null });
    expect(await (await chiedi(`?eventId=${EVENTO}&endpoint=ab`)).json()).toEqual({ record: false });
  });

  it('chi non e\' riconosciuto non si registra', async () => {
    m.posto.mockResolvedValue(null);
    expect(await (await chiedi(`?eventId=${EVENTO}&endpoint=zz`)).json()).toEqual({
      record: false,
      reason: 'unknown',
    });
    expect(m.consenso).not.toHaveBeenCalled();
  });

  it('senza evento o endpoint validi: 400', async () => {
    expect((await chiedi('?endpoint=ab')).status).toBe(400);
  });
});
