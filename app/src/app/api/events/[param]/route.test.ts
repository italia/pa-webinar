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

const staff = vi.hoisted(() => ({ requireEventManager: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/staff-session', () => staff);
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

const { sessioni } = vi.hoisted(() => ({
  sessioni: { closeOpenSessions: vi.fn(async () => 0) },
}));
vi.mock('@/lib/events/call-sessions', () => sessioni);

vi.mock('@/lib/live/actions', () => ({ recordLiveAction: vi.fn(), recordLiveActions: vi.fn() }));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn(), update: vi.fn() },
    gdprTemplate: { findUnique: vi.fn() },
    tag: { findMany: vi.fn() },
    eventTagLink: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    registration: { count: vi.fn(async () => 0) },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/db';
import { AppError, UnauthorizedError } from '@/lib/errors';
import { recordLiveAction, recordLiveActions } from '@/lib/live/actions';

import { DELETE, PUT } from './route';

const EVENT_ID = '7c6d5e4f-3a2b-4c1d-8e9f-0a1b2c3d4e5f';
const GDPR_ID = '3f2a1b0c-4d5e-4f6a-8b9c-0d1e2f3a4b5c';

const mocked = prisma as unknown as {
  event: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  gdprTemplate: { findUnique: ReturnType<typeof vi.fn> };
  tag: { findMany: ReturnType<typeof vi.fn> };
  eventTagLink: {
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
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
    accessMode: null,
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
  'accessMode',
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

  it("l'avvio automatico della registrazione si puo' spegnere, non accendere", async () => {
    await PUT(richiesta({ autoStartRecording: true }), contesto as never);
    expect(datiScritti()).not.toHaveProperty('autoStartRecording');

    mocked.event.update.mockClear();
    await PUT(richiesta({ autoStartRecording: false }), contesto as never);
    expect(datiScritti().autoStartRecording).toBe(false);
  });

  it('risponde anche per un evento con una registrazione Jibri (dimensione BigInt)', async () => {
    mocked.event.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...eventoEsistente(),
        recordingFileSize: BigInt(4502766),
        ...data,
      }),
    );

    // Una modifica di fine evento, la piu' comune dopo una registrazione.
    const res = await PUT(richiesta({ postEventShowQA: false }), contesto as never);

    expect(res.status).toBe(200);
    expect((await res.json()).recordingFileSize).toBe(4502766);
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

  it('chi partecipa lo cambia solo lo staff dell evento, non un link di conduzione', async () => {
    staff.requireEventManager.mockRejectedValueOnce(new UnauthorizedError());
    const res = await PUT(richiesta({ accessMode: 'OPEN' }), contesto as never);
    expect(res.status).toBe(403);
    expect(mocked.event.update).not.toHaveBeenCalled();

    // Un guasto della banca dati non diventa «solo lo staff»: resta un errore.
    staff.requireEventManager.mockRejectedValueOnce(new Error('db down'));
    const guasto = await PUT(richiesta({ accessMode: 'OPEN' }), contesto as never);
    expect(guasto.status).toBe(500);

    staff.requireEventManager.mockResolvedValueOnce({ role: 'organizer' });
    await PUT(richiesta({ accessMode: 'INVITATION' }), contesto as never);
    expect(datiScritti().accessMode).toBe('INVITATION');
  });

  it('rimandare la scelta che c e gia non chiede lo staff', async () => {
    await PUT(richiesta({ accessMode: null, requireOrganization: false }), contesto as never);
    expect(staff.requireEventManager).not.toHaveBeenCalled();
    expect(datiScritti().requireOrganization).toBe(false);
  });

  it('svuota il testo dell\'informativa quando arriva una stringa vuota', async () => {
    // È il percorso che usa il wizard quando si sceglie un modello: il testo
    // scritto a mano va svuotato, altrimenti continuerebbe a vincere su una
    // scelta già fatta. Si salva come assente (null), così all'iscrizione si
    // legge il modello.
    await PUT(richiesta({ privacyPolicyText: '' }), contesto as never);

    const dati = datiScritti();
    expect(dati).toHaveProperty('privacyPolicyText');
    expect(dati.privacyPolicyText).toBeNull();
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

/**
 * «Termina per tutti» e «Termina evento» sono il modo normale di chiudere un
 * evento: la sessione di chiamata aperta si chiude nella stessa transazione,
 * altrimenti resterebbe aperta per sempre e le statistiche riporterebbero la
 * finestra programmata al posto della durata vera.
 */
describe('PUT /api/events/[param] — cambio di stato e sessioni di chiamata', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocked.event.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ ...eventoEsistente(), ...data }),
    );
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  });

  async function conStato(attuale: string, corpo: Record<string, unknown>) {
    const { verifyModeratorToken } = await import('@/lib/auth/moderator');
    vi.mocked(verifyModeratorToken).mockResolvedValueOnce(
      eventoEsistente(attuale) as unknown as Awaited<ReturnType<typeof verifyModeratorToken>>,
    );
    return PUT(richiesta(corpo), contesto as never);
  }

  it.each([
    ['LIVE', 'ENDED'],
    ['LIVE', 'DRAFT'],
    ['IDLE', 'ENDED'],
    ['PROVISIONING', 'ENDED'],
    ['PUBLISHED', 'ENDED'],
  ])('da %s a %s chiude le sessioni nella stessa transazione', async (attuale, nuovo) => {
    const r = await conStato(attuale, { status: nuovo });

    expect(r.status).toBe(200);
    expect(mocked.$transaction).toHaveBeenCalledTimes(1);
    expect(sessioni.closeOpenSessions).toHaveBeenCalledWith(prisma, [EVENT_ID], expect.any(Date));
  });

  it.each([
    ['PUBLISHED', 'LIVE'],
    ['PROVISIONING', 'LIVE'],
    ['IDLE', 'LIVE'],
    // Un evento già concluso: le sue sessioni le ripara il giro del ciclo di
    // vita, con un orario stimato sulla chiusura, non «adesso».
    ['ENDED', 'LIVE'],
    ['LIVE', 'LIVE'],
  ])('da %s a %s non tocca le sessioni', async (attuale, nuovo) => {
    const r = await conStato(attuale, { status: nuovo });

    expect(r.status).toBe(200);
    expect(mocked.$transaction).not.toHaveBeenCalled();
    expect(sessioni.closeOpenSessions).not.toHaveBeenCalled();
    expect(mocked.event.update).toHaveBeenCalledTimes(1);
  });

  it('avviare da preparazione o pausa scrive LIVE', async () => {
    for (const attuale of ['PROVISIONING', 'IDLE']) {
      mocked.event.update.mockClear();
      await conStato(attuale, { status: 'LIVE' });
      expect(datiScritti().status).toBe('LIVE');
    }
  });
});

