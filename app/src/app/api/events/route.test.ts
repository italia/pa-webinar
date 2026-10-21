/**
 * Contratto di scrittura della creazione di un evento.
 *
 * Nasce da un difetto reale: lo schema accettava una quindicina di campi che
 * la rotta non scriveva mai. La scelta del modello di informativa fatta in
 * creazione non arrivava in banca dati, e l'unico modo perché quella colonna
 * fosse valorizzata era duplicare un evento che la aveva già. Nessun controllo
 * lo intercettava, perché il test di esaustività che esiste confronta le
 * colonne Prisma per la DUPLICAZIONE e resta verde qualunque cosa le rotte
 * scrivano.
 *
 * Qui si verifica l'unica cosa che conta: che l'oggetto passato a `create`
 * contenga i valori inviati.
 */

import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: 'admin-session' }) })),
}));

vi.mock('@/lib/auth/staff-session', () => ({
  requireStaff: vi.fn(async () => ({ role: 'admin' })),
  puoGestire: vi.fn(async () => true),
}));

vi.mock('@/lib/audit/admin-audit', () => ({
  logAdminAction: vi.fn(async () => undefined),
}));

vi.mock('@/lib/utils/slug', () => ({
  generateUniqueSlug: vi.fn(async () => 'evento-di-prova'),
}));

vi.mock('@/lib/crypto/pii', () => ({
  encryptPIIOrNull: vi.fn((v: string | null | undefined) => v ?? null),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { create: vi.fn() },
    gdprTemplate: { findUnique: vi.fn() },
    tag: { findMany: vi.fn(async () => []) },
    eventTagLink: { createMany: vi.fn(async () => undefined) },
    questionTemplate: { findUnique: vi.fn(async () => null) },
    eventQuestionnaire: { create: vi.fn(async () => undefined) },
    eventPersonPhoto: { findFirst: vi.fn(async () => null) },
  },
}));

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ defaultLocale: 'it' })),
}));

const traduzioni = vi.hoisted(() => ({
  riconciliaTraduzioni: vi.fn(async () => ({ avviata: true, lingue: ['en'] })),
}));
vi.mock('@/lib/text-translation/auto', () => traduzioni);

vi.mock('@/lib/email/moderator-link', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendPrimaryModeratorLink: vi.fn(async () => true),
}));

import { prisma } from '@/lib/db';
import { sendPrimaryModeratorLink } from '@/lib/email/moderator-link';

import { POST } from './route';

const GDPR_ID = '3f2a1b0c-4d5e-4f6a-8b9c-0d1e2f3a4b5c';

const mocked = prisma as unknown as {
  event: { create: ReturnType<typeof vi.fn> };
  gdprTemplate: { findUnique: ReturnType<typeof vi.fn> };
  eventPersonPhoto: { findFirst: ReturnType<typeof vi.fn> };
};
const FOTO = '5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/** Corpo minimo che supera `createEventSchema`, più i campi sotto esame. */
function corpo(extra: Record<string, unknown> = {}) {
  return {
    title: { it: 'Evento di prova' },
    description: { it: 'Descrizione' },
    startsAt: '2027-03-01T09:00:00.000Z',
    endsAt: '2027-03-01T10:00:00.000Z',
    timezone: 'Europe/Rome',
    maxParticipants: 100,
    moderatorName: 'Moderatore 1',
    ...extra,
  };
}

