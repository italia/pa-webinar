// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Chi dello staff vede il contenuto delle registrazioni: chi organizza
 * l'evento, con qualunque ruolo; l'admin che non lo organizza no; la chiave
 * dell'istanza mai. Le deroghe si valutano solo dopo, e mai per la chiave.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as StaffSessionModule from '@/lib/auth/staff-session';
import type { StaffSession } from '@/lib/auth/staff-session';

const { prisma, sessione } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn() },
    event: { count: vi.fn(), findMany: vi.fn() },
    recording: { findUnique: vi.fn() },
    speaker: { findUnique: vi.fn() },
    gdprAuditLog: { findFirst: vi.fn(), create: vi.fn() },
  },
  sessione: { valore: null as StaffSession | null },
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/auth/staff-session', async (importOriginal) => {
  const vero = await importOriginal<typeof StaffSessionModule>();
  const { UnauthorizedError } = await import('@/lib/errors');
  return {
    ...vero,
    getStaffSession: vi.fn(async () => sessione.valore),
    requireStaff: vi.fn(async () => {
      if (!sessione.valore) throw new UnauthorizedError();
      return sessione.valore;
    }),
  };
});

import {
  accessoContenutoStaff,
  contenutoStaffDellaRichiesta,
  eventiOrganizzati,
  organizzaEvento,
  requireEventContent,
  requireRecordingContent,
  requireSpeakerContent,
  tracciaLetturaContenuto,
  type DerogaContenuto,
} from './content-access';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const EVENTO = '22222222-2222-4222-8222-222222222222';
const REGISTRAZIONE = '33333333-3333-4333-8333-333333333333';
const RELATORE = '44444444-4444-4444-8444-444444444444';

const CHIAVE: StaffSession = { role: 'admin', accountId: null };
const ADMIN: StaffSession = { role: 'admin', accountId: ACCOUNT };
const ORGANIZZATORE: StaffSession = {
  role: 'organizer',
  accountId: ACCOUNT,
  emailHash: 'impronta',
};

const biscotti = {} as Parameters<typeof requireRecordingContent>[0];
const richiesta = {
  eventId: EVENTO,
  recordingId: REGISTRAZIONE,
  superficie: 'video' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  sessione.valore = ADMIN;
  prisma.staffAccount.findUnique.mockResolvedValue({
    emailHash: 'impronta-admin',
    active: true,
  });
  prisma.event.count.mockResolvedValue(0);
  prisma.event.findMany.mockResolvedValue([]);
  prisma.recording.findUnique.mockResolvedValue({ eventId: EVENTO });
  prisma.speaker.findUnique.mockResolvedValue({
    recordingId: REGISTRAZIONE,
    recording: { eventId: EVENTO },
  });
  prisma.gdprAuditLog.findFirst.mockResolvedValue(null);
});

describe('organizzaEvento', () => {
  it('la chiave dell’istanza non organizza niente, e non si chiede al database', async () => {
    expect(await organizzaEvento(CHIAVE, EVENTO)).toBe(false);
    expect(prisma.event.count).not.toHaveBeenCalled();
  });

  it('l’admin organizza gli eventi che ha creato o di cui ha una concessione, con la sua impronta', async () => {
    prisma.event.count.mockResolvedValue(1);
    expect(await organizzaEvento(ADMIN, EVENTO)).toBe(true);
    expect(prisma.event.count.mock.calls[0]![0].where).toEqual({
      id: EVENTO,
      AND: [
        {
          OR: [
            { createdById: ACCOUNT },
            {
              additionalMods: {
                some: { organizer: true, revokedAt: null, emailHash: 'impronta-admin' },
              },
            },
          ],
        },
      ],
    });
  });

  it('l’admin che non lo organizza: no, anche se gestisce tutta l’istanza', async () => {
    expect(await organizzaEvento(ADMIN, EVENTO)).toBe(false);
  });

  it('un account disattivato non organizza piu’ niente', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      emailHash: 'impronta-admin',
      active: false,
    });
    expect(await organizzaEvento(ADMIN, EVENTO)).toBe(false);
    expect(prisma.event.count).not.toHaveBeenCalled();
  });

  it('l’organizzatore usa l’impronta della sessione', async () => {
    prisma.event.count.mockResolvedValue(1);
    expect(await organizzaEvento(ORGANIZZATORE, EVENTO)).toBe(true);
    expect(prisma.staffAccount.findUnique).not.toHaveBeenCalled();
  });
});

