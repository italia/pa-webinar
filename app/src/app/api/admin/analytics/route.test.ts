// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { admin, catalogo, overview } = vi.hoisted(() => ({
  admin: vi.fn(async () => true),
  catalogo: vi.fn(async () => ({
    months: [],
    timezone: 'Europe/Rome',
    byType: [],
    byTemplate: [],
  })),
  overview: vi.fn(async () => ({ totalEvents: 0 })),
}));

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/admin-session', () => ({ isAdminAuthenticated: admin }));
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ defaultTimezone: 'Europe/Rome' })),
}));
vi.mock('@/lib/analytics', () => ({
  getOverview: overview,
  getTimeline: vi.fn(async () => []),
  getTopEvents: vi.fn(async () => []),
  getEventAnalytics: vi.fn(async () => []),
}));
vi.mock('@/lib/analytics/catalog-stats-query', () => ({ statisticheCatalogo: catalogo }));

import { GET } from './route';

function chiedi(query = '') {
  return GET(new Request(`http://localhost:3000/api/admin/analytics${query}`) as never, {
    params: Promise.resolve({}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  admin.mockResolvedValue(true);
});

describe('GET /api/admin/analytics', () => {
  it('solo per l amministrazione', async () => {
    admin.mockResolvedValue(false);
    const res = await chiedi();
    expect(res.status).toBe(401);
    expect(catalogo).not.toHaveBeenCalled();
  });

  it('senza sezione: i numeri di sempre e il catalogo dei 12 mesi', async () => {
    const res = await chiedi('?period=30d');
    const corpo = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(
      ['catalog', 'overview', 'recentEvents', 'timeline', 'topEvents'].sort()
    );
    expect(catalogo).toHaveBeenCalledWith(12, 'Europe/Rome');
  });

  it('il catalogo da solo, nel periodo chiesto, senza rileggere il resto', async () => {
    const res = await chiedi('?section=catalog&months=6');
    const corpo = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(corpo)).toEqual(['catalog']);
    expect(catalogo).toHaveBeenCalledWith(6, 'Europe/Rome');
    expect(overview).not.toHaveBeenCalled();
  });

  it('il resto da solo, senza il catalogo', async () => {
    const res = await chiedi('?section=overview&period=7d');
    const corpo = (await res.json()) as Record<string, unknown>;
    expect(corpo.catalog).toBeUndefined();
    expect(catalogo).not.toHaveBeenCalled();
    expect(overview).toHaveBeenCalledWith(7);
  });
});