describe('PUT /api/events/[param] — tag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    staff.requireEventManager.mockResolvedValue(undefined);
    mocked.event.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ ...eventoEsistente(), ...data }),
    );
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    mocked.eventTagLink.findMany.mockResolvedValue([{ tagId: 'tag-a' }]);
  });

  it("l'elenco cambiato sostituisce le etichette, insieme all'evento", async () => {
    mocked.tag.findMany.mockResolvedValue([
      { id: 'tag-a', slug: 'a' },
      { id: 'tag-b', slug: 'b' },
    ]);

    const r = await PUT(richiesta({ tagSlugs: ['a', 'b', 'sparito'] }), contesto as never);

    expect(r.status).toBe(200);
    expect(staff.requireEventManager).toHaveBeenCalledWith(expect.anything(), EVENT_ID);
    expect(mocked.$transaction).toHaveBeenCalledTimes(1);
    expect(mocked.tag.findMany).toHaveBeenCalledWith({
      where: { slug: { in: ['a', 'b', 'sparito'] } },
      select: { id: true, slug: true },
    });
    // Nel registro le etichette scritte davvero, non quelle chieste.
    const { logAdminAction } = await import('@/lib/audit/admin-audit');
    expect(vi.mocked(logAdminAction)).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ tags: ['a', 'b'] }) }),
    );
    expect(mocked.eventTagLink.deleteMany).toHaveBeenCalledWith({ where: { eventId: EVENT_ID } });
    expect(mocked.eventTagLink.createMany).toHaveBeenCalledWith({
      data: [
        { eventId: EVENT_ID, tagId: 'tag-a' },
        { eventId: EVENT_ID, tagId: 'tag-b' },
      ],
      skipDuplicates: true,
    });
  });

  it('un elenco vuoto toglie tutte le etichette', async () => {
    await PUT(richiesta({ tagSlugs: [] }), contesto as never);

    expect(mocked.tag.findMany).not.toHaveBeenCalled();
    expect(mocked.eventTagLink.deleteMany).toHaveBeenCalledWith({ where: { eventId: EVENT_ID } });
    expect(mocked.eventTagLink.createMany).not.toHaveBeenCalled();
  });

  it('le stesse etichette, in un altro ordine, non si riscrivono', async () => {
    mocked.eventTagLink.findMany.mockResolvedValue([{ tagId: 'tag-b' }, { tagId: 'tag-a' }]);
    mocked.tag.findMany.mockResolvedValue([{ id: 'tag-a' }, { id: 'tag-b' }]);

    const r = await PUT(richiesta({ tagSlugs: ['a', 'b'] }), contesto as never);

    expect(r.status).toBe(200);
    expect(staff.requireEventManager).not.toHaveBeenCalled();
    expect(mocked.$transaction).not.toHaveBeenCalled();
    expect(mocked.eventTagLink.deleteMany).not.toHaveBeenCalled();
  });

  it('con il solo link di conduzione non si cambiano', async () => {
    staff.requireEventManager.mockRejectedValue(new UnauthorizedError());
    mocked.tag.findMany.mockResolvedValue([{ id: 'tag-b' }]);

    const r = await PUT(richiesta({ tagSlugs: ['b'] }), contesto as never);

    expect(r.status).toBe(403);
    expect(mocked.event.update).not.toHaveBeenCalled();
    expect(mocked.eventTagLink.deleteMany).not.toHaveBeenCalled();
  });

  it('una modifica parziale non tocca le etichette', async () => {
    await PUT(richiesta({ postEventShowQA: false }), contesto as never);

    expect(mocked.eventTagLink.findMany).not.toHaveBeenCalled();
    expect(mocked.$transaction).not.toHaveBeenCalled();
    expect(mocked.event.update).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /api/events/[param] — cronologia della sala', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.event.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ ...eventoEsistente(), ...data }),
    );
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  });

  async function conEvento(attuale: Record<string, unknown>, corpo: Record<string, unknown>) {
    const { verifyModeratorToken } = await import('@/lib/auth/moderator');
    vi.mocked(verifyModeratorToken).mockResolvedValueOnce(
      attuale as unknown as Awaited<ReturnType<typeof verifyModeratorToken>>,
    );
    mocked.event.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ ...attuale, ...data }),
    );
    return PUT(richiesta(corpo), contesto as never);
  }

  it('una funzione accesa dalla sala registra quale e come', async () => {
    const r = await conEvento(
      { ...eventoEsistente('LIVE'), qaEnabled: false, wordCloudEnabled: true },
      { qaEnabled: true, wordCloudEnabled: true },
    );
    expect(r.status).toBe(200);
    // Solo quella cambiata davvero: la seconda era gia' accesa.
    expect(recordLiveActions).toHaveBeenCalledWith([
      {
        eventId: EVENT_ID,
        kind: 'feature.toggled',
        actor: 'moderator',
        data: { feature: 'qaEnabled', enabled: true },
      },
    ]);
    expect(recordLiveAction).not.toHaveBeenCalled();
  });

  it('«Termina evento» registra la fine', async () => {
    const r = await conEvento(eventoEsistente('LIVE'), { status: 'ENDED' });
    expect(r.status).toBe(200);
    expect(recordLiveAction).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      kind: 'event.ended',
      actor: 'moderator',
    });
    expect(recordLiveActions).toHaveBeenCalledWith([]);
  });

  it('un evento gia’ concluso non finisce una seconda volta', async () => {
    await conEvento(eventoEsistente('ENDED'), { status: 'ENDED' });
    expect(recordLiveAction).not.toHaveBeenCalled();
  });

  it('una modifica rifiutata non registra niente', async () => {
    const { verifyModeratorToken } = await import('@/lib/auth/moderator');
    vi.mocked(verifyModeratorToken).mockResolvedValueOnce(null);
    const r = await PUT(richiesta({ status: 'ENDED', qaEnabled: true }), contesto as never);
    expect(r.status).toBe(403);
    expect(recordLiveAction).not.toHaveBeenCalled();
    expect(recordLiveActions).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/events/[param] — i file dell’evento', () => {
  // La transazione con la riga bloccata: lo stato letto li' decide tutto.
  const tx = {
    $queryRaw: vi.fn(),
    event: { delete: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ status: 'PUBLISHED' }]);
    tx.event.delete.mockResolvedValue({});
    mocked.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    files.removeFilesOfEventsBeingDeleted.mockResolvedValue(1);
  });

  function cancella(): NextRequest {
    return new Request(`http://localhost/api/events/${EVENT_ID}`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer token-valido' },
    }) as unknown as NextRequest;
  }

  it('la cascata porta via le righe: i file si cancellano prima, a riga bloccata', async () => {
    const r = await DELETE(cancella(), contesto as never);

    expect(r.status).toBe(200);
    expect(String(tx.$queryRaw.mock.calls[0]![0])).toContain('FOR NO KEY UPDATE');
    expect(files.removeFilesOfEventsBeingDeleted).toHaveBeenCalledWith({ id: EVENT_ID });
    expect(tx.event.delete).toHaveBeenCalledWith({ where: { id: EVENT_ID } });
    expect(files.removeFilesOfEventsBeingDeleted.mock.invocationCallOrder[0]).toBeLessThan(
      tx.event.delete.mock.invocationCallOrder[0]!,
    );
  });

  it('un evento in diretta non si elimina: 409, nessun file toccato', async () => {
    tx.$queryRaw.mockResolvedValue([{ status: 'LIVE' }]);
    const r = await DELETE(cancella(), contesto as never);

    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('EVENT_LIVE');
    expect(files.removeFilesOfEventsBeingDeleted).not.toHaveBeenCalled();
    expect(tx.event.delete).not.toHaveBeenCalled();
  });

  it('già eliminato da un’altra richiesta: 404, non «in diretta»', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    const r = await DELETE(cancella(), contesto as never);

    expect(r.status).toBe(404);
    expect(files.removeFilesOfEventsBeingDeleted).not.toHaveBeenCalled();
  });

  it('se i file non si cancellano, l’evento resta: 503', async () => {
    files.removeFilesOfEventsBeingDeleted.mockRejectedValue(
      new AppError('storage', 503, 'STORAGE_DELETE_FAILED'),
    );
    const r = await DELETE(cancella(), contesto as never);

    expect(r.status).toBe(503);
    expect(tx.event.delete).not.toHaveBeenCalled();
  });
});