describe('eventiOrganizzati', () => {
  it('una lettura sola per tutto l’elenco, senza doppioni', async () => {
    prisma.event.findMany.mockResolvedValue([{ id: 'a' }]);
    expect(await eventiOrganizzati(ADMIN, ['a', 'b', 'a'])).toEqual(new Set(['a']));
    expect(prisma.event.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.event.findMany.mock.calls[0]![0].where.id).toEqual({ in: ['a', 'b'] });
  });

  it('la chiave dell’istanza: nessuno', async () => {
    expect(await eventiOrganizzati(CHIAVE, ['a'])).toEqual(new Set());
    expect(prisma.event.findMany).not.toHaveBeenCalled();
  });
});

describe('accessoContenutoStaff e le deroghe', () => {
  it('chi organizza passa senza chiedere alle deroghe', async () => {
    prisma.event.count.mockResolvedValue(1);
    const deroga = vi.fn<DerogaContenuto>(async () => true);
    expect(await accessoContenutoStaff(ADMIN, richiesta, [deroga])).toBe('organizzatore');
    expect(deroga).not.toHaveBeenCalled();
  });

  it('una deroga apre il contenuto a chi non organizza, e riceve cosa si chiede', async () => {
    const deroga = vi.fn<DerogaContenuto>(async () => true);
    expect(await accessoContenutoStaff(ADMIN, richiesta, [deroga])).toBe('deroga');
    expect(deroga).toHaveBeenCalledWith({
      accountId: ACCOUNT,
      ruolo: 'admin',
      eventId: EVENTO,
      recordingId: REGISTRAZIONE,
      superficie: 'video',
    });
  });

  it('una deroga che lancia vale come «no»', async () => {
    const errore = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rotta: DerogaContenuto = async () => {
      throw new Error('guasto');
    };
    expect(await accessoContenutoStaff(ADMIN, richiesta, [rotta])).toBeNull();
    errore.mockRestore();
  });

  it('la chiave dell’istanza non ha deroghe', async () => {
    const deroga = vi.fn<DerogaContenuto>(async () => true);
    expect(await accessoContenutoStaff(CHIAVE, richiesta, [deroga])).toBeNull();
    expect(deroga).not.toHaveBeenCalled();
  });

  it('senza deroghe in vigore il contenuto e’ solo di chi organizza', async () => {
    expect(await accessoContenutoStaff(ADMIN, richiesta)).toBeNull();
  });
});

