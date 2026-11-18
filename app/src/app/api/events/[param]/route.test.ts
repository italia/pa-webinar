// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/auth/moderator', () => ({
  extractModeratorToken: vi.fn(() => 'token-valido'),
  verifyModeratorToken: vi.fn(async () => eventoEsistente()),
  isEventModerator: vi.fn(async () => true),
  constantTimeEqual: vi.fn(() => true),
}));

const staff = vi.hoisted(() => ({
  requireEventManager: vi.fn(),
  isEventManager: vi.fn(async () => false),
}));
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
const storage = vi.hoisted(() => ({ getRecordingsStorage: vi.fn((): unknown => null) }));
vi.mock('@/lib/storage/index', () => ({
  getRecordingsStorage: storage.getRecordingsStorage,
  recordingsProviderLabel: () => 'not-configured',
}));
const sala = vi.hoisted(() => ({
  salaForseAperta: vi.fn(async () => false),
  salaGiaAperta: vi.fn(async () => false),
}));
vi.mock('@/lib/live/room-open', () => sala);
const sondaggi = vi.hoisted(() => ({ chiudiSondaggiAperti: vi.fn(async () => 0) }));
vi.mock('@/lib/events/close-polls', () => sondaggi);

vi.mock('@/lib/live/actions', () => ({
  recordLiveAction: vi.fn(),
  recordLiveActions: vi.fn(),
}));

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ defaultLocale: 'it', aiDefaultTargetLocales: 'en,fr' })),
}));
const traduzioni = vi.hoisted(() => ({
  riconciliaTraduzioni: vi.fn(async () => ({ avviata: false, lingue: [] as string[] })),
}));
vi.mock('@/lib/text-translation/auto', () => traduzioni);

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: vi.fn(async () => []),
    event: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(async () => []) },
    // Di chi e' un file dello storage (lib/storage/recordings): nessun altro evento.
    recording: { findMany: vi.fn(async () => []) },
    callSession: { findMany: vi.fn(async () => []) },
    gdprTemplate: { findUnique: vi.fn() },
    tag: { findMany: vi.fn() },
    eventTagLink: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    registration: { count: vi.fn(async () => 0) },
    eventPersonPhoto: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { constantTimeEqual, extractModeratorToken } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { AppError, ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { estimateNumbers } from '@/lib/estimates';
import { recordLiveAction, recordLiveActions } from '@/lib/live/actions';

import { DELETE, GET, PUT } from './route';

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
  eventPersonPhoto: { findFirst: ReturnType<typeof vi.fn> };
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
    participantListVisible: false,
    nicknamesEnabled: false,
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
  'participantListVisible',
  'nicknamesEnabled',
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
      })
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

  it("l'elenco dei partecipanti non cambia a sala aperta", async () => {
    sala.salaForseAperta.mockResolvedValueOnce(true);

    await PUT(richiesta({ participantListVisible: true, title: { it: 'Altro' } }), contesto as never);

    expect(datiScritti()).not.toHaveProperty('participantListVisible');
  });

  it('l\'opzione di chi conduce non si azzera con un aggiornamento che non la nomina', async () => {
    await PUT(richiesta({ title: { it: 'Altro' } }), contesto as never);
    expect(datiScritti()).not.toHaveProperty('hostsAlwaysRecorded');
  });

  it('l\'opzione di chi conduce non cambia a sala aperta', async () => {
    sala.salaForseAperta.mockResolvedValueOnce(true);

    await PUT(richiesta({ hostsAlwaysRecorded: true, title: { it: 'Altro' } }), contesto as never);

    expect(datiScritti()).not.toHaveProperty('hostsAlwaysRecorded');
  });


  it('i nickname non si accendono ne\' si spengono a sala aperta', async () => {
    sala.salaForseAperta.mockResolvedValueOnce(true);

    await PUT(richiesta({ nicknamesEnabled: true, title: { it: 'Altro' } }), contesto as never);

    expect(datiScritti()).not.toHaveProperty('nicknamesEnabled');
  });

  it('i nickname si scelgono a sala chiusa', async () => {
    await PUT(richiesta({ nicknamesEnabled: true }), contesto as never);

    expect(datiScritti()).toMatchObject({ nicknamesEnabled: true });
  });

  it("l'elenco dei partecipanti si sceglie a sala chiusa", async () => {
    await PUT(richiesta({ participantListVisible: true }), contesto as never);

    expect(datiScritti()).toMatchObject({ participantListVisible: true });
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
      })
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
      contesto as never
    );

    const dati = datiScritti();
    expect(dati.requireOrganization).toBe(false);
    expect(dati.requireOrganizationRole).toBe(false);
    expect(dati.requireOrganizationType).toBe(false);
    expect(dati.gdprTemplateId).toBe(GDPR_ID);
  });

  it('la foto dell’organizzatore principale: messa, tolta, lasciata cadere; assente non si tocca', async () => {
    const FOTO = '5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    mocked.eventPersonPhoto.findFirst.mockResolvedValueOnce({ id: FOTO });
    await PUT(richiesta({ moderatorPhotoId: FOTO }), contesto as never);
    expect(datiScritti().moderatorPhotoId).toBe(FOTO);
    // Già di questo evento (anche se una sua copia la condivide): si tiene.
    expect(mocked.eventPersonPhoto.findFirst.mock.calls[0]![0].where.OR).toContainEqual({
      leadOf: { some: { id: EVENT_ID } },
    });

    mocked.event.update.mockClear();
    await PUT(richiesta({ moderatorPhotoId: null }), contesto as never);
    expect(datiScritti().moderatorPhotoId).toBeNull();

    mocked.event.update.mockClear();
    mocked.eventPersonPhoto.findFirst.mockResolvedValueOnce(null);
    const res = await PUT(richiesta({ moderatorPhotoId: FOTO }), contesto as never);
    expect(res.status).toBe(200);
    expect(datiScritti().moderatorPhotoId).toBeNull();

    mocked.event.update.mockClear();
    await PUT(richiesta({ postEventShowQA: false }), contesto as never);
    expect(datiScritti()).not.toHaveProperty('moderatorPhotoId');
  });

  it('una foto che nessuno usa la aggancia solo lo staff dell’evento, non il solo link', async () => {
    const FOTO = '5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    const libera = { leadOf: { none: {} }, grants: { none: {} } };
    // Con il solo link di conduzione: solo le foto che l'evento usa già. Una
    // foto tolta da un altro evento non la usa nessuno, e non si prende.
    mocked.eventPersonPhoto.findFirst.mockResolvedValueOnce(null);
    await PUT(richiesta({ moderatorPhotoId: FOTO }), contesto as never);
    expect(staff.isEventManager).toHaveBeenCalledWith(expect.anything(), EVENT_ID);
    expect(mocked.eventPersonPhoto.findFirst.mock.calls[0]![0].where.OR).not.toContainEqual(
      libera
    );
    expect(datiScritti().moderatorPhotoId).toBeNull();

    // Lo staff che gestisce l'evento: anche la foto appena caricata.
    mocked.event.update.mockClear();
    staff.isEventManager.mockResolvedValueOnce(true);
    mocked.eventPersonPhoto.findFirst.mockResolvedValueOnce({ id: FOTO });
    await PUT(richiesta({ moderatorPhotoId: FOTO }), contesto as never);
    expect(mocked.eventPersonPhoto.findFirst.mock.calls[1]![0].where.OR).toContainEqual(libera);
    expect(datiScritti().moderatorPhotoId).toBe(FOTO);

    // Senza una foto da mettere la sessione non si legge.
    staff.isEventManager.mockClear();
    await PUT(richiesta({ moderatorPhotoId: null }), contesto as never);
    await PUT(richiesta({ postEventShowQA: false }), contesto as never);
    expect(staff.isEventManager).not.toHaveBeenCalled();
  });

  // 100 partecipanti con il video: la stima dipende dalla quota di webcam
  // accese (30% quella predefinita, 100% tutte).
  const conVideo = (quota: number | null) => ({
    ...eventoEsistente(),
    maxParticipants: 100,
    participantsCanStartVideo: true,
    expectedSenderRatioPct: quota,
  });
  const stimaPer = (quota: number | null) => {
    const e = conVideo(quota);
    return estimateNumbers({
      maxParticipants: e.maxParticipants,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      recordingEnabled: e.recordingEnabled,
      participantsCanUnmute: e.participantsCanUnmute,
      participantsCanStartVideo: true,
      participantsCanShareScreen: e.participantsCanShareScreen,
      expectedSenderRatioPct: quota,
    });
  };
  type StimaSalvata = { model: number; cores: number } | undefined;

  it('la quota di webcam rifa la stima della capacita, anche da sola', async () => {
    const { verifyModeratorToken } = await import('@/lib/auth/moderator');
    vi.mocked(verifyModeratorToken).mockResolvedValueOnce(conVideo(null) as never);
    await PUT(richiesta({ expectedSenderRatioPct: 100 }), contesto as never);
    const stima = datiScritti().capacityEstimateJson as StimaSalvata;
    expect(stima?.model).toBe(2);
    expect(stima?.cores).toBe(stimaPer(100).cores);
    expect(stima?.cores).not.toBe(stimaPer(null).cores);
  });

  it('una stima rifatta per altro tiene la quota gia salvata', async () => {
    const { verifyModeratorToken } = await import('@/lib/auth/moderator');
    vi.mocked(verifyModeratorToken).mockResolvedValueOnce(conVideo(100) as never);
    await PUT(richiesta({ maxParticipants: 100 }), contesto as never);
    const stima = datiScritti().capacityEstimateJson as StimaSalvata;
    expect(stima?.cores).toBe(stimaPer(100).cores);
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

  it('l opzione di chi conduce la cambia solo lo staff dell evento', async () => {
    staff.requireEventManager.mockRejectedValueOnce(new UnauthorizedError());
    const res = await PUT(richiesta({ hostsAlwaysRecorded: true }), contesto as never);
    expect(res.status).toBe(403);
    expect(mocked.event.update).not.toHaveBeenCalled();

    staff.requireEventManager.mockResolvedValueOnce({ role: 'organizer' });
    await PUT(richiesta({ hostsAlwaysRecorded: true }), contesto as never);
    expect(datiScritti().hostsAlwaysRecorded).toBe(true);
  });

  it('rimandare la scelta che c e gia non chiede lo staff', async () => {
    await PUT(
      richiesta({ accessMode: null, requireOrganization: false }),
      contesto as never
    );
    expect(staff.requireEventManager).not.toHaveBeenCalled();
    expect(datiScritti().requireOrganization).toBe(false);
  });

  it("svuota il testo dell'informativa quando arriva una stringa vuota", async () => {
    // È il percorso che usa il wizard quando si sceglie un modello: il testo
    // scritto a mano va svuotato, altrimenti continuerebbe a vincere su una
    // scelta già fatta. Si salva come assente (null), così all'iscrizione si
    // legge il modello.
    await PUT(richiesta({ privacyPolicyText: '' }), contesto as never);

    const dati = datiScritti();
    expect(dati).toHaveProperty('privacyPolicyText');
    expect(dati.privacyPolicyText).toBeNull();
  });

  it("rifiuta un testo dell'informativa nullo", async () => {
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
describe('PUT /api/events/[param] — la risposta non porta i campi del solo primario', () => {
  const rigaSalvata = () => ({
    ...eventoEsistente(),
    moderatorToken: 'token-del-primario',
    moderatorEmail: 'titolare@esempio.it',
    joinPasswordHash: 'hash-della-password',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.event.update.mockImplementation(async () => rigaSalvata());
  });

  // Il corpo vuoto basta a chiedere la riga; il flag e' cio' che manda la sala.
  it.each([
    ['un corpo vuoto', {}],
    ['un flag acceso dalla sala', { wordCloudEnabled: true }],
  ])('a un co-moderatore, con %s, torna il suo token', async (_nome, corpo) => {
    vi.mocked(extractModeratorToken).mockReturnValueOnce('token-della-concessione');
    vi.mocked(constantTimeEqual).mockReturnValueOnce(false);

    const res = await PUT(richiesta(corpo), contesto as never);

    expect(res.status).toBe(200);
    const risposta = await res.json();
    expect(risposta.moderatorToken).toBe('token-della-concessione');
    expect(risposta.moderatorEmail).toBeNull();
    expect(risposta).not.toHaveProperty('joinPasswordHash');
    const testo = JSON.stringify(risposta);
    expect(testo).not.toContain('token-del-primario');
    expect(testo).not.toContain('titolare@esempio.it');
    expect(testo).not.toContain('hash-della-password');
  });

  it('al primario tornano il suo token e il suo indirizzo, mai la password', async () => {
    vi.mocked(extractModeratorToken).mockReturnValueOnce('token-del-primario');

    const res = await PUT(richiesta({ wordCloudEnabled: true }), contesto as never);

    expect(res.status).toBe(200);
    const risposta = await res.json();
    expect(risposta.moderatorToken).toBe('token-del-primario');
    expect(risposta.moderatorEmail).toBe('titolare@esempio.it');
    expect(risposta).not.toHaveProperty('joinPasswordHash');
  });

  it('il resto della riga resta nella risposta', async () => {
    const res = await PUT(richiesta({ wordCloudEnabled: true }), contesto as never);

    const risposta = await res.json();
    expect(risposta).toMatchObject({ id: EVENT_ID, slug: 'evento-esistente', dateChanged: false });
  });
});

describe('PUT /api/events/[param] — cambio di stato e sessioni di chiamata', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocked.event.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...eventoEsistente(),
        ...data,
      })
    );
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(prisma)
    );
  });

  async function conStato(attuale: string, corpo: Record<string, unknown>) {
    const { verifyModeratorToken } = await import('@/lib/auth/moderator');
    vi.mocked(verifyModeratorToken).mockResolvedValueOnce(
      eventoEsistente(attuale) as unknown as Awaited<
        ReturnType<typeof verifyModeratorToken>
      >
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
    expect(sessioni.closeOpenSessions).toHaveBeenCalledWith(
      prisma,
      [EVENT_ID],
      expect.any(Date)
    );
    // Solo verso una fine i sondaggi aperti si chiudono (DRAFT non e' una fine).
    if (nuovo === 'ENDED') {
      expect(sondaggi.chiudiSondaggiAperti).toHaveBeenCalledWith(
        prisma,
        [EVENT_ID],
        expect.any(Date)
      );
    } else {
      expect(sondaggi.chiudiSondaggiAperti).not.toHaveBeenCalled();
    }
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
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...eventoEsistente(),
        ...data,
      })
    );
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(prisma)
    );
    mocked.eventTagLink.findMany.mockResolvedValue([{ tagId: 'tag-a' }]);
  });

  it("l'elenco cambiato sostituisce le etichette, insieme all'evento", async () => {
    mocked.tag.findMany.mockResolvedValue([
      { id: 'tag-a', slug: 'a' },
      { id: 'tag-b', slug: 'b' },
    ]);

    const r = await PUT(
      richiesta({ tagSlugs: ['a', 'b', 'sparito'] }),
      contesto as never
    );

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
      expect.objectContaining({ details: expect.objectContaining({ tags: ['a', 'b'] }) })
    );
    expect(mocked.eventTagLink.deleteMany).toHaveBeenCalledWith({
      where: { eventId: EVENT_ID },
    });
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
    expect(mocked.eventTagLink.deleteMany).toHaveBeenCalledWith({
      where: { eventId: EVENT_ID },
    });
    expect(mocked.eventTagLink.createMany).not.toHaveBeenCalled();
  });

  it('le stesse etichette, in un altro ordine, non si riscrivono', async () => {
    mocked.eventTagLink.findMany.mockResolvedValue([
      { tagId: 'tag-b' },
      { tagId: 'tag-a' },
    ]);
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
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...eventoEsistente(),
        ...data,
      })
    );
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(prisma)
    );
  });

  async function conEvento(
    attuale: Record<string, unknown>,
    corpo: Record<string, unknown>
  ) {
    const { verifyModeratorToken } = await import('@/lib/auth/moderator');
    vi.mocked(verifyModeratorToken).mockResolvedValueOnce(
      attuale as unknown as Awaited<ReturnType<typeof verifyModeratorToken>>
    );
    mocked.event.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ ...attuale, ...data })
    );
    return PUT(richiesta(corpo), contesto as never);
  }

  it('una funzione accesa dalla sala registra quale e come', async () => {
    const r = await conEvento(
      { ...eventoEsistente('LIVE'), qaEnabled: false, wordCloudEnabled: true },
      { qaEnabled: true, wordCloudEnabled: true }
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
    const r = await PUT(
      richiesta({ status: 'ENDED', qaEnabled: true }),
      contesto as never
    );
    expect(r.status).toBe(403);
    expect(recordLiveAction).not.toHaveBeenCalled();
    expect(recordLiveActions).not.toHaveBeenCalled();
  });
});

