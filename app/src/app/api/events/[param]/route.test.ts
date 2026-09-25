/**
 * Contratto di scrittura della modifica di un evento.
 *
 * Questa rotta riceve due tipi di richiesta molto diversi: il salvataggio
 * completo dal wizard e una lunga serie di modifiche PARZIALI — un cambio di
 * stato dalla sala, un flag di fine evento, la pubblicazione di una
 * registrazione. Aggiungere un campo all'oggetto di aggiornamento senza
 * condizionarlo a `!== undefined` lo scriverebbe anche quando nessuno lo ha
 * inviato, azzerando silenziosamente una configurazione esistente.
 *
 * È il motivo per cui questo file esiste: i campi si aggiungono, e la prova
 * che le modifiche parziali restino parziali dev'essere automatica.
 */

import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/moderator', () => ({
  extractModeratorToken: vi.fn(() => 'token-valido'),
  verifyModeratorToken: vi.fn(async () => eventoEsistente()),
  isEventModerator: vi.fn(async () => true),
  constantTimeEqual: vi.fn(() => true),
}));

vi.mock('@/lib/audit/admin-audit', () => ({
  logAdminAction: vi.fn(async () => undefined),
}));

vi.mock('@/lib/crypto/pii', () => ({
  encryptPIIOrNull: vi.fn((v: string | null | undefined) => v ?? null),
  tryDecryptPII: vi.fn((v: string | null | undefined) => v ?? null),
}));

vi.mock('@/lib/email/notification', () => ({
  sendDateChangeNotifications: vi.fn(async () => undefined),
}));

vi.mock('@/lib/live-state/publish', () => ({
  publishEventStatus: vi.fn(async () => undefined),
  publishFlagsIfChanged: vi.fn(async () => undefined),
}));

const { files } = vi.hoisted(() => ({
  files: { removeFilesOfEventsBeingDeleted: vi.fn() },
}));
vi.mock('@/lib/events/material-files', () => files);

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    gdprTemplate: { findUnique: vi.fn() },
    registration: { count: vi.fn(async () => 0) },
  },
}));

import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';

import { DELETE, PUT } from './route';

const EVENT_ID = '7c6d5e4f-3a2b-4c1d-8e9f-0a1b2c3d4e5f';
const GDPR_ID = '3f2a1b0c-4d5e-4f6a-8b9c-0d1e2f3a4b5c';

const mocked = prisma as unknown as {
  event: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  gdprTemplate: { findUnique: ReturnType<typeof vi.fn> };
};

/** Evento in stato pubblicato, con una configurazione di profilazione attiva. */
function eventoEsistente(status = 'PUBLISHED') {
  return {
    id: EVENT_ID,
    slug: 'evento-esistente',
    status,
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
    // La configurazione che una modifica parziale non deve poter cancellare.
    requireOrganization: true,
    requireOrganizationRole: true,
    requireOrganizationType: true,
    privacyPolicyText: 'Informativa scritta a mano',
    gdprTemplateId: null,
    permissionMatrix: null,
    moderatorToken: 'token-valido',
    jitsiRoomName: 'stanza',
  };
}

