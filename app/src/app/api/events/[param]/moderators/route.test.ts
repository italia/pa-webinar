import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Aggiungere un co-moderatore o un relatore con un indirizzo fa partire il
 * suo link personale per email: e' quello che il wizard e il pannello
 * promettono. Senza indirizzo non parte nulla.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventModerator: { create: vi.fn() },
    eventPersonPhoto: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/crypto/pii', () => ({
  encryptPII: (v: string) => v,
  encryptPIIOrNull: (v: string | null | undefined) => v ?? null,
  tryDecryptPII: (v: string | null) => v,
  hashEmail: (v: string) => `hash:${v}`,
}));
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ defaultLocale: 'it' })),
}));
vi.mock('@/lib/email/moderator-link', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendGrantModeratorLink: vi.fn(async () => true),
}));

// La sessione dello staff dell'evento: con il solo link (il caso di
// partenza) una foto che nessuno usa non si aggancia.
const staff = vi.hoisted(() => ({ isEventManager: vi.fn(async () => false) }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/staff-session', () => staff);

const organizerMark = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/lib/auth/organizer-mark', async () => {
  const { ForbiddenError } = await import('@/lib/errors');
  return {
    requireOrganizerMarkRight: vi.fn(async () => {
      if (!organizerMark.allowed) throw new ForbiddenError('Only staff who manage the event can name an organizer');
    }),
  };
});

import { prisma } from '@/lib/db';
import { sendGrantModeratorLink } from '@/lib/email/moderator-link';

import { POST } from './route';

const db = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn> };
  eventModerator: { create: ReturnType<typeof vi.fn> };
  eventPersonPhoto: { findFirst: ReturnType<typeof vi.fn> };
};
const FOTO = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const EVENT_ID = '0e5c3a9e-4b1d-4c7e-9f2a-6d8b1c3e5f70';
const PRIMARY = '7b2f9c1e-3a4d-4e5f-8a6b-9c0d1e2f3a4b';