/**
 * Titolo e descrizione nelle altre lingue: con `textEdits` (il wizard) le
 * lingue non toccate tengono il testo salvato, riletto a riga bloccata nella
 * transazione della scrittura; senza, il testo inviato vale per tutte, come
 * sempre. Dopo un salvataggio del testo o delle lingue il server chiede la
 * traduzione automatica.
 */
describe('PUT /api/events/[param] — lingue di titolo e descrizione', () => {
  const VECCHIA = 'v'.repeat(64);
  const salvato = {
    title: { it: 'Titolo', en: 'Arrived title', fr: 'Titre' },
    description: { it: 'Descrizione', en: 'Arrived text', fr: 'Texte' },
    textLocaleState: {
      en: { origin: 'MACHINE', sourceHash: VECCHIA, at: '2026-10-20T10:00:00.000Z' },
      fr: { origin: 'HUMAN', sourceHash: VECCHIA, at: '2026-10-20T09:00:00.000Z' },
    },
    aiTargetLocales: 'en,fr',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.event.findUnique.mockResolvedValue(salvato);
    mocked.event.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...eventoEsistente(),
      ...data,
    }));
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    traduzioni.riconciliaTraduzioni.mockResolvedValue({ avviata: true, lingue: ['en'] });
  });

  it('le lingue non toccate tengono il testo salvato; quella toccata diventa di una persona', async () => {
    const r = await PUT(
      richiesta({
        // Il modulo aveva l'inglese vuoto: la traduzione e' arrivata dopo.
        title: { it: 'Titolo', en: '', fr: 'Mon titre' },
        description: { it: 'Descrizione', en: '', fr: 'Mon texte' },
        aiTargetLocales: 'en,fr',
        textEdits: { touched: ['fr'] },
      }),
      contesto as never
    );
    expect(r.status).toBe(200);
    // Riletto a riga bloccata, nella transazione della scrittura.
    expect(mocked.$transaction).toHaveBeenCalledTimes(1);
    expect((prisma as unknown as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw).toHaveBeenCalled();
    const dati = datiScritti();
    expect(dati.title).toEqual({ it: 'Titolo', en: 'Arrived title', fr: 'Mon titre' });
    expect(dati.description).toEqual({ it: 'Descrizione', en: 'Arrived text', fr: 'Mon texte' });
    const stato = dati.textLocaleState as Record<string, { origin: string; sourceHash: string }>;
    expect(stato.en).toEqual(salvato.textLocaleState.en);
    expect(stato.fr!.origin).toBe('HUMAN');
    expect(stato.fr!.sourceHash).not.toBe(VECCHIA);
    // La traduzione la decide il server, dopo il salvataggio.
    expect(traduzioni.riconciliaTraduzioni).toHaveBeenCalledWith(EVENT_ID, expect.anything());
    expect((await r.json()).traduzione).toEqual({ avviata: true, lingue: ['en'] });
  });

  it('una lingua tolta dalle lingue dell evento, e toccata, perde testo e stato', async () => {
    await PUT(
      richiesta({
        title: { ...salvato.title, fr: '' },
        description: { ...salvato.description, fr: '' },
        aiTargetLocales: 'en',
        textEdits: { touched: ['fr'] },
      }),
      contesto as never
    );
    const dati = datiScritti();
    expect(dati.title).toEqual({ it: 'Titolo', en: 'Arrived title' });
    expect(dati.textLocaleState).not.toHaveProperty('fr');
  });

  it('un evento che non aveva scelto lingue aveva quelle del sito: toglierne una ne toglie il testo', async () => {
    mocked.event.findUnique.mockResolvedValue({ ...salvato, aiTargetLocales: null });
    await PUT(
      richiesta({
        title: salvato.title,
        description: salvato.description,
        aiTargetLocales: 'en',
        textEdits: { touched: ['fr'] },
      }),
      contesto as never
    );
    expect(datiScritti().title).toEqual({ it: 'Titolo', en: 'Arrived title' });
  });

  it('cambiare solo l elenco delle lingue non cancella testi: le lingue uscite e non toccate li tengono', async () => {
    // Una bozza di prima ripresa: l'evento seguiva le lingue del sito, il
    // modulo manda nessuna lingua e non tocca niente.
    mocked.event.findUnique.mockResolvedValue({ ...salvato, aiTargetLocales: null });
    await PUT(
      richiesta({
        title: salvato.title,
        description: salvato.description,
        aiTargetLocales: '',
        textEdits: { touched: [] },
      }),
      contesto as never
    );
    const dati = datiScritti();
    expect(dati.title).toEqual(salvato.title);
    expect(dati.description).toEqual(salvato.description);
    expect(dati.textLocaleState).toEqual(salvato.textLocaleState);
  });

  it('senza textEdits il testo inviato vale per tutte le lingue, come sempre', async () => {
    const { verifyModeratorToken } = await import('@/lib/auth/moderator');
    vi.mocked(verifyModeratorToken).mockResolvedValueOnce({
      ...eventoEsistente(),
      ...salvato,
    } as never);
    await PUT(
      richiesta({
        title: { it: 'Titolo', en: 'API title' },
        description: { it: 'Descrizione', en: 'Arrived text' },
      }),
      contesto as never
    );
    // Nessuna transazione: si scrive come prima.
    expect(mocked.$transaction).not.toHaveBeenCalled();
    const dati = datiScritti();
    expect(dati.title).toEqual({ it: 'Titolo', en: 'API title' });
    const stato = dati.textLocaleState as Record<string, { origin: string }>;
    expect(stato.en!.origin).toBe('HUMAN');
    expect(stato).not.toHaveProperty('fr');
  });

  it('una modifica che non tocca testo ne lingue non chiede traduzioni e non scrive testi', async () => {
    const r = await PUT(richiesta({ status: 'LIVE' }), contesto as never);
    expect(traduzioni.riconciliaTraduzioni).not.toHaveBeenCalled();
    const dati = datiScritti();
    expect(dati).not.toHaveProperty('title');
    expect(dati).not.toHaveProperty('textLocaleState');
    expect(await r.json()).not.toHaveProperty('traduzione');
  });

  it('cambiare solo le lingue dell evento chiede la traduzione', async () => {
    await PUT(richiesta({ aiTargetLocales: 'en,fr,de' }), contesto as never);
    expect(traduzioni.riconciliaTraduzioni).toHaveBeenCalledTimes(1);
    expect(datiScritti()).not.toHaveProperty('title');
  });

  it('textEdits accetta solo codici di lingua, al massimo 24', async () => {
    for (const touched of [['EN'], ['en-'], Array.from({ length: 25 }, () => 'en')]) {
      const r = await PUT(richiesta({ title: salvato.title, textEdits: { touched } }), contesto as never);
      expect(r.status).toBe(422);
    }
  });
});