function richiesta(body: unknown): NextRequest {
  return new Request(`http://localhost/api/events/${EVENT_ID}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      authorization: 'Bearer token-valido',
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const contesto = { params: Promise.resolve({ param: EVENT_ID }) };

/** L'oggetto `data` con cui la rotta ha chiamato `event.update`. */
function datiScritti(): Record<string, unknown> {
  expect(mocked.event.update).toHaveBeenCalledTimes(1);
  return mocked.event.update.mock.calls[0]![0].data as Record<string, unknown>;
}

/** I campi che una modifica parziale non deve mai portare con sé. */
const MAI_SENZA_INVIO = [
  'requireOrganization',
  'requireOrganizationRole',
  'requireOrganizationType',
  'privacyPolicyText',
  'gdprTemplateId',
] as const;

describe('PUT /api/events/[param] — le modifiche parziali restano parziali', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.event.findUnique.mockResolvedValue(eventoEsistente());
    mocked.gdprTemplate.findUnique.mockResolvedValue({ id: GDPR_ID });
    mocked.event.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...eventoEsistente(),
        ...data,
      }),
    );
  });

  // Sono i corpi veri che la sala e i pannelli di fine evento inviano.
  it.each([
    ['un cambio di stato dalla sala', { status: 'LIVE' }],
    ['un flag di fine evento', { postEventShowQA: false }],
    ['la pubblicazione in libreria', { libraryListed: true }],
  ])('%s non tocca la configurazione non inviata', async (_nome, corpo) => {
    await PUT(richiesta(corpo), contesto as never);

    const dati = datiScritti();
    for (const campo of MAI_SENZA_INVIO) {
      expect(dati).not.toHaveProperty(campo);
    }
  });

  it('scrive i campi quando sono inviati davvero', async () => {
    await PUT(
      richiesta({
        requireOrganization: false,
        requireOrganizationRole: false,
        requireOrganizationType: false,
        gdprTemplateId: GDPR_ID,
      }),
      contesto as never,
    );

    const dati = datiScritti();
    expect(dati.requireOrganization).toBe(false);
    expect(dati.requireOrganizationRole).toBe(false);
    expect(dati.requireOrganizationType).toBe(false);
    expect(dati.gdprTemplateId).toBe(GDPR_ID);
  });

  it('svuota il testo dell\'informativa quando arriva una stringa vuota', async () => {
    // È il percorso che usa il wizard quando si sceglie un modello: la
    // stringa vuota deve arrivare in banca dati, altrimenti il testo scritto
    // a mano continuerebbe a vincere su una scelta già fatta.
    await PUT(richiesta({ privacyPolicyText: '' }), contesto as never);

    const dati = datiScritti();
    expect(dati).toHaveProperty('privacyPolicyText');
    expect(dati.privacyPolicyText).toBe('');
  });

  it('rifiuta un testo dell\'informativa nullo', async () => {
    // Limite noto dello schema: il campo non è dichiarato annullabile, quindi
    // si svuota con la stringa vuota e non con `null`. Fissato qui perché il
    // giorno in cui lo schema cambia, questo test lo dica.
    const r = await PUT(richiesta({ privacyPolicyText: null }), contesto as never);

    expect(r.status).toBe(422);
    expect(mocked.event.update).not.toHaveBeenCalled();
  });

  it('rifiuta un modello di informativa inesistente senza scrivere nulla', async () => {
    mocked.gdprTemplate.findUnique.mockResolvedValue(null);

    const r = await PUT(richiesta({ gdprTemplateId: GDPR_ID }), contesto as never);

    expect(r.status).toBe(422);
    expect(mocked.event.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/events/[param] — i file dell’evento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.event.delete.mockResolvedValue({});
    files.removeFilesOfEventsBeingDeleted.mockResolvedValue(1);
  });

  function cancella(): NextRequest {
    return new Request(`http://localhost/api/events/${EVENT_ID}`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer token-valido' },
    }) as unknown as NextRequest;
  }

  it('la cascata porta via le righe: i file si cancellano prima', async () => {
    const r = await DELETE(cancella(), contesto as never);

    expect(r.status).toBe(200);
    expect(files.removeFilesOfEventsBeingDeleted).toHaveBeenCalledWith({ id: EVENT_ID });
    expect(mocked.event.delete).toHaveBeenCalledWith({ where: { id: EVENT_ID } });
    expect(files.removeFilesOfEventsBeingDeleted.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.event.delete.mock.invocationCallOrder[0]!,
    );
  });

  it('se i file non si cancellano, l’evento resta: 503', async () => {
    files.removeFilesOfEventsBeingDeleted.mockRejectedValue(
      new AppError('storage', 503, 'STORAGE_DELETE_FAILED'),
    );
    const r = await DELETE(cancella(), contesto as never);

    expect(r.status).toBe(503);
    expect(mocked.event.delete).not.toHaveBeenCalled();
  });
});