function richiesta(body: unknown): NextRequest {
  return new Request('http://localhost/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

/** L'oggetto `data` con cui la rotta ha chiamato `event.create`. */
function datiScritti(): Record<string, unknown> {
  expect(mocked.event.create).toHaveBeenCalledTimes(1);
  return mocked.event.create.mock.calls[0]![0].data as Record<string, unknown>;
}

describe('POST /api/events — persistenza dei campi accettati', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.gdprTemplate.findUnique.mockResolvedValue({ id: GDPR_ID });
    mocked.event.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
        slug: data.slug,
        moderatorToken: data.moderatorToken,
        title: data.title,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        status: 'DRAFT',
      }),
    );
  });

  it('scrive i campi di configurazione che lo schema accetta', async () => {
    await POST(
      richiesta(
        corpo({
          gdprTemplateId: GDPR_ID,
          requireOrganization: true,
          requireOrganizationRole: true,
          requireOrganizationType: true,
          coverImageUrl: 'https://esempio.invalid/copertina.png',
          youtubeUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
          libraryListed: false,
          gracePeriodMinutes: 30,
          postEventPublic: false,
          postEventShowRecap: false,
          postEventShowWordCloud: false,
          postEventEmailEnabled: true,
          recordingConsentText: 'Testo del consenso',
          wordCloudEnabled: true,
        }),
      ),
      { params: Promise.resolve({}) } as never,
    );

    const dati = datiScritti();
    expect(dati.gdprTemplateId).toBe(GDPR_ID);
    expect(dati.requireOrganization).toBe(true);
    expect(dati.requireOrganizationRole).toBe(true);
    expect(dati.requireOrganizationType).toBe(true);
    expect(dati.coverImageUrl).toBe('https://esempio.invalid/copertina.png');
    expect(dati.youtubeUrl).toBe('https://www.youtube.com/watch?v=aaaaaaaaaaa');
    expect(dati.libraryListed).toBe(false);
    expect(dati.gracePeriodMinutes).toBe(30);
    expect(dati.postEventPublic).toBe(false);
    expect(dati.postEventShowRecap).toBe(false);
    expect(dati.postEventShowWordCloud).toBe(false);
    expect(dati.postEventEmailEnabled).toBe(true);
    expect(dati.recordingConsentText).toBe('Testo del consenso');
    expect(dati.wordCloudEnabled).toBe(true);
  });

  it('la foto dell’organizzatore principale: salvata se nessuno la usa, lasciata cadere altrimenti', async () => {
    // Da un indirizzo suo: il limite di creazioni per minuto conta per IP.
    const daAltroIp = (body: unknown) =>
      new Request('http://localhost/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.77' },
        body: JSON.stringify(body),
      }) as unknown as NextRequest;
    mocked.eventPersonPhoto.findFirst.mockResolvedValueOnce({ id: FOTO });
    await POST(daAltroIp(corpo({ moderatorPhotoId: FOTO })), { params: Promise.resolve({}) } as never);
    expect(datiScritti().moderatorPhotoId).toBe(FOTO);
    // Alla creazione la foto non può essere già di un evento.
    expect(mocked.eventPersonPhoto.findFirst.mock.calls[0]![0].where).toEqual({
      id: FOTO,
      OR: [{ leadOf: { none: {} }, grants: { none: {} } }],
    });

    vi.clearAllMocks();
    mocked.eventPersonPhoto.findFirst.mockResolvedValueOnce(null);
    const res = await POST(daAltroIp(corpo({ moderatorPhotoId: FOTO })), { params: Promise.resolve({}) } as never);
    expect(res.status).toBe(201);
    expect(datiScritti().moderatorPhotoId).toBeNull();
  });

  it('la registrazione non parte mai da sola, anche se la richiesta lo chiede', async () => {
    await POST(
      richiesta(corpo({ recordingEnabled: true, autoStartRecording: true })),
      { params: Promise.resolve({}) } as never,
    );
    const dati = datiScritti();
    expect(dati.recordingEnabled).toBe(true);
    expect(dati.autoStartRecording).toBe(false);
  });

  it('rifiuta un modello di informativa inesistente senza creare nulla', async () => {
    // Senza la verifica, la chiave esterna fallirebbe con un codice che il
    // gestore degli errori non mappa: un 500 al posto di un errore sul campo.
    mocked.gdprTemplate.findUnique.mockResolvedValue(null);

    const r = await POST(
      richiesta(corpo({ gdprTemplateId: GDPR_ID })),
      { params: Promise.resolve({}) } as never,
    );

    expect(r.status).toBe(422);
    const body = (await r.json()) as { details?: Array<{ path: string[] }> };
    expect(body.details?.[0]?.path).toEqual(['gdprTemplateId']);
    expect(mocked.event.create).not.toHaveBeenCalled();
  });

  it('non interroga i modelli di informativa quando non ne è stato scelto uno', async () => {
    await POST(richiesta(corpo()), { params: Promise.resolve({}) } as never);

    expect(mocked.gdprTemplate.findUnique).not.toHaveBeenCalled();
    expect(datiScritti().gdprTemplateId).toBeNull();
  });
});

describe('POST /api/events — link del moderatore principale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.event.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
        slug: data.slug,
        moderatorToken: data.moderatorToken,
        status: 'DRAFT',
      }),
    );
  });

  it('non lo accoda alla creazione: l’evento nasce in bozza, il link parte alla pubblicazione', async () => {
    const req = new Request('http://localhost/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        referer: 'http://localhost/fr/admin/events/new',
      },
      body: JSON.stringify(corpo({ moderatorEmail: 'moderatore@example.test' })),
    }) as unknown as NextRequest;
    const r = await POST(req, { params: Promise.resolve({}) } as never);
    expect(r.status).toBe(201);
    expect(sendPrimaryModeratorLink).not.toHaveBeenCalled();
    // Il link di gestione nella risposta passa dalla mappa dei percorsi.
    const body = (await r.json()) as { links: { moderatorLink: string } };
    expect(body.links.moderatorLink).toMatch(
      /\/it\/admin\/eventi\/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d\?token=/,
    );
  });
});

describe('POST /api/events — lingue e traduzione automatica', () => {
  const daIp = (ip: string, body: unknown) =>
    new Request('http://localhost/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }) as unknown as NextRequest;

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.event.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      slug: data.slug,
      moderatorToken: data.moderatorToken,
      status: 'DRAFT',
    }));
  });

  it('le lingue dell evento si salvano anche senza registrazione, e la traduzione parte da sola', async () => {
    const r = await POST(
      daIp('198.51.100.81', corpo({ aiTargetLocales: 'en,fr', recordingEnabled: false })),
      { params: Promise.resolve({}) } as never,
    );
    expect(r.status).toBe(201);
    expect(datiScritti().aiTargetLocales).toBe('en,fr');
    expect(traduzioni.riconciliaTraduzioni).toHaveBeenCalledWith(
      '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      expect.anything(),
    );
    expect((await r.json()).traduzione).toEqual({ avviata: true, lingue: ['en'] });
  });

  it('ogni lingua scritta, oltre alla principale, e di una persona; le vuote non si salvano', async () => {
    await POST(
      daIp(
        '198.51.100.82',
        corpo({
          title: { it: 'Evento di prova', en: 'Test event', fr: '' },
          description: { it: 'Descrizione', en: '' },
          textEdits: { touched: ['en'] },
        }),
      ),
      { params: Promise.resolve({}) } as never,
    );
    const dati = datiScritti();
    expect(dati.title).toEqual({ it: 'Evento di prova', en: 'Test event' });
    expect(dati.description).toEqual({ it: 'Descrizione' });
    const stato = dati.textLocaleState as Record<string, { origin: string; sourceHash: string }>;
    expect(Object.keys(stato)).toEqual(['en']);
    expect(stato.en!.origin).toBe('HUMAN');
    expect(stato.en!.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('un evento solo nella lingua principale non ha stato', async () => {
    await POST(daIp('198.51.100.83', corpo()), { params: Promise.resolve({}) } as never);
    expect(datiScritti()).not.toHaveProperty('textLocaleState');
  });
});
