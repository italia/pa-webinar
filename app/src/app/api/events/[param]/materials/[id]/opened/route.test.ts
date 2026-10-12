// @vitest-environment node
import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Il conteggio delle aperture di un materiale.
 *
 * Conta solo ciò che il chiamante vedrebbe nell'elenco (stessa regola del GET,
 * lib/events/material-access), una volta per chiamante e materiale ogni dieci
 * minuti, mai per chi conduce o amministra, solo da una richiesta dichiarata
 * JSON, e risponde sempre 204: un materiale invisibile, di un altro evento o
 * già contato non si distingue da uno contato.
 */
const { joinGrant, staff } = vi.hoisted(() => ({
  joinGrant: { current: false },
  staff: { current: null as null | { role: 'admin' | 'organizer'; accountId: string | null } },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventMaterial: { findFirst: vi.fn(), updateMany: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/events/join-grant', () => ({
  hasJoinGrant: vi.fn(async () => joinGrant.current),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('@/lib/auth/staff-session', () => ({
  getStaffSession: vi.fn(async () => staff.current),
}));

import { prisma } from '@/lib/db';

import { POST } from './route';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedFind = prisma.eventMaterial.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedUpdate = prisma.eventMaterial.updateMany as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedRegistration = prisma.registration.findUnique as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const MATERIAL_ID = '55555555-5555-4555-8555-555555555555';
const SLUG = 'evento-di-prova';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';
const HOUR = 60 * 60 * 1000;

function eventRow(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: EVENT_ID,
    moderatorToken: PRIMARY_TOKEN,
    status: 'LIVE',
    eventType: 'SCHEDULED',
    startsAt: new Date(now - HOUR),
    endsAt: new Date(now + HOUR),
    postEventPublic: true,
    postEventPublicUntil: null,
    joinPasswordHash: null,
    ...over,
  };
}

// Il limite sta in memoria nel modulo: ogni prova usa i propri indirizzi.
let ipSeq = 0;
const nuovoIp = () => `198.51.100.${++ipSeq}`;

/** La richiesta della sala: JSON dichiarato, corpo vuoto `{}`. */
function opened(
  {
    ip = nuovoIp(),
    token,
    id = MATERIAL_ID,
    contentType = 'application/json',
  }: { ip?: string; token?: string; id?: string; contentType?: string | null } = {},
): [NextRequest, { params: Promise<{ param: string; id: string }> }] {
  const headers: Record<string, string> = { 'x-forwarded-for': ip };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (contentType) headers['Content-Type'] = contentType;
  const req = new Request(
    `https://webinar.example.gov.it/api/events/${SLUG}/materials/${id}/opened`,
    { method: 'POST', headers, body: '{}' },
  ) as unknown as NextRequest;
  return [req, { params: Promise.resolve({ param: SLUG, id }) }];
}

/** Il `where` con cui la rotta ha cercato il materiale. */
function whereCercato(): Record<string, unknown> {
  const call = mockedFind.mock.calls[0]?.[0] as { where: Record<string, unknown> } | undefined;
  expect(call, 'nessuna ricerca del materiale').toBeDefined();
  return call!.where;
}

beforeEach(() => {
  vi.clearAllMocks();
  joinGrant.current = false;
  staff.current = null;
  mockedEvent.mockResolvedValue(eventRow());
  mockedFind.mockResolvedValue({ id: MATERIAL_ID });
  mockedUpdate.mockResolvedValue({ count: 1 });
  mockedGrant.mockResolvedValue(null);
  mockedRegistration.mockResolvedValue(null);
});

describe('POST /api/events/[slug]/materials/[id]/opened — cosa conta', () => {
  it('un materiale visibile al pubblico: conta uno, in modo atomico', async () => {
    const res = await POST(...opened());
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    // Stesso filtro dell'elenco pubblico in diretta, più l'id.
    expect(whereCercato()).toEqual({
      eventId: EVENT_ID,
      visibility: { in: ['ALWAYS', 'DURING'] },
      id: MATERIAL_ID,
    });
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: MATERIAL_ID, eventId: EVENT_ID },
      data: { openCount: { increment: 1 } },
    });
  });

  it('un materiale che il pubblico non vede in questa fase: 204, niente conta', async () => {
    mockedFind.mockResolvedValue(null);
    const res = await POST(...opened());
    expect(res.status).toBe(204);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('il materiale di un altro evento non si raggiunge da questo: la ricerca è per evento', async () => {
    mockedFind.mockResolvedValue(null);
    const res = await POST(...opened());
    expect(res.status).toBe(204);
    expect(whereCercato()).toMatchObject({ eventId: EVENT_ID, id: MATERIAL_ID });
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

});

describe('POST /api/events/[slug]/materials/[id]/opened — chi non conta', () => {
  it('chi conduce controlla, non apre da pubblico: 204, niente conta', async () => {
    const res = await POST(...opened({ token: PRIMARY_TOKEN }));
    expect(res.status).toBe(204);
    expect(mockedFind).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('nemmeno un co-moderatore', async () => {
    mockedGrant.mockResolvedValue({
      eventId: EVENT_ID,
      revokedAt: null,
      role: 'MODERATOR',
      token: 'TOKEN_CO_MODERATORE',
    });
    const res = await POST(...opened({ token: 'TOKEN_CO_MODERATORE' }));
    expect(res.status).toBe(204);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('nemmeno chi ha una sessione dello staff, anche senza token', async () => {
    for (const sessione of [
      { role: 'admin' as const, accountId: null },
      { role: 'organizer' as const, accountId: '77777777-7777-4777-8777-777777777777' },
    ]) {
      staff.current = sessione;
      const res = await POST(...opened());
      expect(res.status).toBe(204);
    }
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('un relatore apre come il pubblico: conta', async () => {
    mockedGrant.mockResolvedValue({
      eventId: EVENT_ID,
      revokedAt: null,
      role: 'SPEAKER',
      token: 'TOKEN_RELATORE',
    });
    await POST(...opened({ token: 'TOKEN_RELATORE' }));
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/events/[slug]/materials/[id]/opened — solo dalla sala', () => {
  it('senza Content-Type JSON (una richiesta «semplice» da un’altra pagina): 204, niente conta', async () => {
    for (const contentType of [null, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const res = await POST(...opened({ contentType }));
      expect(res.status).toBe(204);
    }
    expect(mockedEvent).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('JSON con il charset: conta', async () => {
    await POST(...opened({ contentType: 'application/json; charset=utf-8' }));
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
  });

  it('un evento senza pagina pubblica: 204, nessuna ricerca', async () => {
    mockedEvent.mockResolvedValue(eventRow({ status: 'DRAFT' }));
    const res = await POST(...opened());
    expect(res.status).toBe(204);
    expect(mockedFind).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('un evento che non esiste: 204, come gli altri', async () => {
    mockedEvent.mockResolvedValue(null);
    const res = await POST(...opened());
    expect(res.status).toBe(204);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('evento protetto da password e chiamante fuori dalla stanza: 204, niente conta', async () => {
    mockedEvent.mockResolvedValue(eventRow({ joinPasswordHash: 'hash' }));
    const res = await POST(...opened());
    expect(res.status).toBe(204);
    expect(mockedFind).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('evento protetto da password e iscritto con il proprio token: conta', async () => {
    mockedEvent.mockResolvedValue(eventRow({ joinPasswordHash: 'hash' }));
    mockedRegistration.mockResolvedValue({ eventId: EVENT_ID });
    const res = await POST(...opened({ token: 'TOKEN_DI_UN_ISCRITTO' }));
    expect(res.status).toBe(204);
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
  });

  it('un id che non è un UUID: 204, il database non si interroga', async () => {
    const res = await POST(...opened({ id: 'non-un-uuid' }));
    expect(res.status).toBe(204);
    expect(mockedEvent).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('un materiale tolto nel frattempo non è un errore', async () => {
    mockedUpdate.mockResolvedValue({ count: 0 });
    const res = await POST(...opened());
    expect(res.status).toBe(204);
  });
});

describe('POST /api/events/[slug]/materials/[id]/opened — una volta per chiamante', () => {
  it('dallo stesso indirizzo, senza token: conta la prima volta sola', async () => {
    const ip = nuovoIp();
    expect((await POST(...opened({ ip }))).status).toBe(204);
    expect((await POST(...opened({ ip }))).status).toBe(204);
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    // Un altro indirizzo è un altro chiamante.
    await POST(...opened());
    expect(mockedUpdate).toHaveBeenCalledTimes(2);
  });

  it('con un token di sala valido: conta una volta anche da indirizzi diversi', async () => {
    mockedRegistration.mockResolvedValue({ eventId: EVENT_ID });
    // Un token che nessun'altra prova usa: il limite resta in memoria.
    await POST(...opened({ token: 'TOKEN_ISCRITTO_SU_DUE_RETI' }));
    await POST(...opened({ token: 'TOKEN_ISCRITTO_SU_DUE_RETI' }));
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
  });

  it('due iscritti dietro lo stesso indirizzo contano due volte', async () => {
    mockedRegistration.mockResolvedValue({ eventId: EVENT_ID });
    const ip = nuovoIp();
    await POST(...opened({ ip, token: 'TOKEN_ISCRITTO_A' }));
    await POST(...opened({ ip, token: 'TOKEN_ISCRITTO_B' }));
    expect(mockedUpdate).toHaveBeenCalledTimes(2);
  });

  it('un token inventato non è un’identità: vale l’indirizzo', async () => {
    // Altrimenti basterebbe un token nuovo a ogni richiesta per gonfiare il
    // numero.
    const ip = nuovoIp();
    await POST(...opened({ ip, token: 'INVENTATO_1' }));
    await POST(...opened({ ip, token: 'INVENTATO_2' }));
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
  });

  it('il token di un altro evento non è un’identità qui', async () => {
    mockedRegistration.mockResolvedValue({ eventId: '99999999-9999-4999-8999-999999999999' });
    const ip = nuovoIp();
    await POST(...opened({ ip, token: 'TOKEN_ALTRUI_1' }));
    await POST(...opened({ ip, token: 'TOKEN_ALTRUI_2' }));
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
  });
});
