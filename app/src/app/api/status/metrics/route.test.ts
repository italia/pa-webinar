// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { access, configured, query } = vi.hoisted(() => ({
  access: vi.fn(),
  configured: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@/lib/status-page', () => ({
  statusDataAccess: access,
  ADMIN_ONLY_CACHE_CONTROL: 'private, no-store',
}));
vi.mock('@/lib/prometheus', () => ({
  isPrometheusConfigured: configured,
  queryPrometheusRange: query,
}));

import { GET } from './route';

function get() {
  return GET(
    new Request('http://localhost:3000/api/status/metrics?metric=uptime') as never,
    { params: Promise.resolve({}) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  configured.mockReturnValue(false);
  query.mockResolvedValue({ data: { result: [] } });
});

describe('GET /api/status/metrics', () => {
  it('pagina di stato spenta: 404, senza interrogare Prometheus', async () => {
    access.mockResolvedValue('none');
    const res = await get();
    expect(res.status).toBe(404);
    expect(configured).not.toHaveBeenCalled();
  });

  it('pagina accesa (o amministratore): risponde come sempre', async () => {
    access.mockResolvedValue('public');
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
  });

  it('pagina accesa: le serie restano in cache condivisa per 30 secondi', async () => {
    access.mockResolvedValue('public');
    configured.mockReturnValue(true);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=30');
  });

  it("pagina spenta: le serie dell'amministratore non finiscono in una cache condivisa", async () => {
    access.mockResolvedValue('admin');
    configured.mockReturnValue(true);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});

describe('GET /api/status/metrics — uptime', () => {
  it('seleziona `up` per job e namespace del chart, non per un nome di job di un tempo', async () => {
    vi.resetModules();
    vi.stubEnv('METRICS_JOB', 'pa-webinar');
    vi.stubEnv('POD_NAMESPACE', 'webinar');
    try {
      const { GET: get2 } = await import('./route');
      access.mockResolvedValue('public');
      configured.mockReturnValue(true);
      await get2(
        new Request('http://localhost:3000/api/status/metrics?metric=uptime') as never,
        { params: Promise.resolve({}) },
      );
      expect(query.mock.calls[0]?.[0]).toBe(
        'avg_over_time(up{namespace="webinar",job="pa-webinar"}[24h]) * 100',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
