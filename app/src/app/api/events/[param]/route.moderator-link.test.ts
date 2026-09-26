/**
 * La modifica di un evento e il link del moderatore principale: parte alla
 * pubblicazione e quando cambia l'indirizzo, non a ogni salvataggio del
 * wizard (che rispedisce tutti i campi). L'idempotenza per indirizzo la
 * garantisce lib/email/moderator-link; qui si verifica quando la rotta chiede.
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { stato } = vi.hoisted(() => ({
  stato: { status: 'DRAFT', moderatorEmail: 'moderatore@example.test' as string | null },
}));

vi.mock('@/lib/auth/moderator', () => ({
  extractModeratorToken: vi.fn(() => 'token-valido'),
  verifyModeratorToken: vi.fn(async () => eventoEsistente()),
  isEventModerator: vi.fn(async () => true),
  constantTimeEqual: vi.fn(() => true),
}));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/crypto/pii', () => ({
  encryptPIIOrNull: vi.fn((v: string | null | undefined) => v ?? null),
  tryDecryptPII: vi.fn((v: string | null | undefined) => v ?? null),
}));
vi.mock('@/lib/email/notification', () => ({ sendDateChangeNotifications: vi.fn() }));
vi.mock('@/lib/live-state/publish', () => ({
  publishEventStatus: vi.fn(async () => undefined),
  publishFlagsIfChanged: vi.fn(async () => undefined),
}));
vi.mock('@/lib/events/material-files', () => ({ removeFilesOfEventsBeingDeleted: vi.fn() }));
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn(async () => ({ defaultLocale: 'it' })) }));
vi.mock('@/lib/email/moderator-link', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendPrimaryModeratorLink: vi.fn(async () => true),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn(), update: vi.fn() },
    gdprTemplate: { findUnique: vi.fn() },
    registration: { count: vi.fn(async () => 0) },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/db';
import { sendPrimaryModeratorLink } from '@/lib/email/moderator-link';

import { PUT } from './route';

const EVENT_ID = '7c6d5e4f-3a2b-4c1d-8e9f-0a1b2c3d4e5f';

function eventoEsistente() {
  return {
    id: EVENT_ID,
    slug: 'evento-esistente',
    status: stato.status,
    title: { it: 'Evento esistente' },
    description: { it: 'Descrizione' },
    startsAt: new Date('2027-03-01T09:00:00.000Z'),
    endsAt: new Date('2027-03-01T10:00:00.000Z'),
    timezone: 'Europe/Rome',
    maxParticipants: 100,
    recordingEnabled: false,
    participantsCanUnmute: false,
    participantsCanStartVideo: false,
    participantsCanShareScreen: false,
    expectedSenderRatioPct: null,
    permissionMatrix: null,
    moderatorToken: 'token-valido',
    moderatorEmail: stato.moderatorEmail,
    jitsiRoomName: 'stanza',
  };
}

const db = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

function put(body: unknown): NextRequest {
  return new Request(`http://localhost/api/events/${EVENT_ID}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      authorization: 'Bearer token-valido',
      referer: 'http://localhost/en/admin/events/new',
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}
const ctx = { params: Promise.resolve({ param: EVENT_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  stato.status = 'DRAFT';
  stato.moderatorEmail = 'moderatore@example.test';
  db.event.findUnique.mockImplementation(async () => eventoEsistente());
  db.event.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...eventoEsistente(),
    ...data,
  }));
});

describe('PUT /api/events/[param] — link del moderatore principale', () => {
  it('asks for it when the event is published, in the admin page language', async () => {
    const r = await PUT(put({ status: 'PUBLISHED' }), ctx as never);
    expect(r.status).toBe(200);
    expect(sendPrimaryModeratorLink).toHaveBeenCalledWith(EVENT_ID, { locale: 'en' });
  });

  it('asks for it when the address changes', async () => {
    stato.status = 'PUBLISHED';
    await PUT(put({ moderatorEmail: 'nuovo@example.test' }), ctx as never);
    expect(sendPrimaryModeratorLink).toHaveBeenCalledTimes(1);
  });

  it('does not ask on a save that changes neither status nor address', async () => {
    stato.status = 'PUBLISHED';
    await PUT(
      put({ status: 'PUBLISHED', moderatorEmail: 'moderatore@example.test', maxParticipants: 120 }),
      ctx as never,
    );
    expect(sendPrimaryModeratorLink).not.toHaveBeenCalled();
  });

  it('ignores an address sent by a co-moderator: no write, no email', async () => {
    stato.status = 'PUBLISHED';
    const { constantTimeEqual } = await import('@/lib/auth/moderator');
    vi.mocked(constantTimeEqual).mockReturnValueOnce(false);
    const r = await PUT(put({ moderatorEmail: 'altro@example.test' }), ctx as never);
    expect(r.status).toBe(200);
    expect(sendPrimaryModeratorLink).not.toHaveBeenCalled();
    const scritto = db.event.update.mock.calls[0]?.[0] as { data: Record<string, unknown> } | undefined;
    expect(scritto?.data).not.toHaveProperty('moderatorEmail');
  });
});