describe('PUT /api/events/[param] — la destinazione della registrazione', () => {
  const NON_COPERTA = 'RECORDING_DESTINATION_NOT_COVERED';
  const VIDEO_ESTERNO = 'https://www.youtube.com/watch?v=abc';
  const FILE = 'https://storage.example.com/recordings/sala.mp4';

  /** Un evento riservato: la destinazione e il pubblico che ne segue. */
  function riservato(over: Record<string, unknown> = {}) {
    return {
      ...eventoEsistente(),
      recordingEnabled: true,
      recordingDestination: 'REGISTRANTS',
      recordingAudience: 'REGISTRANTS',
      recordingPublished: false,
      transcriptPublished: false,
      youtubeUrl: null,
      tempRecordingUrl: null,
      ...over,
    };
  }

  async function modifica(evento: Record<string, unknown>, corpo: Record<string, unknown>) {
    const { verifyModeratorToken } = await import('@/lib/auth/moderator');
    vi.mocked(verifyModeratorToken).mockResolvedValueOnce(
      evento as unknown as Awaited<ReturnType<typeof verifyModeratorToken>>,
    );
    return PUT(richiesta(corpo), contesto as never);
  }

  async function rifiutata(r: Response) {
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: NON_COPERTA });
    expect(mocked.event.update).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    staff.requireEventManager.mockReset();
    sala.salaForseAperta.mockResolvedValue(false);
    sala.salaGiaAperta.mockResolvedValue(false);
    storage.getRecordingsStorage.mockReturnValue(null);
    mocked.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    mocked.event.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ ...riservato(), ...data }),
    );
  });

  describe('la guardia sull’esposizione', () => {
    it.each([
      ['il pubblico per tutti', { recordingAudience: 'PUBLIC' }],
      ['un video esterno', { youtubeUrl: VIDEO_ESTERNO }],
      ['il recupero in diretta', { tempRecordingUrl: FILE }],
    ])('un evento riservato rifiuta %s', async (_n, corpo) => {
      await rifiutata(await modifica(riservato(), corpo));
    });

    it('il rifiuto vale anche su un evento concluso con il video pubblicato', async () => {
      await rifiutata(
        await modifica(riservato({ status: 'ENDED', recordingPublished: true }), {
          recordingAudience: 'PUBLIC',
        }),
      );
    });

    it.each([
      ['la libreria', { libraryListed: true }],
      ['la pagina dopo l’evento', { postEventPublic: true }],
      ['«Termina per tutti»', { status: 'ENDED', postEventPublic: true, libraryListed: true }],
      ['la pubblicazione per gli iscritti', { recordingPublished: true }],
      ['la trascrizione per gli iscritti', { transcriptPublished: true }],
      ['un file nello storage', { recordingUrl: FILE }],
      ['togliere il video esterno', { youtubeUrl: null }],
      ['il pubblico che ha gia’', { recordingAudience: 'REGISTRANTS' }],
    ])('un evento riservato accetta %s', async (_n, corpo) => {
      expect((await modifica(riservato(), corpo)).status).toBe(200);
    });

    it('lo stesso video esterno rimandato dal wizard passa', async () => {
      const r = await modifica(riservato({ youtubeUrl: VIDEO_ESTERNO }), {
        youtubeUrl: VIDEO_ESTERNO,
      });
      expect(r.status).toBe(200);
    });

    it('un evento senza destinazione non si blocca', async () => {
      const r = await modifica(
        riservato({ recordingDestination: null, recordingAudience: 'REGISTRANTS' }),
        { recordingAudience: 'PUBLIC', youtubeUrl: VIDEO_ESTERNO, recordingPublished: true },
      );
      expect(r.status).toBe(200);
      expect(datiScritti()).toMatchObject({
        recordingAudience: 'PUBLIC',
        youtubeUrl: VIDEO_ESTERNO,
        recordingPublished: true,
      });
    });

    it('un evento storico importato non si blocca', async () => {
      const r = await modifica(
        riservato({ eventType: 'LEGACY', recordingDestination: null }),
        { recordingAudience: 'PUBLIC' },
      );
      expect(r.status).toBe(200);
    });

    it('una destinazione pubblica non si blocca', async () => {
      const r = await modifica(
        riservato({ recordingDestination: 'PUBLIC', recordingAudience: 'REGISTRANTS' }),
        { recordingAudience: 'PUBLIC', youtubeUrl: VIDEO_ESTERNO },
      );
      expect(r.status).toBe(200);
    });
  });

  describe('togliere la destinazione', () => {
    it.each([
      ['prima della sala', false, false],
      ['dopo la sala', false, true],
      ['con la sala aperta', true, true],
    ])('non passa %s', async (_n, aperta, gia) => {
      sala.salaForseAperta.mockResolvedValue(aperta);
      sala.salaGiaAperta.mockResolvedValue(gia);
      await rifiutata(await modifica(riservato(), { recordingDestination: null }));
      await rifiutata(
        await modifica(riservato({ recordingDestination: 'PUBLIC' }), {
          recordingDestination: null,
        }),
      );
    });

    it('su un evento che non l’ha mai dichiarata, null non cambia niente', async () => {
      const r = await modifica(riservato({ recordingDestination: null }), {
        recordingDestination: null,
      });
      expect(r.status).toBe(200);
      expect(datiScritti()).not.toHaveProperty('recordingDestination');
    });
  });

  describe('cambiarla', () => {
    it('la cambia solo lo staff: un link di conduzione prende 403', async () => {
      staff.requireEventManager.mockRejectedValue(new ForbiddenError('no'));
      const r = await modifica(riservato({ recordingDestination: null }), {
        recordingDestination: 'REGISTRANTS',
      });
      expect(r.status).toBe(403);
      expect(mocked.event.update).not.toHaveBeenCalled();
    });

    it('lo stesso valore da un link di conduzione passa', async () => {
      staff.requireEventManager.mockRejectedValue(new ForbiddenError('no'));
      const r = await modifica(riservato(), { recordingDestination: 'REGISTRANTS' });
      expect(r.status).toBe(200);
      expect(staff.requireEventManager).not.toHaveBeenCalled();
    });

    it('restringere allinea il pubblico, tiene il video esterno e non da’ mai 409', async () => {
      const r = await modifica(
        riservato({
          recordingDestination: 'PUBLIC',
          recordingAudience: 'PUBLIC',
          recordingPublished: true,
          youtubeUrl: VIDEO_ESTERNO,
        }),
        { recordingDestination: 'REGISTRANTS' },
      );
      expect(r.status).toBe(200);
      expect(datiScritti()).toMatchObject({
        recordingDestination: 'REGISTRANTS',
        recordingAudience: 'REGISTRANTS',
      });
    });

    it('restringere vince sul pubblico chiesto dalla stessa richiesta', async () => {
      const r = await modifica(
        riservato({ recordingDestination: 'PUBLIC', recordingAudience: 'PUBLIC' }),
        { recordingDestination: 'REGISTRANTS', recordingAudience: 'PUBLIC' },
      );
      expect(r.status).toBe(200);
      expect(datiScritti().recordingAudience).toBe('REGISTRANTS');
    });

    it('prima della sala si allarga, e il pubblico torna per tutti', async () => {
      const r = await modifica(riservato(), { recordingDestination: 'PUBLIC' });
      expect(r.status).toBe(200);
      expect(datiScritti()).toMatchObject({
        recordingDestination: 'PUBLIC',
        recordingAudience: 'PUBLIC',
      });
    });

    it('allargando si puo’ tenere un pubblico ristretto', async () => {
      await modifica(riservato(), {
        recordingDestination: 'PUBLIC',
        recordingAudience: 'REGISTRANTS',
      });
      expect(datiScritti().recordingDestination).toBe('PUBLIC');
      expect(datiScritti()).not.toHaveProperty('recordingAudience');
    });

    it('dopo la sala non si allarga, anche a evento concluso', async () => {
      sala.salaGiaAperta.mockResolvedValue(true);
      await rifiutata(
        await modifica(riservato({ status: 'ENDED' }), {
          recordingDestination: 'PUBLIC',
          startsAt: '2027-03-01T09:00:00.000Z',
          endsAt: '2027-03-01T10:00:00.000Z',
        }),
      );
      expect(sala.salaGiaAperta).toHaveBeenCalled();
    });

    it('dopo la sala un evento senza destinazione si puo’ solo restringere', async () => {
      sala.salaGiaAperta.mockResolvedValue(true);
      const senza = riservato({ recordingDestination: null, recordingAudience: 'PUBLIC' });
      await rifiutata(await modifica(senza, { recordingDestination: 'PUBLIC' }));
      const r = await modifica(senza, { recordingDestination: 'REGISTRANTS' });
      expect(r.status).toBe(200);
      expect(datiScritti()).toMatchObject({
        recordingDestination: 'REGISTRANTS',
        recordingAudience: 'REGISTRANTS',
      });
    });

    it('a sala aperta una restrizione si ignora e lo si dice', async () => {
      sala.salaForseAperta.mockResolvedValue(true);
      sala.salaGiaAperta.mockResolvedValue(true);
      const r = await modifica(
        riservato({
          status: 'LIVE',
          recordingDestination: 'PUBLIC',
          recordingAudience: 'PUBLIC',
        }),
        { recordingDestination: 'REGISTRANTS' },
      );
      expect(r.status).toBe(200);
      expect(datiScritti()).not.toHaveProperty('recordingDestination');
      expect(datiScritti()).not.toHaveProperty('recordingAudience');
      expect((await r.json()).ignoredCreationOnlyFields).toEqual(['recordingDestination']);
    });

    it('una modifica parziale non tocca destinazione e pubblico', async () => {
      await modifica(riservato(), { postEventShowQA: false });
      expect(datiScritti()).not.toHaveProperty('recordingDestination');
      expect(datiScritti()).not.toHaveProperty('recordingAudience');
    });
  });

  describe('un evento che comincia a registrare', () => {
    const spento = () =>
      riservato({
        recordingEnabled: false,
        recordingDestination: null,
        recordingAudience: 'PUBLIC',
      });

    it.each([
      ['senza il campo', {}],
      ['con null', { recordingDestination: null }],
    ])('%s parte riservato con il pubblico allineato', async (_n, extra) => {
      await modifica(spento(), { recordingEnabled: true, ...extra });
      expect(datiScritti()).toMatchObject({
        recordingEnabled: true,
        recordingDestination: 'REGISTRANTS',
        recordingAudience: 'REGISTRANTS',
      });
    });

    it('una scelta esplicita vale', async () => {
      await modifica(spento(), { recordingEnabled: true, recordingDestination: 'PUBLIC' });
      expect(datiScritti().recordingDestination).toBe('PUBLIC');
    });

    it('una chiamata rapida resta senza destinazione', async () => {
      await modifica({ ...spento(), eventType: 'INSTANT' }, { recordingEnabled: true });
      expect(datiScritti()).not.toHaveProperty('recordingDestination');
    });

    it('a sala aperta il flag si ignora e la destinazione non cambia', async () => {
      sala.salaForseAperta.mockResolvedValue(true);
      await modifica(spento(), { recordingEnabled: true });
      expect(datiScritti()).not.toHaveProperty('recordingDestination');
    });
  });

  describe('un evento concluso salvato dal modulo', () => {
    const GIORNO = 86_400_000;
    const iso = (ms: number) => new Date(ms).toISOString();
    const ORA = Date.now();
    const INIZIO_PASSATO = ORA - 2 * GIORNO;
    const FINE_PASSATA = INIZIO_PASSATO + 3_600_000;
    const concluso = (over: Record<string, unknown> = {}) =>
      riservato({
        status: 'ENDED',
        recordingEnabled: false,
        recordingDestination: null,
        recordingAudience: 'PUBLIC',
        startsAt: new Date(INIZIO_PASSATO),
        endsAt: new Date(FINE_PASSATA),
        ...over,
      });
    const STESSE_DATE = { startsAt: iso(INIZIO_PASSATO), endsAt: iso(FINE_PASSATA) };

    const senzaEffetti = (scritti: Record<string, unknown>) => {
      expect(scritti).not.toHaveProperty('status');
      expect(scritti).not.toHaveProperty('recordingEnabled');
      expect(scritti).not.toHaveProperty('recordingDestination');
      expect(scritti).not.toHaveProperty('recordingAudience');
    };

    it('a date passate invariate resta concluso e la registrazione non lo riserva', async () => {
      const r = await modifica(concluso(), { recordingEnabled: true, ...STESSE_DATE });
      expect(r.status).toBe(200);
      senzaEffetti(datiScritti());
      expect((await r.json()).ignoredCreationOnlyFields).toEqual(['recordingEnabled']);
    });

    it('le date senza i secondi, come le manda il modulo, non cambiano niente', async () => {
      await modifica(
        concluso({
          startsAt: new Date(INIZIO_PASSATO + 37_000),
          endsAt: new Date(FINE_PASSATA + 12_000),
        }),
        { recordingEnabled: true, ...STESSE_DATE },
      );
      senzaEffetti(datiScritti());
    });

    it('una data corretta che resta nel passato non lo riapre e non lo riserva', async () => {
      const r = await modifica(concluso(), {
        recordingEnabled: true,
        ...STESSE_DATE,
        endsAt: iso(FINE_PASSATA + 15 * 60_000),
      });
      expect(r.status).toBe(200);
      senzaEffetti(datiScritti());
      expect(datiScritti().endsAt).toEqual(new Date(FINE_PASSATA + 15 * 60_000));
      expect((await r.json()).ignoredCreationOnlyFields).toEqual(['recordingEnabled']);
    });

    it('lo stato ripetuto non riapre l’evento, nemmeno con la fine nel futuro', async () => {
      await modifica(concluso(), {
        recordingEnabled: true,
        status: 'ENDED',
        ...STESSE_DATE,
        endsAt: iso(ORA + GIORNO),
      });
      const scritti = datiScritti();
      expect(scritti).not.toHaveProperty('recordingEnabled');
      expect(scritti).not.toHaveProperty('recordingDestination');
    });

    it('spostare la fine nel futuro lo riapre: la registrazione vale e parte riservata', async () => {
      await modifica(concluso(), {
        recordingEnabled: true,
        ...STESSE_DATE,
        endsAt: iso(ORA + GIORNO),
      });
      expect(datiScritti()).toMatchObject({
        status: 'LIVE',
        recordingEnabled: true,
        recordingDestination: 'REGISTRANTS',
        recordingAudience: 'REGISTRANTS',
      });
    });

    describe('chiuso prima della fine, con le date ancora nel futuro', () => {
      const INIZIO = ORA + GIORNO;
      const FINE = INIZIO + 3_600_000;
      const chiuso = (over: Record<string, unknown> = {}) =>
        concluso({ startsAt: new Date(INIZIO), endsAt: new Date(FINE), ...over });
      const DATE = { startsAt: iso(INIZIO), endsAt: iso(FINE) };

      it('lo stesso salvataggio lo riapre: i campi della cattura spenti valgono', async () => {
        const r = await modifica(
          chiuso({ recordingEnabled: true, autoStartRecording: true }),
          { recordingEnabled: false, autoStartRecording: false, ...DATE },
        );
        expect(r.status).toBe(200);
        expect(datiScritti()).toMatchObject({
          status: 'PUBLISHED',
          recordingEnabled: false,
          autoStartRecording: false,
        });
        expect((await r.json()).ignoredCreationOnlyFields).toBeUndefined();
      });

      it('la registrazione accesa dal modulo vale e parte riservata', async () => {
        await modifica(chiuso(), { recordingEnabled: true, ...DATE });
        expect(datiScritti()).toMatchObject({
          status: 'PUBLISHED',
          recordingEnabled: true,
          recordingDestination: 'REGISTRANTS',
          recordingAudience: 'REGISTRANTS',
        });
      });
    });
  });

  describe('un file agganciato con recordingUrl', () => {
    const spento = (over: Record<string, unknown> = {}) =>
      riservato({
        recordingEnabled: false,
        recordingDestination: null,
        recordingAudience: 'PUBLIC',
        recordingUrl: null,
        ...over,
      });

    it('con il solo link di conduzione e’ 403, e non si scrive niente', async () => {
      staff.requireEventManager.mockRejectedValue(new UnauthorizedError('sessione'));
      const r = await modifica(spento(), { recordingUrl: FILE, recordingPublished: true });
      expect(r.status).toBe(403);
      expect(mocked.event.update).not.toHaveBeenCalled();
    });

    it('il link di conduzione rimanda lo stesso indirizzo senza rifiuti', async () => {
      staff.requireEventManager.mockRejectedValue(new UnauthorizedError('sessione'));
      const r = await modifica(riservato({ recordingUrl: FILE }), {
        recordingUrl: FILE,
        recordingPublished: true,
      });
      expect(r.status).toBe(200);
      expect(staff.requireEventManager).not.toHaveBeenCalled();
    });

    it('lo staff su un evento mai aperto parte riservato, con il pubblico allineato', async () => {
      await modifica(spento(), { recordingUrl: FILE });
      expect(datiScritti()).toMatchObject({
        recordingUrl: FILE,
        recordingDestination: 'REGISTRANTS',
        recordingAudience: 'REGISTRANTS',
      });
    });

    it('a sala gia’ aperta l’evento resta senza destinazione', async () => {
      sala.salaGiaAperta.mockResolvedValue(true);
      await modifica(spento({ status: 'ENDED' }), { recordingUrl: FILE });
      const scritti = datiScritti();
      expect(scritti.recordingUrl).toBe(FILE);
      expect(scritti).not.toHaveProperty('recordingDestination');
      expect(scritti).not.toHaveProperty('recordingAudience');
    });

    it('una chiamata rapida e un evento storico restano senza destinazione', async () => {
      await modifica(spento({ eventType: 'INSTANT' }), { recordingUrl: FILE });
      expect(datiScritti()).not.toHaveProperty('recordingDestination');
      mocked.event.update.mockClear();
      await modifica(spento({ eventType: 'LEGACY' }), { recordingUrl: FILE });
      expect(datiScritti()).not.toHaveProperty('recordingDestination');
    });

    it('un indirizzo fuori dallo storage su un evento riservato e’ 409', async () => {
      storage.getRecordingsStorage.mockReturnValue({ keyFromUrl: () => null });
      await rifiutata(await modifica(riservato(), { recordingUrl: FILE }));
    });

    it('un file dello storage su un evento riservato passa', async () => {
      storage.getRecordingsStorage.mockReturnValue({ keyFromUrl: () => 'recordings/sala.mp4' });
      expect((await modifica(riservato(), { recordingUrl: FILE })).status).toBe(200);
    });

    it('il file di un altro evento non si aggancia: 422', async () => {
      storage.getRecordingsStorage.mockReturnValue({
        keyFromUrl: () => 'postprod/99999999-9999-4999-8999-999999999999/r/mix.mp4',
      });
      const r = await modifica(riservato(), { recordingUrl: FILE });
      expect(r.status).toBe(422);
      expect(((await r.json()) as { code?: string }).code).toBe('RECORDING_URL_NOT_OWNED');
    });

    it('fuori dallo storage, su un evento per tutti, passa come prima', async () => {
      storage.getRecordingsStorage.mockReturnValue({ keyFromUrl: () => null });
      const r = await modifica(riservato({ recordingDestination: 'PUBLIC', recordingAudience: 'PUBLIC' }), {
        recordingUrl: FILE,
      });
      expect(r.status).toBe(200);
    });
  });

  describe('la rubrica nel modulo', () => {
    const conRubrica = () => riservato({ offerAddressBook: true });

    it('la cambia lo staff, e si salva', async () => {
      const r = await modifica(conRubrica(), { offerAddressBook: false });
      expect(r.status).toBe(200);
      expect(datiScritti().offerAddressBook).toBe(false);
      expect(staff.requireEventManager).toHaveBeenCalled();
    });

    it('un link di conduzione prende 403', async () => {
      staff.requireEventManager.mockRejectedValue(new ForbiddenError('no'));
      const r = await modifica(conRubrica(), { offerAddressBook: false });
      expect(r.status).toBe(403);
      expect(mocked.event.update).not.toHaveBeenCalled();
    });

    it('lo stesso valore da un link di conduzione passa', async () => {
      staff.requireEventManager.mockRejectedValue(new ForbiddenError('no'));
      expect((await modifica(conRubrica(), { offerAddressBook: true })).status).toBe(200);
    });
  });

  it('la risposta della modifica riporta la destinazione', async () => {
    const r = await modifica(riservato(), {});
    expect((await r.json()).recordingDestination).toBe('REGISTRANTS');
  });
});

