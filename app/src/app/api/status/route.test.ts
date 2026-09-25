// @vitest-environment node
/**
 * A pagina di stato spenta la rotta risponde ancora — la sala live la
 * interroga per sapere se il ponte video è pronto — ma solo con quei valori.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { visible } = vi.hoisted(() => ({ visible: vi.fn() }));

vi.mock('@/lib/status-page', () => ({ statusDataVisible: visible }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => ({}) }));
vi.mock('@/lib/jvb-snapshot', () => ({ readJvbSnapshot: vi.fn(async () => null) }));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    registration: { count: vi.fn(async () => 0) },
    orphanRecording: { count: vi.fn(async () => 0) },
  },
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/status — pagina di stato spenta', () => {
  it('al pubblico arrivano solo i valori che legge la sala live', async () => {
    visible.mockResolvedValue(false);

    const res = await GET(new Request('http://localhost:3000/api/status') as never, {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(['lastChecked', 'metrics']);
    expect(Object.keys(body.metrics as object).sort()).toEqual([
      'jibriStatus',
      'jvbParticipants',
      'jvbStale',
      'jvbStatus',
    ]);
  });
});
