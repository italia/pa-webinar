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
  },
}));

import { prisma } from '@/lib/db';

import { POST } from './route';

const GDPR_ID = '3f2a1b0c-4d5e-4f6a-8b9c-0d1e2f3a4b5c';

const mocked = prisma as unknown as {
  event: { create: ReturnType<typeof vi.fn> };
  gdprTemplate: { findUnique: ReturnType<typeof vi.fn> };
};

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