describe('GET /api/events/[param] — le domande dopo l’evento', () => {
  const lettura = () =>
    GET(
      new Request(`http://localhost/api/events/evento-esistente`) as unknown as NextRequest,
      { params: Promise.resolve({ param: 'evento-esistente' }) } as never,
    );

  const evento = (over: Record<string, unknown>) => ({
    ...eventoEsistente(),
    _count: { registrations: 0 },
    qaEnabled: true,
    postEventShowQA: true,
    postEventPublic: true,
    postEventPublicUntil: null,
    recordingDestination: null,
    recordingAudience: 'PUBLIC',
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractModeratorToken).mockReturnValue(null as unknown as string);
  });
  afterEach(() => {
    vi.mocked(extractModeratorToken).mockReturnValue('token-valido');
  });

  it.each([
    ['evento senza destinazione', {}, true],
    ['destinazione pubblica', { recordingDestination: 'PUBLIC' }, true],
    ['registrazione riservata, interruttore acceso', { recordingDestination: 'REGISTRANTS' }, false],
    [
      'video reso riservato su destinazione pubblica',
      { recordingDestination: 'PUBLIC', recordingAudience: 'REGISTRANTS' },
      false,
    ],
    ['pubblico riservato senza destinazione', { recordingAudience: 'REGISTRANTS' }, false],
    ['interruttore spento', { postEventShowQA: false }, false],
    ['domande spente in sala', { qaEnabled: false }, false],
  ])('%s', async (_n, over, atteso) => {
    mocked.event.findUnique.mockResolvedValue(evento(over));
    const corpo = await (await lettura()).json();
    expect(corpo.postEventShowQA).toBe(atteso);
    expect(corpo).not.toHaveProperty('recordingDestination');
  });

  describe('il recupero in diretta', () => {
    const recupero = {
      tempRecordingUrl: 'https://storage.example.test/recupero.mp4',
      tempRecordingStartedAt: new Date('2027-03-01T09:05:00.000Z'),
    };

    it.each([
      ['in diretta, senza destinazione', 'LIVE', null],
      ['in diretta, destinazione pubblica', 'LIVE', 'PUBLIC'],
    ])('%s: esce', async (_n, status, recordingDestination) => {
      mocked.event.findUnique.mockResolvedValue(
        evento({ ...recupero, status, recordingDestination }),
      );
      const corpo = await (await lettura()).json();
      expect(corpo.tempRecordingUrl).toBe(recupero.tempRecordingUrl);
      expect(corpo.tempRecordingStartedAt).toBe('2027-03-01T09:05:00.000Z');
    });

    it.each([
      ['in diretta, registrazione riservata', 'LIVE', 'REGISTRANTS'],
      ['concluso, destinazione pubblica', 'ENDED', 'PUBLIC'],
      ['concluso, senza destinazione', 'ENDED', null],
      ['in pausa, destinazione pubblica', 'IDLE', 'PUBLIC'],
    ])('%s: non esce', async (_n, status, recordingDestination) => {
      mocked.event.findUnique.mockResolvedValue(
        evento({
          ...recupero,
          status,
          recordingDestination,
          endsAt: new Date(Date.now() + 3_600_000),
        }),
      );
      const corpo = await (await lettura()).json();
      expect(corpo.tempRecordingUrl).toBeNull();
      expect(corpo.tempRecordingStartedAt).toBeNull();
    });

    it('in diretta, video reso riservato dal pubblico: non esce', async () => {
      mocked.event.findUnique.mockResolvedValue(
        evento({
          ...recupero,
          status: 'LIVE',
          recordingDestination: 'PUBLIC',
          recordingAudience: 'REGISTRANTS',
        }),
      );
      const corpo = await (await lettura()).json();
      expect(corpo.tempRecordingUrl).toBeNull();
      expect(corpo.tempRecordingStartedAt).toBeNull();
    });

    it('chi conduce lo legge anche su una registrazione riservata', async () => {
      vi.mocked(extractModeratorToken).mockReturnValue('token-valido');
      mocked.event.findUnique.mockResolvedValue(
        evento({
          ...recupero,
          status: 'LIVE',
          recordingDestination: 'REGISTRANTS',
          createdAt: new Date('2027-01-01T09:00:00.000Z'),
          registrations: [],
        }),
      );
      const corpo = await (await lettura()).json();
      expect(corpo.tempRecordingUrl).toBe(recupero.tempRecordingUrl);
      expect(corpo.tempRecordingStartedAt).toBe('2027-03-01T09:05:00.000Z');
    });
  });

  describe('un evento senza pagina pubblica', () => {
    const VIDEO = 'https://storage.example.test/video.mp4';
    const pubblicato = {
      status: 'ENDED',
      recordingUrl: VIDEO,
      recordingPublished: true,
      registrationCount: 3,
    };

    it.each([
      ['bozza', { status: 'DRAFT' }],
      ['archiviato', { status: 'ARCHIVED' }],
      ['concluso con la pagina privata', { ...pubblicato, postEventPublic: false }],
      [
        'concluso con la finestra scaduta',
        { ...pubblicato, postEventPublicUntil: new Date(Date.now() - 1000) },
      ],
      ['chiamata rapida non conclusa', { status: 'LIVE', eventType: 'INSTANT' }],
    ])('%s: 404, senza titolo ne’ video', async (_n, over) => {
      mocked.event.findUnique.mockResolvedValue(evento(over));
      const r = await lettura();
      expect(r.status).toBe(404);
      const corpo = await r.text();
      expect(corpo).not.toContain('Evento esistente');
      expect(corpo).not.toContain(VIDEO);
    });

    it('concluso con la pagina visibile: il video pubblico esce, dalla rotta dell’app', async () => {
      mocked.event.findUnique.mockResolvedValue(evento(pubblicato));
      const corpo = await (await lettura()).json();
      expect(corpo.recordingUrl).toBe('/api/events/evento-esistente/recording');
      expect(JSON.stringify(corpo)).not.toContain(VIDEO);
    });

    it('in diretta il video resta chiuso se la pagina dopo l’evento e’ privata', async () => {
      mocked.event.findUnique.mockResolvedValue(
        evento({ ...pubblicato, status: 'LIVE', postEventPublic: false }),
      );
      const corpo = await (await lettura()).json();
      expect(corpo.recordingUrl).toBeNull();
    });

    it('chi conduce legge l’evento anche con la pagina privata', async () => {
      vi.mocked(extractModeratorToken).mockReturnValue('token-valido');
      mocked.event.findUnique.mockResolvedValue(
        evento({
          ...pubblicato,
          postEventPublic: false,
          createdAt: new Date('2027-01-01T09:00:00.000Z'),
          registrations: [],
        }),
      );
      const r = await lettura();
      expect(r.status).toBe(200);
      // Anche a chi conduce, la rotta dell'app: mai l'indirizzo dello storage.
      expect((await r.json()).recordingUrl).toBe('/api/events/evento-esistente/recording');
    });
  });

  it('chi conduce legge la scelta salvata, la destinazione e la rubrica', async () => {
    vi.mocked(extractModeratorToken).mockReturnValue('token-valido');
    mocked.event.findUnique.mockResolvedValue(
      evento({
        recordingDestination: 'REGISTRANTS',
        offerAddressBook: false,
        createdAt: new Date('2027-01-01T09:00:00.000Z'),
        registrations: [],
      }),
    );
    expect(await (await lettura()).json()).toMatchObject({
      postEventShowQA: true,
      recordingDestination: 'REGISTRANTS',
      offerAddressBook: false,
    });
  });
});

describe('DELETE /api/events/[param] — i file dell’evento', () => {
  // La transazione con la riga bloccata: lo stato letto li' decide tutto.
  const tx = {
    $queryRaw: vi.fn(),
    event: { delete: vi.fn() },
    emailOutbox: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ status: 'PUBLISHED' }]);
    tx.event.delete.mockResolvedValue({});
    mocked.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) =>
      fn(tx)
    );
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
    expect(
      files.removeFilesOfEventsBeingDeleted.mock.invocationCallOrder[0]
    ).toBeLessThan(tx.event.delete.mock.invocationCallOrder[0]!);
    // Le email dell'evento ancora da inviare non partono piu'.
    expect(tx.emailOutbox.deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        OR: [{ metadata: { path: ['eventId'], equals: EVENT_ID } }],
      },
    });
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
      new AppError('storage', 503, 'STORAGE_DELETE_FAILED')
    );
    const r = await DELETE(cancella(), contesto as never);

    expect(r.status).toBe(503);
    expect(tx.event.delete).not.toHaveBeenCalled();
  });
});
