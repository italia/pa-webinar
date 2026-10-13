// @vitest-environment node
/**
 * GET /api/events/calendar — gli eventi del calendario, pubblico e dello
 * staff: titolo con il sopratitolo separato, etichette per i colori, e la
 * risposta dello staff fuori dalle cache condivise.
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('@/lib/auth/staff-session', () => ({
  getStaffSession: vi.fn(async () => ({ role: 'admin', accountId: null })),
  eventScope: () => ({}),
}));
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { event: { findMany: vi.fn() } } }));

import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';

import { GET } from './route';

const findMany = prisma.event.findMany as unknown as ReturnType<typeof vi.fn>;
const settings = vi.mocked(getSettings);

function chiama(mode: 'public' | 'admin') {
  return GET(
    new Request(`https://webinar.example.gov.it/api/events/calendar?mode=${mode}`, {
      headers: { 'accept-language': 'it' },
    }) as unknown as NextRequest,
    { params: Promise.resolve({}) }
  );
}

const EVENTO = {
  id: 'e1',
  slug: 'ciclo-primo',
  title: { it: 'Ciclo | Il primo incontro' },
  startsAt: new Date('2026-10-29T09:00:00Z'),
  endsAt: new Date('2026-10-29T10:00:00Z'),
  status: 'PUBLISHED',
  eventType: 'SCHEDULED',
  parseTitleKicker: null,
  postEventPublic: true,
  postEventPublicUntil: null,
  tagLinks: [{ tag: { slug: 'riuso', name: { it: 'Riuso' }, color: '#0066CC' } }],
  _count: { registrations: 4 },
};

beforeEach(() => {
  vi.clearAllMocks();
  settings.mockResolvedValue({ calendarPublic: true, parseTitleKicker: true } as Awaited<
    ReturnType<typeof getSettings>
  >);
  findMany.mockResolvedValue([EVENTO]);
});

describe('GET /api/events/calendar', () => {
  it('separa il sopratitolo come la pagina e porta le etichette', async () => {
    const res = await chiama('public');
    const [e] = (await res.json()) as Array<Record<string, unknown>>;
    expect(e).toMatchObject({
      title: 'Il primo incontro',
      kicker: 'Ciclo',
      tags: [{ slug: 'riuso', name: 'Riuso', color: '#0066CC' }],
    });
    expect(res.headers.get('cache-control')).toContain('public');
    // Al pubblico ne' gli iscritti ne' lo stato della pagina.
    expect(e).not.toHaveProperty('registrationCount');
    expect(e).not.toHaveProperty('hasPublicPage');
  });

  it('con il sopratitolo spento il titolo resta intero', async () => {
    settings.mockResolvedValue({
      calendarPublic: true,
      parseTitleKicker: false,
    } as Awaited<ReturnType<typeof getSettings>>);
    const [e] = (await (await chiama('public')).json()) as Array<Record<string, unknown>>;
    expect(e).toMatchObject({ title: 'Ciclo | Il primo incontro', kicker: null });
  });

  it('il calendario dello staff non va nelle cache condivise, e dice iscritti e pagina pubblica', async () => {
    findMany.mockResolvedValue([
      EVENTO,
      { ...EVENTO, id: 'e2', status: 'ENDED', postEventPublic: false, postEventPublicUntil: null },
    ]);
    const res = await chiama('admin');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const [aperto, chiuso] = (await res.json()) as Array<Record<string, unknown>>;
    expect(aperto).toMatchObject({ registrationCount: 4, hasPublicPage: true });
    // Concluso con la pagina post-evento spenta: la pagina pubblica non c'e'.
    expect(chiuso).toMatchObject({ hasPublicPage: false });
  });

  it('calendario pubblico spento: vuoto anche chiedendo la vista dello staff senza sessione', async () => {
    const { getStaffSession } = await import('@/lib/auth/staff-session');
    vi.mocked(getStaffSession).mockResolvedValueOnce(null);
    settings.mockResolvedValue({
      calendarPublic: false,
      parseTitleKicker: false,
    } as Awaited<ReturnType<typeof getSettings>>);
    expect(await (await chiama('admin')).json()).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('calendario pubblico spento: vuoto', async () => {
    settings.mockResolvedValue({
      calendarPublic: false,
      parseTitleKicker: false,
    } as Awaited<ReturnType<typeof getSettings>>);
    expect(await (await chiama('public')).json()).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