describe('requireRecordingContent', () => {
  it('senza sessione e’ 401', async () => {
    sessione.valore = null;
    await expect(
      requireRecordingContent(biscotti, REGISTRAZIONE, 'video')
    ).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('l’admin che non organizza e la chiave dell’istanza: 403 con il codice che l’interfaccia spiega', async () => {
    for (const s of [ADMIN, CHIAVE]) {
      sessione.valore = s;
      await expect(
        requireRecordingContent(biscotti, REGISTRAZIONE, 'video')
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'RECORDING_CONTENT_ORGANIZER_ONLY',
      });
    }
  });

  it('l’organizzatore di un altro evento: il 403 di sempre, senza dire che c’e’ un contenuto', async () => {
    sessione.valore = ORGANIZZATORE;
    await expect(
      requireRecordingContent(biscotti, REGISTRAZIONE, 'video')
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  it('chi organizza passa, con l’evento della registrazione', async () => {
    prisma.event.count.mockResolvedValue(1);
    await expect(
      requireRecordingContent(biscotti, REGISTRAZIONE, 'video')
    ).resolves.toEqual({
      session: ADMIN,
      eventId: EVENTO,
      via: 'organizzatore',
    });
  });

  it('una registrazione che non c’e’: 404 all’admin, 403 all’organizzatore', async () => {
    prisma.recording.findUnique.mockResolvedValue(null);
    await expect(
      requireRecordingContent(biscotti, REGISTRAZIONE, 'video')
    ).rejects.toMatchObject({
      statusCode: 404,
    });
    sessione.valore = ORGANIZZATORE;
    await expect(
      requireRecordingContent(biscotti, REGISTRAZIONE, 'video')
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('un identificativo malformato, senza leggere: come una registrazione che non c’e’', async () => {
    await expect(requireRecordingContent(biscotti, 'x', 'video')).rejects.toMatchObject({
      statusCode: 404,
    });
    sessione.valore = ORGANIZZATORE;
    await expect(requireRecordingContent(biscotti, 'x', 'video')).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(prisma.recording.findUnique).not.toHaveBeenCalled();
  });
});

describe('requireSpeakerContent e requireEventContent', () => {
  it('il relatore porta alla sua registrazione', async () => {
    prisma.event.count.mockResolvedValue(1);
    await expect(
      requireSpeakerContent(biscotti, RELATORE, 'relatori')
    ).resolves.toMatchObject({
      eventId: EVENTO,
      recordingId: REGISTRAZIONE,
    });
    prisma.event.count.mockResolvedValue(0);
    await expect(
      requireSpeakerContent(biscotti, RELATORE, 'relatori')
    ).rejects.toMatchObject({
      code: 'RECORDING_CONTENT_ORGANIZER_ONLY',
    });
  });

  it('l’evento intero: un identificativo malformato e’ 400 per tutti', async () => {
    await expect(requireEventContent(biscotti, 'x', 'resoconto')).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      requireEventContent(biscotti, EVENTO, 'resoconto')
    ).rejects.toMatchObject({
      code: 'RECORDING_CONTENT_ORGANIZER_ONLY',
    });
  });
});

describe('contenutoStaffDellaRichiesta', () => {
  it('null senza sessione e per chi non organizza', async () => {
    sessione.valore = null;
    expect(await contenutoStaffDellaRichiesta(biscotti, EVENTO)).toBeNull();
    sessione.valore = CHIAVE;
    expect(await contenutoStaffDellaRichiesta(biscotti, EVENTO)).toBeNull();
    sessione.valore = ADMIN;
    expect(await contenutoStaffDellaRichiesta(biscotti, EVENTO)).toBeNull();
  });

  it('chi organizza, con la via', async () => {
    prisma.event.count.mockResolvedValue(1);
    expect(await contenutoStaffDellaRichiesta(biscotti, EVENTO)).toEqual({
      session: ADMIN,
      via: 'organizzatore',
    });
  });
});

describe('tracciaLetturaContenuto', () => {
  const lettura = {
    eventId: EVENTO,
    recordingId: REGISTRAZIONE,
    superficie: 'trascrizione' as const,
    session: ADMIN,
    via: 'organizzatore' as const,
  };

  it('una riga nel registro GDPR dell’evento: superficie, registrazione, via, ruolo e account, niente altro', async () => {
    await tracciaLetturaContenuto(lettura);
    const { data } = prisma.gdprAuditLog.create.mock.calls[0]![0] as {
      data: { eventId: string; action: string; recordCount: number; details: string };
    };
    expect(data).toMatchObject({
      eventId: EVENTO,
      action: 'RECORDING_CONTENT_READ',
      recordCount: 1,
    });
    expect(JSON.parse(data.details)).toEqual({
      surface: 'trascrizione',
      recordingId: REGISTRAZIONE,
      via: 'organizzatore',
      role: 'admin',
      account: ACCOUNT,
    });
  });

  it('la stessa lettura entro un quarto d’ora non si riscrive', async () => {
    prisma.gdprAuditLog.findFirst.mockResolvedValue({ id: 'gia-scritta' });
    await tracciaLetturaContenuto(lettura);
    expect(prisma.gdprAuditLog.create).not.toHaveBeenCalled();
    const { where } = prisma.gdprAuditLog.findFirst.mock.calls[0]![0] as {
      where: { createdAt: { gte: Date } };
    };
    expect(Date.now() - where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(
      15 * 60_000 - 1000
    );
  });

  it('un errore di scrittura non ferma la lettura', async () => {
    const errore = vi.spyOn(console, 'error').mockImplementation(() => {});
    prisma.gdprAuditLog.create.mockRejectedValue(new Error('database giu’'));
    await expect(tracciaLetturaContenuto(lettura)).resolves.toBeUndefined();
    errore.mockRestore();
  });
});