let ip = 0;
function post(body: Record<string, unknown>, referer?: string): Request {
  ip += 1;
  return new Request(`https://portale.example.test/api/events/${EVENT_ID}/moderators`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${PRIMARY}`,
      'x-forwarded-for': `198.51.100.${ip}`,
      ...(referer ? { referer } : {}),
    },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ param: EVENT_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  organizerMark.allowed = true;
  db.event.findUnique.mockResolvedValue({ id: EVENT_ID, moderatorToken: PRIMARY });
  db.eventModerator.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'grant-9',
    createdAt: new Date(),
    revokedAt: null,
    ...data,
  }));
});

describe('POST /api/events/[param]/moderators — link by email', () => {
  it('queues the personal link of a speaker added with an address', async () => {
    const res = await POST(
      post(
        { name: 'Relatore 1', email: 'relatore@example.test', role: 'SPEAKER' },
        'https://portale.example.test/en/admin/events/new',
      ) as never,
      ctx as never,
    );
    expect(res.status).toBe(201);
    expect(sendGrantModeratorLink).toHaveBeenCalledWith('grant-9', { locale: 'en' });
  });

  it('queues nothing for a grant without an address', async () => {
    const res = await POST(post({ name: 'Relatore 1', role: 'MODERATOR' }) as never, ctx as never);
    expect(res.status).toBe(201);
    expect(sendGrantModeratorLink).not.toHaveBeenCalled();
  });
});

describe('POST /api/events/[param]/moderators — profilo della persona', () => {
  it("salva ente, logo, organizzatore e presenza nella pagina pubblica", async () => {
    const res = await POST(
      post({
        name: 'Organizzatrice 1',
        email: 'org@example.test',
        role: 'MODERATOR',
        organizer: true,
        organization: 'Ente di esempio',
        organizationLogoUrl: 'https://portale.example.test/api/assets/images/logo.png',
        publicListed: true,
      }) as never,
      ctx as never,
    );
    expect(res.status).toBe(201);
    // L'impronta si salva ma non torna al browser.
    expect(await res.json()).not.toHaveProperty('emailHash');
    const data = db.eventModerator.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      role: 'MODERATOR',
      emailHash: 'hash:org@example.test',
      organizer: true,
      organization: 'Ente di esempio',
      organizationLogoUrl: 'https://portale.example.test/api/assets/images/logo.png',
      publicListed: true,
    });
  });

  it('il solo link principale non basta per nominare un organizzatore', async () => {
    organizerMark.allowed = false;
    const res = await POST(
      post({ name: 'Persona 1', email: 'p1@example.test', role: 'MODERATOR', organizer: true }) as never,
      ctx as never,
    );
    expect(res.status).toBe(403);
    expect(db.eventModerator.create).not.toHaveBeenCalled();
  });

  it('un moderatore senza segno si aggiunge con il solo link principale', async () => {
    organizerMark.allowed = false;
    const res = await POST(post({ name: 'Persona 1', role: 'MODERATOR' }) as never, ctx as never);
    expect(res.status).toBe(201);
  });

  it('rifiuta un relatore segnato come organizzatore', async () => {
    const res = await POST(
      post({ name: 'Relatore 1', role: 'SPEAKER', organizer: true }) as never,
      ctx as never,
    );
    expect(res.status).toBe(422);
    expect(db.eventModerator.create).not.toHaveBeenCalled();
  });

  it('senza profilo, la persona resta fuori dalla pagina pubblica', async () => {
    await POST(post({ name: 'Moderatore 1', role: 'MODERATOR' }) as never, ctx as never);
    const data = db.eventModerator.create.mock.calls[0]![0].data;
    expect(data.publicListed).toBeUndefined();
    expect(data.organizer).toBeUndefined();
    expect(data.photoId).toBeUndefined();
    expect(db.eventPersonPhoto.findFirst).not.toHaveBeenCalled();
  });

  it('salva la foto caricata dal wizard, se nessun altro evento la usa', async () => {
    staff.isEventManager.mockResolvedValueOnce(true);
    db.eventPersonPhoto.findFirst.mockResolvedValue({ id: FOTO });
    const res = await POST(
      post({ name: 'Relatore 1', role: 'SPEAKER', photoId: FOTO }) as never,
      ctx as never,
    );
    expect(res.status).toBe(201);
    expect(db.eventModerator.create.mock.calls[0]![0].data.photoId).toBe(FOTO);
    const where = db.eventPersonPhoto.findFirst.mock.calls[0]![0].where as { OR: unknown[] };
    expect(where.OR).toContainEqual({ grants: { some: { eventId: EVENT_ID } } });
  });

  it('una foto che nessuno usa la aggancia solo lo staff dell’evento, non il solo link', async () => {
    const libera = { leadOf: { none: {} }, grants: { none: {} } };
    db.eventPersonPhoto.findFirst.mockResolvedValue(null);
    await POST(post({ name: 'Relatore 1', role: 'SPEAKER', photoId: FOTO }) as never, ctx as never);
    expect(staff.isEventManager).toHaveBeenCalledWith(expect.anything(), EVENT_ID);
    const soloLink = db.eventPersonPhoto.findFirst.mock.calls[0]![0].where as { OR: unknown[] };
    expect(soloLink.OR).not.toContainEqual(libera);
    expect(db.eventModerator.create.mock.calls[0]![0].data.photoId).toBeNull();

    // Lo staff che crea l'evento dal wizard: la foto appena caricata.
    staff.isEventManager.mockResolvedValueOnce(true);
    db.eventPersonPhoto.findFirst.mockResolvedValue({ id: FOTO });
    await POST(post({ name: 'Relatore 2', role: 'SPEAKER', photoId: FOTO }) as never, ctx as never);
    const conStaff = db.eventPersonPhoto.findFirst.mock.calls[1]![0].where as { OR: unknown[] };
    expect(conStaff.OR).toContainEqual(libera);
    expect(db.eventModerator.create.mock.calls[1]![0].data.photoId).toBe(FOTO);
  });

  it('una foto che non c’è più si lascia cadere: la persona si aggiunge comunque', async () => {
    db.eventPersonPhoto.findFirst.mockResolvedValue(null);
    const res = await POST(
      post({ name: 'Relatore 1', role: 'SPEAKER', photoId: FOTO }) as never,
      ctx as never,
    );
    expect(res.status).toBe(201);
    expect(db.eventModerator.create.mock.calls[0]![0].data.photoId).toBeNull();
  });
});
