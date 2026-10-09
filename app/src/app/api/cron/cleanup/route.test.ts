import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { filesStorage } = vi.hoisted(() => ({
  filesStorage: {
    current: null as null | {
      delete: ReturnType<typeof vi.fn>;
      list: ReturnType<typeof vi.fn>;
    },
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    staffLoginToken: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    $executeRaw: vi.fn(async () => 0),
    registration: { deleteMany: vi.fn(), findMany: vi.fn(async (): Promise<unknown[]> => []) },
    emailOutbox: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    adminAuditLog: { updateMany: vi.fn(async () => ({ count: 0 })) },
    staffAccount: { updateMany: vi.fn(async () => ({ count: 0 })) },
    gdprAuditLog: { create: vi.fn() },
    eventMaterial: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    chatMessage: { findMany: vi.fn(), deleteMany: vi.fn() },
    questionUpvote: { deleteMany: vi.fn() },
    questionGuestUpvote: { deleteMany: vi.fn() },
    question: { deleteMany: vi.fn(), updateMany: vi.fn() },
    pollVote: { deleteMany: vi.fn() },
    poll: { deleteMany: vi.fn() },
    eventFeedback: { deleteMany: vi.fn() },
    questionnaireResponse: { deleteMany: vi.fn() },
    wordCloudSubmission: { deleteMany: vi.fn() },
    wordCloudRound: { deleteMany: vi.fn() },
    reminderSent: { deleteMany: vi.fn() },
    eventReminder: { deleteMany: vi.fn() },
    multitrackConsent: { deleteMany: vi.fn() },
    recordingConsent: { deleteMany: vi.fn() },
    reaction: { deleteMany: vi.fn() },
    agendaItemReaction: { deleteMany: vi.fn() },
    eventAgendaItem: { deleteMany: vi.fn() },
    liveAction: { deleteMany: vi.fn() },
    eventInvitation: { deleteMany: vi.fn() },
    eventModerator: { deleteMany: vi.fn() },
    recordingTrack: { deleteMany: vi.fn() },
    callSession: { updateMany: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ eventGracePeriodMinutes: 15 })),
}));
vi.mock('@/lib/storage/recordings', () => ({ deleteRecordingBlob: vi.fn() }));
// L'impronta delle concessioni ha il suo test (lib/events/grant-email-hash).
vi.mock('@/lib/events/grant-email-hash', () => ({ completaImprontaConcessioni: vi.fn(async () => 0) }));
vi.mock('@/lib/azure/blob-storage', () => ({
  deleteBlob: vi.fn(),
  isAzureConfigured: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({
  getFilesStorage: () => filesStorage.current,
}));

import { prisma } from '@/lib/db';
import { deleteRecordingBlob } from '@/lib/storage/recordings';
import { deleteBlob, isAzureConfigured } from '@/lib/azure/blob-storage';

import { GET } from './route';

/**
 * Il cron di cleanup è il codice che CANCELLA dati di persone. Le tre fasi
 * lavorano su una `where` diversa ciascuna e su un evento che NON viene mai
 * hard-deleted: sbagliare la selezione significa o perdere dati vivi, o
 * lasciare PII oltre la retention promessa in `docs/GDPR.md`. Alla scadenza
 * i dati delle persone se ne vanno, mentre i contenuti della sala (domande,
 * sondaggi, parole, valutazioni, materiali) restano con l'evento, anonimi.
 *
 * Il DB è mockato con lo stesso oggetto usato come `tx`, così le deleteMany e
 * le updateMany dentro la transazione sono ispezionabili come le altre
 * chiamate: qui non si verifica Prisma, si verifica CHE COSA il cron chiede di
 * cancellare o anonimizzare, e su quali eventi.
 */

type Mock = ReturnType<typeof vi.fn>;

const db = prisma as unknown as {
  event: { findMany: Mock; findFirst: Mock; update: Mock; updateMany: Mock };
  staffLoginToken: { deleteMany: Mock };
  emailOutbox: { deleteMany: Mock; updateMany: Mock };
  adminAuditLog: { updateMany: Mock };
  staffAccount: { updateMany: Mock };
  gdprAuditLog: { create: Mock };
  eventMaterial: { findMany: Mock; findFirst: Mock; deleteMany: Mock; updateMany: Mock };
  chatMessage: { findMany: Mock; deleteMany: Mock };
  questionUpvote: { deleteMany: Mock };
  questionGuestUpvote: { deleteMany: Mock };
  question: { deleteMany: Mock; updateMany: Mock };
  pollVote: { deleteMany: Mock };
  poll: { deleteMany: Mock };
  eventFeedback: { deleteMany: Mock };
  questionnaireResponse: { deleteMany: Mock };
  wordCloudSubmission: { deleteMany: Mock };
  wordCloudRound: { deleteMany: Mock };
  reminderSent: { deleteMany: Mock };
  eventReminder: { deleteMany: Mock };
  registration: { deleteMany: Mock; findMany: Mock };
  $executeRaw: Mock;
  multitrackConsent: { deleteMany: Mock };
  recordingConsent: { deleteMany: Mock };
  reaction: { deleteMany: Mock };
  agendaItemReaction: { deleteMany: Mock };
  eventAgendaItem: { deleteMany: Mock };
  liveAction: { deleteMany: Mock };
  eventInvitation: { deleteMany: Mock };
  eventModerator: { deleteMany: Mock };
  recordingTrack: { deleteMany: Mock };
  callSession: { updateMany: Mock; findMany: Mock; update: Mock };
  $transaction: Mock;
};
const deleteRecordingBlobMock = deleteRecordingBlob as unknown as Mock;
const deleteBlobMock = deleteBlob as unknown as Mock;
const isAzureConfiguredMock = isAzureConfigured as unknown as Mock;

const NOW = new Date('2026-07-22T03:00:00Z');
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);
const CRON_KEY = 'test-cron-key';

/** Evento della fase 3: la `select` dell'handler, con default innocui. */
function endedEvent(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'vecchio',
    endsAt: daysAgo(60),
    lastActiveAt: null,
    dataRetentionDays: 30,
    status: 'ENDED',
    recordingUrl: null,
    tempRecordingUrl: null,
    recordingPublished: false,
    _count: { registrations: 0, questions: 0, polls: 0 },
    ...over,
  };
}

/**
 * Le tre `findMany` su `event` sono distinte dalla loro `where`, non
 * dall'ordine: così un riordino delle fasi non fa passare i test per caso.
 */
function stubEventQueries(rows: {
  tempRecordings?: unknown[];
  publishedRecordings?: unknown[];
  ended?: unknown[];
}) {
  db.event.findMany.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
    const where = args?.where ?? {};
    if ('tempRecordingUrl' in where) return rows.tempRecordings ?? [];
    if ('recordingDeleteAfterDays' in where) return rows.publishedRecordings ?? [];
    return rows.ended ?? [];
  });
}

/**
 * Tutte le chiamate registrate su tutti i delegate, serializzate. Comprese
 * quelle in SQL (`$executeRaw`), che portano l'id dell'evento fra i parametri.
 */
function everyDbCall(): string {
  const chunks: string[] = [];
  for (const value of Object.values(prisma as unknown as Record<string, unknown>)) {
    if (!value) continue;
    const own = (value as { mock?: { calls: unknown[][] } }).mock;
    if (typeof value === 'function' && own) {
      chunks.push(JSON.stringify(own.calls));
      continue;
    }
    if (typeof value !== 'object') continue;
    for (const fn of Object.values(value as Record<string, unknown>)) {
      const mock = (fn as { mock?: { calls: unknown[][] } }).mock;
      if (mock) chunks.push(JSON.stringify(mock.calls));
    }
  }
  return chunks.join('|');
}

/** Le tabelle i cui contenuti la fase 3 anonimizza con una UPDATE in SQL. */
const RAW_ANONYMIZED_TABLES = [
  'poll_votes',
  'event_feedback',
  'questionnaire_responses',
  'word_cloud_submissions',
] as const;

/**
 * La UPDATE in SQL emessa su `table`, riconosciuta dal testo e non
 * dall'ordine: testo, parametri e posizione nella sequenza delle chiamate.
 */
function rawUpdate(table: string): { sql: string; params: unknown[]; order: number } {
  const calls = db.$executeRaw.mock.calls as unknown[][];
  const i = calls.findIndex((c) =>
    (c[0] as TemplateStringsArray).join('?').includes(`UPDATE "${table}"`),
  );
  if (i < 0) throw new Error(`nessuna UPDATE su "${table}"`);
  return {
    sql: (calls[i]![0] as TemplateStringsArray).join('?'),
    params: calls[i]!.slice(1),
    order: db.$executeRaw.mock.invocationCallOrder[i] as number,
  };
}

async function runCleanup(apiKey: string | null = CRON_KEY) {
  const request = new Request('http://localhost/api/cron/cleanup', {
    headers: apiKey ? { 'x-api-key': apiKey } : {},
  });
  return GET(request as unknown as Parameters<typeof GET>[0], {
    params: Promise.resolve({}),
  });
}

describe('GET /api/cron/cleanup', () => {
  const originalCronKey = process.env.CRON_API_KEY;

  beforeEach(() => {
    vi.resetAllMocks();
    // Default innocui su ogni delegate: nessuna riga trovata, nessuna riga
    // cancellata. Ogni test dichiara esplicitamente ciò che esiste.
    for (const delegate of Object.values(prisma as unknown as Record<string, unknown>)) {
      if (!delegate || typeof delegate !== 'object') continue;
      for (const [name, fn] of Object.entries(delegate as Record<string, unknown>)) {
        const mock = fn as Mock;
        if (typeof mock !== 'function') continue;
        if (name === 'findMany') mock.mockResolvedValue([]);
        else if (name === 'findFirst') mock.mockResolvedValue(null);
        else if (name === 'deleteMany' || name === 'updateMany')
          mock.mockResolvedValue({ count: 0 });
        else mock.mockResolvedValue({});
      }
    }
    // `tx` è lo stesso oggetto mock: la transazione non è simulata, ci
    // interessa solo che le delete che contiene vengano emesse.
    db.$transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === 'function'
        ? await (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : await Promise.all(arg as Promise<unknown>[])
    );
    db.$executeRaw.mockResolvedValue(0);
    deleteRecordingBlobMock.mockResolvedValue(true);
    deleteBlobMock.mockResolvedValue(true);
    isAzureConfiguredMock.mockReturnValue(true);
    filesStorage.current = {
      delete: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.CRON_API_KEY = CRON_KEY;
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    // Ripristina console: la spia è globale al worker e resterebbe attiva
    // sui file di test eseguiti dopo questo.
    vi.restoreAllMocks();
    if (originalCronKey === undefined) delete process.env.CRON_API_KEY;
    else process.env.CRON_API_KEY = originalCronKey;
  });

  it('senza chiave cron non legge e non cancella nulla', async () => {
    // L'endpoint è raggiungibile come tutte le route: se il gate cadesse,
    // chiunque potrebbe far partire una cancellazione di massa.
    const res = await runCleanup('chiave-sbagliata');
    expect(res.status).toBe(401);
    expect(db.event.findMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  // ── Fase 1: registrazioni temporanee (24 h) ──

  it('fase 1: cancella la registrazione temporanea scaduta e azzera i riferimenti', async () => {
    stubEventQueries({
      tempRecordings: [
        { id: 'evt-temp', slug: 'temp', tempRecordingUrl: 'https://blob/temp.mp4' },
      ],
    });

    const res = await runCleanup();
    const body = await res.json();

    const where = db.event.findMany.mock.calls[0]?.[0]?.where;
    // Il taglio è a 24 ore esatte e solo su registrazioni NON pubblicate: una
    // registrazione pubblicata non è più "temporanea" e la governa la fase 2.
    expect(where.recordingPublished).toBe(false);
    expect(where.tempRecordingStartedAt.lt.toISOString()).toBe(
      '2026-07-21T03:00:00.000Z'
    );

    expect(deleteRecordingBlobMock).toHaveBeenCalledWith('https://blob/temp.mp4');
    expect(db.event.update).toHaveBeenCalledWith({
      where: { id: 'evt-temp' },
      data: { tempRecordingUrl: null, tempRecordingStartedAt: null },
    });
    expect(db.gdprAuditLog.create.mock.calls[0]?.[0].data).toMatchObject({
      eventId: 'evt-temp',
      action: 'TEMP_RECORDING_DELETED',
    });
    expect(body.tempRecordingsCleaned).toBe(1);
  });

  it('fase 1: cancella il blob PRIMA di azzerare l’URL sul record', async () => {
    // Se azzerassimo prima il record e la delete fallisse, il blob resterebbe
    // nello storage senza più nessun riferimento con cui ritrovarlo.
    stubEventQueries({
      tempRecordings: [
        { id: 'evt-temp', slug: 'temp', tempRecordingUrl: 'https://blob/temp.mp4' },
      ],
    });

    await runCleanup();

    expect(deleteRecordingBlobMock.mock.invocationCallOrder[0]).toBeLessThan(
      db.event.update.mock.invocationCallOrder[0] as number
    );
  });

  // ── Fase 2: registrazioni pubblicate oltre la loro retention ──

  it('fase 2: cancella solo il video pubblicato oltre la retention', async () => {
    stubEventQueries({
      publishedRecordings: [
        {
          id: 'evt-scaduto',
          slug: 'scaduto',
          recordingUrl: 'https://blob/scaduto.mp4',
          recordingDeleteAfterDays: 30,
          recordingPublishedAt: daysAgo(31),
        },
        {
          id: 'evt-fresco',
          slug: 'fresco',
          recordingUrl: 'https://blob/fresco.mp4',
          recordingDeleteAfterDays: 30,
          recordingPublishedAt: daysAgo(2),
        },
      ],
    });

    const res = await runCleanup();
    const body = await res.json();

    expect(deleteRecordingBlobMock).toHaveBeenCalledTimes(1);
    expect(deleteRecordingBlobMock).toHaveBeenCalledWith('https://blob/scaduto.mp4');
    expect(db.event.update).toHaveBeenCalledTimes(1);
    expect(db.event.update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'evt-scaduto' },
      // Tolto il file, vanno tolti anche i metadati che la pagina evento usa
      // per mostrare il player: altrimenti resterebbe un link a un 404.
      data: {
        recordingUrl: null,
        recordingPublished: false,
        recordingPublishedAt: null,
        recordingDeleteAfterDays: null,
      },
    });
    expect(body.publishedRecordingsCleaned).toBe(1);
    expect(everyDbCall()).not.toContain('evt-fresco');
  });

  // ── Fase 3: retention completa dei dati dell'evento ──

  it('fase 3: seleziona solo eventi finiti e ripulisce quello oltre retention, non quello appena concluso', async () => {
    const vecchio = endedEvent({ id: 'evt-vecchio', endsAt: daysAgo(60) });
    const ieri = endedEvent({ id: 'evt-ieri', slug: 'ieri', endsAt: daysAgo(1) });
    stubEventQueries({ ended: [vecchio, ieri] });
    db.registration.deleteMany.mockResolvedValue({ count: 12 });

    const res = await runCleanup();
    const body = await res.json();

    // La query parte già ristretta agli eventi finiti, o mai conclusi ma
    // oltre la loro fine: il giro ripassa ogni giorno (è idempotente)…
    const phase3Args = db.event.findMany.mock.calls[2]?.[0];
    expect(phase3Args.where).toEqual({
      OR: [
        { status: { in: ['ENDED', 'ARCHIVED'] } },
        { status: { in: ['PUBLISHED', 'PROVISIONING', 'IDLE', 'LIVE'] }, endsAt: { lt: NOW } },
      ],
    });

    // …e il filtro sulla retention scarta l'evento di ieri: i suoi dati
    // servono ancora (recap, pubblicazione del video, feedback) e
    // l'informativa ne promette 30 giorni.
    expect(body.eventsProcessed).toBe(1);
    expect(body.registrationsDeleted).toBe(12);
    expect(everyDbCall()).toContain('evt-vecchio');
    expect(everyDbCall()).not.toContain('evt-ieri');
  });

  it('fase 3: un evento mai concluso oltre fine + retention viene archiviato e ripulito', async () => {
    // Rimasto PUBLISHED o LIVE settimane dopo la fine (nessuno lo ha chiuso):
    // l'informativa promette la cancellazione comunque.
    const incagliato = endedEvent({ id: 'evt-incagliato', status: 'LIVE', endsAt: daysAgo(40) });
    stubEventQueries({ ended: [incagliato] });
    db.registration.deleteMany.mockResolvedValue({ count: 3 });

    const res = await runCleanup();
    const body = await res.json();

    expect(body.eventsProcessed).toBe(1);
    expect(body.unfinishedEventsArchived).toBe(1);
    expect(db.registration.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'evt-incagliato' },
    });
    // Lascia il servizio adesso: archiviato.
    expect(db.event.update).toHaveBeenCalledWith({
      where: { id: 'evt-incagliato' },
      data: { status: 'ARCHIVED' },
    });
    // Le sessioni rimaste aperte si chiudono nella stessa transazione.
    expect(db.callSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: { in: ['evt-incagliato'] }, endedAt: null } }),
    );
  });

  it('fase 3: la sessione di un evento mai concluso si chiude sulla fine della sala, non su oggi', async () => {
    const fine = daysAgo(40);
    const incagliato = endedEvent({
      id: 'evt-incagliato',
      status: 'PUBLISHED',
      endsAt: fine,
      updatedAt: daysAgo(35),
      gracePeriodMinutes: 0,
    });
    stubEventQueries({ ended: [incagliato] });
    db.callSession.findMany.mockResolvedValue([
      {
        id: 'sess-1',
        eventId: 'evt-incagliato',
        startedAt: new Date(fine.getTime() - 3_600_000),
        peakParticipants: 4,
      },
    ]);

    await runCleanup();

    expect(db.callSession.update).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { endedAt: fine, duration: 3600 },
    });
  });

  it('fase 3: un evento mai concluso resta intatto se la sala è stata usata di recente', async () => {
    // Sala a tempo indefinito ancora in uso dopo la fine programmata: la
    // finestra decorre dall'ultima attività.
    const inUso = endedEvent({
      id: 'evt-in-uso',
      status: 'LIVE',
      endsAt: daysAgo(40),
      lastActiveAt: daysAgo(2),
    });
    stubEventQueries({ ended: [inUso] });

    const res = await runCleanup();
    const body = await res.json();

    expect(body.eventsProcessed).toBe(0);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('fase 3: una bozza non viene mai ripulita', async () => {
    stubEventQueries({ ended: [endedEvent({ id: 'evt-bozza', status: 'DRAFT' })] });

    const res = await runCleanup();
    const body = await res.json();

    expect(body.eventsProcessed).toBe(0);
    expect(everyDbCall()).not.toContain('"evt-bozza"');
  });

  it('fase 3: un evento concluso non riapre né richiude le sessioni (le ripara il giro del ciclo di vita)', async () => {
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio', status: 'ENDED' })] });

    await runCleanup();

    expect(db.callSession.findMany).not.toHaveBeenCalled();
  });

  it('fase 3: cancella i dati delle persone dell’evento scaduto', async () => {
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });

    await runCleanup();

    const byEvent = { where: { eventId: 'evt-vecchio' } };
    // Iscrizioni (email cifrata, nome, hash, token): la voce che
    // `docs/GDPR.md` promette esplicitamente di cancellare.
    expect(db.registration.deleteMany).toHaveBeenCalledWith(byEvent);
    // I pollici in su si cancellano passando dalla domanda, in tutte e due le
    // tabelle: quella degli iscritti e quella di chi vota con l'identificativo
    // del browser (ospiti, relatori, moderatori). La domanda resta, con il
    // conteggio dei voti.
    expect(db.questionUpvote.deleteMany).toHaveBeenCalledWith({
      where: { question: { eventId: 'evt-vecchio' } },
    });
    expect(db.questionGuestUpvote.deleteMany).toHaveBeenCalledWith({
      where: { question: { eventId: 'evt-vecchio' } },
    });
    // Promemoria programmati e loro invii, consensi alla registrazione dati
    // in sala d'attesa: riguardano persone, non il contenuto dell'evento.
    expect(db.reminderSent.deleteMany).toHaveBeenCalledWith({
      where: { reminder: { eventId: 'evt-vecchio' } },
    });
    expect(db.eventReminder.deleteMany).toHaveBeenCalledWith(byEvent);
    expect(db.multitrackConsent.deleteMany).toHaveBeenCalledWith(byEvent);
    expect(db.recordingConsent.deleteMany).toHaveBeenCalledWith(byEvent);
    // Le reazioni live e quelle agli argomenti dell'agenda sono di una
    // persona, e la loro cascade non scatta (vedi il test sulla chat).
    expect(db.reaction.deleteMany).toHaveBeenCalledWith(byEvent);
    expect(db.agendaItemReaction.deleteMany).toHaveBeenCalledWith({
      where: { agendaItem: { eventId: 'evt-vecchio' } },
    });
  });

  it('fase 3: i contenuti della sala restano con l’evento', async () => {
    // Domande, sondaggi, parole, valutazioni, materiali, agenda e
    // cronologia restano finché esiste l'evento, perché chi organizza possa
    // decidere se pubblicarli: la pulizia toglie le identità, non i contenuti.
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });

    const res = await runCleanup();

    expect(res.status).toBe(200);
    const nonCancellati = {
      question: db.question.deleteMany,
      poll: db.poll.deleteMany,
      pollVote: db.pollVote.deleteMany,
      eventFeedback: db.eventFeedback.deleteMany,
      wordCloudRound: db.wordCloudRound.deleteMany,
      wordCloudSubmission: db.wordCloudSubmission.deleteMany,
      eventMaterial: db.eventMaterial.deleteMany,
      eventAgendaItem: db.eventAgendaItem.deleteMany,
      liveAction: db.liveAction.deleteMany,
    };
    for (const [modello, deleteMany] of Object.entries(nonCancellati)) {
      expect(deleteMany, modello).not.toHaveBeenCalled();
    }
  });

  it('fase 3: domande, voti, valutazioni, risposte e parole perdono ogni legame con una persona', async () => {
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });

    await runCleanup();

    // La domanda resta (testo, risposta, voti contati) senza nome
    // dell'autore né iscrizione.
    expect(db.question.updateMany).toHaveBeenCalledWith({
      where: { eventId: 'evt-vecchio', OR: [{ registrationId: { not: null } }, { authorName: { not: '' } }] },
      data: { registrationId: null, authorName: '' },
    });
    // Voti, valutazioni, risposte di fine evento e parole: via l'iscrizione,
    // e l'identificativo del browser diventa uno pseudonimo per persona e per
    // evento (md5 di evento e identità), così i vincoli «una per persona» e i
    // conteggi per persona reggono. Solo le righe dell'evento.
    for (const table of RAW_ANONYMIZED_TABLES) {
      const upd = rawUpdate(table);
      expect(upd.sql, table).toContain('"registration_id" = NULL');
      expect(upd.sql, table).toContain(`'anon:' || md5(`);
      expect(upd.sql, table).toContain(`COALESCE("registration_id"::text, "guest_id", "id"::text)`);
      expect(new Set(upd.params), table).toEqual(new Set(['evt-vecchio']));
    }
    // Le risposte di fine evento perdono anche nome e hash dell'email…
    const risposte = rawUpdate('questionnaire_responses').sql;
    expect(risposte).toContain('"respondent_name" = NULL');
    expect(risposte).toContain('"respondent_email_hash" = NULL');
    expect(risposte).toContain(`"placement" = 'POST_EVENT'`);
    // …quelle chieste all'iscrizione riguardano chi si è iscritto, e se ne
    // vanno con lui.
    expect(db.questionnaireResponse.deleteMany).toHaveBeenCalledWith({
      where: { questionnaire: { eventId: 'evt-vecchio', placement: { not: 'POST_EVENT' } } },
    });
  });

  it('fase 3: toglie le identità PRIMA di cancellare le iscrizioni', async () => {
    // Domande e voti dei sondaggi hanno la chiave verso l'iscrizione in
    // cascata: cancellare prima le iscrizioni li porterebbe via con loro, e i
    // contenuti dell'evento sparirebbero invece di restare anonimi.
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });

    await runCleanup();

    const iscrizioni = db.registration.deleteMany.mock.invocationCallOrder[0];
    expect(iscrizioni).toBeDefined();
    expect(db.question.updateMany.mock.invocationCallOrder[0]).toBeLessThan(iscrizioni!);
    for (const table of RAW_ANONYMIZED_TABLES) {
      expect(rawUpdate(table).order, table).toBeLessThan(iscrizioni!);
    }
    expect(db.questionnaireResponse.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      iscrizioni!,
    );
  });

  it('fase 3: i materiali restano con il loro file, senza il nome di chi li ha aggiunti', async () => {
    // Il file di un materiale se ne va quando si cancella l'evento, non alla
    // scadenza della conservazione: qui si toglie solo `addedBy`.
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });
    db.eventMaterial.findMany.mockResolvedValue([
      { id: 'mat-1', eventId: 'evt-vecchio', blobPath: 'events/evt-vecchio/files/slide.pdf' },
    ]);
    db.eventMaterial.updateMany.mockResolvedValue({ count: 1 });

    const res = await runCleanup();
    const body = await res.json();

    expect(db.eventMaterial.updateMany).toHaveBeenCalledWith({
      where: { eventId: 'evt-vecchio', addedBy: { not: '' } },
      data: { addedBy: '' },
    });
    expect(db.eventMaterial.deleteMany).not.toHaveBeenCalled();
    expect(filesStorage.current!.delete).not.toHaveBeenCalled();
    expect(deleteBlobMock).not.toHaveBeenCalled();
    expect(deleteRecordingBlobMock).not.toHaveBeenCalled();
    expect(body.chatAttachmentBlobsDeleted).toBe(0);
    expect(body.eventsProcessed).toBe(1);
  });

  it('fase 3: il registro GDPR conta ciò che è stato cancellato e ciò che è stato anonimizzato', async () => {
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });
    db.registration.deleteMany.mockResolvedValue({ count: 9 });
    db.question.updateMany.mockResolvedValue({ count: 4 });
    db.questionnaireResponse.deleteMany.mockResolvedValue({ count: 1 });
    db.eventMaterial.updateMany.mockResolvedValue({ count: 2 });
    const righe: Record<string, number> = {
      poll_votes: 5,
      event_feedback: 2,
      questionnaire_responses: 3,
      word_cloud_submissions: 6,
    };
    db.$executeRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      const table = Object.keys(righe).find((t) => sql.includes(`UPDATE "${t}"`));
      return table ? righe[table] : 0;
    });

    const res = await runCleanup();
    const body = await res.json();

    const audit = db.gdprAuditLog.create.mock.calls[0]?.[0].data;
    expect(audit).toMatchObject({
      eventId: 'evt-vecchio',
      action: 'DATA_DELETED',
      recordCount: 9,
    });
    const details = JSON.parse(audit.details);
    expect(details).toMatchObject({
      registrations: 9,
      questionsAnonymized: 4,
      pollVotesAnonymized: 5,
      feedbackAnonymized: 2,
      questionnaireResponsesAnonymized: 3,
      questionnaireResponsesDeleted: 1,
      wordCloudSubmissionsAnonymized: 6,
      materialsAnonymized: 2,
    });
    // Nessun conteggio di cancellazione per ciò che ora resta.
    for (const vecchia of ['questions', 'polls', 'pollVotes', 'materials', 'agendaItems', 'liveActions']) {
      expect(details, vecchia).not.toHaveProperty(vecchia);
    }
    // La risposta del cron riporta gli anonimizzati, non più i cancellati.
    expect(body).toMatchObject({
      eventsProcessed: 1,
      registrationsDeleted: 9,
      questionsAnonymized: 4,
      pollVotesAnonymized: 5,
    });
    expect(body).not.toHaveProperty('questionsDeleted');
    expect(body).not.toHaveProperty('pollsDeleted');
  });

  it('fase 3: cancella le concessioni nominali di moderatore e relatore', async () => {
    // `EventModerator` porta nome ed email cifrati piu' un token di accesso
    // durevole, e la sua cascade non scatta (l'evento resta ARCHIVED). Chi
    // duplica un evento ricorrente ne crea una copia a ogni occorrenza: senza
    // questa riga l'indirizzo di quella persona sopravvive alla retention in
    // tante copie quante sono le occorrenze della serie.
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });

    await runCleanup();

    expect(db.eventModerator.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'evt-vecchio' },
    });
  });

  it('fase 3: cancella gli inviti, che portano email cifrata e link di accesso', async () => {
    // Stessa classe di dati e stessa trappola della cascade delle concessioni
    // nominali: un invito non accettato non ha piu' ragione di esistere quando
    // l'evento a cui invitava e' scaduto.
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });

    await runCleanup();

    expect(db.eventInvitation.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'evt-vecchio' },
    });
  });

  it('fase 3: cancella la CHAT anche quando l’evento è già ARCHIVED', async () => {
    // Il difetto storico: `ChatMessage.eventId` è onDelete: Cascade, ma
    // l'evento non viene MAI hard-deleted dalla pulizia (resta, ENDED o
    // ARCHIVED), quindi la cascata non scatta e nomi + testi dei messaggi
    // sopravvivevano alla retention. Vanno cancellati esplicitamente, e un
    // evento archiviato a mano prima della scadenza deve comunque essere
    // ripreso in carico.
    stubEventQueries({
      ended: [endedEvent({ id: 'evt-archiviato', status: 'ARCHIVED' })],
    });
    db.chatMessage.deleteMany.mockResolvedValue({ count: 7 });

    const res = await runCleanup();
    const body = await res.json();

    expect(db.chatMessage.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'evt-archiviato' },
    });
    expect(body.eventsProcessed).toBe(1);
    // Già ARCHIVED: nessuna riscrittura dello stato.
    expect(db.event.update).not.toHaveBeenCalled();
    // Il conteggio finisce nell'audit log GDPR, che è senza PII.
    const audit = db.gdprAuditLog.create.mock.calls[0]?.[0].data;
    expect(audit.action).toBe('DATA_DELETED');
    expect(JSON.parse(audit.details).chatMessages).toBe(7);
  });

  it.each(['ENDED', 'ARCHIVED'])(
    'fase 3: un evento concluso (%s) resta com’è',
    async (status) => {
      // La pagina di un evento concluso e ciò che mostra li decide chi
      // organizza: la pulizia non lo archivia e non ne tocca lo stato.
      stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio', status })] });

      const res = await runCleanup();
      const body = await res.json();

      expect(db.event.update).not.toHaveBeenCalled();
      expect(body.eventsProcessed).toBe(1);
      expect(body.unfinishedEventsArchived).toBe(0);
    },
  );

  it('fase 3: cancella i blob degli allegati chat', async () => {
    // Cancellare la riga senza il blob lascerebbe il file caricato in chat
    // (contenuto scritto da un partecipante) nello storage per sempre, senza
    // più nessuna riga che lo indichi.
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });
    db.chatMessage.findMany.mockResolvedValue([
      { attachmentBlobPath: 'assets/chat/a.png' },
      { attachmentBlobPath: 'assets/chat/b.pdf' },
    ]);

    const res = await runCleanup();
    const body = await res.json();

    expect(db.chatMessage.findMany).toHaveBeenCalledWith({
      where: { eventId: 'evt-vecchio', attachmentBlobPath: { not: null } },
      select: { attachmentBlobPath: true },
    });
    expect(deleteBlobMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      'assets/chat/a.png',
      'assets/chat/b.pdf',
    ]);
    // Solo gli allegati della chat: i file dei materiali restano.
    expect(filesStorage.current!.delete).not.toHaveBeenCalled();
    expect(body.chatAttachmentBlobsDeleted).toBe(2);
  });

  it('fase 3: legge i path degli allegati PRIMA di cancellare le righe', async () => {
    // Dopo la transazione le righe non esistono più: chiedere i path dopo
    // vorrebbe dire non trovarne nessuno e lasciare i blob orfani.
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });
    db.chatMessage.findMany.mockResolvedValue([{ attachmentBlobPath: 'assets/chat/a.png' }]);

    await runCleanup();

    expect(db.chatMessage.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.$transaction.mock.invocationCallOrder[0] as number
    );
  });

  it('fase 3: senza storage file configurato cancella comunque i dati dal DB', async () => {
    // In dev non c'è provider: `deleteBlob` tornerebbe false a vuoto. La
    // cancellazione delle PII dal database non deve dipenderne.
    isAzureConfiguredMock.mockReturnValue(false);
    filesStorage.current = null;
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });
    db.chatMessage.findMany.mockResolvedValue([{ attachmentBlobPath: 'assets/chat/a.png' }]);

    const res = await runCleanup();
    const body = await res.json();

    expect(deleteBlobMock).not.toHaveBeenCalled();
    expect(db.chatMessage.deleteMany).toHaveBeenCalled();
    expect(db.registration.deleteMany).toHaveBeenCalledWith({ where: { eventId: 'evt-vecchio' } });
    expect(db.eventMaterial.updateMany).toHaveBeenCalledWith({
      where: { eventId: 'evt-vecchio', addedBy: { not: '' } },
      data: { addedBy: '' },
    });
    expect(body.eventsProcessed).toBe(1);
  });

  it('fase 3: purga il video non pubblicato e la registrazione temporanea, risparmia quello pubblicato', async () => {
    stubEventQueries({
      ended: [
        endedEvent({
          id: 'evt-pubblicato',
          recordingUrl: 'https://blob/pubblicato.mp4',
          recordingPublished: true,
          tempRecordingUrl: 'https://blob/grezzo.mp4',
        }),
        endedEvent({
          id: 'evt-non-pubblicato',
          slug: 'non-pubblicato',
          recordingUrl: 'https://blob/interno.mp4',
          recordingPublished: false,
        }),
      ],
    });

    const res = await runCleanup();
    const body = await res.json();

    const urls = deleteRecordingBlobMock.mock.calls.map((c) => c[0]);
    // Il video pubblicato è l'unico esente: lo governa la fase 2
    // (recordingDeleteAfterDays), e cancellarlo qui manderebbe in 404 il
    // player ancora linkato dalla pagina evento.
    expect(urls).not.toContain('https://blob/pubblicato.mp4');
    // Il grezzo pre-pubblicazione e il video mai pubblicato invece sì:
    // nessuna delle due fasi precedenti li guarda.
    expect(urls).toContain('https://blob/grezzo.mp4');
    expect(urls).toContain('https://blob/interno.mp4');
    expect(body.recordingBlobsDeleted).toBe(2);
  });

  it('fase 3: cancella solo le tracce audio già purgate, non quelle ancora presenti', async () => {
    // `RecordingTrack.displayName` è PII cifrata, ma cancellare la riga di una
    // traccia il cui blob esiste ancora orfanerebbe l'audio isolato (ADR-013):
    // quelle le prende multitrack-purge, non questo cron.
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });

    await runCleanup();

    expect(db.recordingTrack.deleteMany).toHaveBeenCalledWith({
      where: { recording: { eventId: 'evt-vecchio' }, audioPurgedAt: { not: null } },
    });
  });

  it('fase 3: ripulisce la CallSession invece di cancellarla', async () => {
    // Cancellare la CallSession cascata sull'intero albero Recording
    // (RecordingTrack / PostprodJob / PostprodArtifact / Speaker): si azzerano
    // le sole colonne con PII e restano le metriche aggregate.
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });

    await runCleanup();

    expect(db.callSession.updateMany).toHaveBeenCalledWith({
      where: { eventId: 'evt-vecchio' },
      data: { dominantSpeakerLog: [], handRaiseLog: [], participants: [] },
    });
  });

  it('un evento che fallisce non blocca la retention degli altri', async () => {
    stubEventQueries({
      ended: [
        endedEvent({ id: 'evt-rotto', slug: 'rotto' }),
        endedEvent({ id: 'evt-sano', slug: 'sano' }),
      ],
    });
    const realImpl = db.$transaction.getMockImplementation();
    db.$transaction.mockImplementationOnce(async () => {
      throw new Error('deadlock');
    });

    const res = await runCleanup();
    const body = await res.json();

    expect(realImpl).toBeDefined();
    // L'evento sano viene ripulito lo stesso; quello rotto fa fallire il
    // giro (500, ok: false) invece di lasciare un esito verde, e torna al
    // giro dopo.
    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.failures).toEqual([expect.stringMatching(/^event:/)]);
    expect(body.eventsProcessed).toBe(1);
    expect(db.chatMessage.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'evt-sano' },
    });
    // Quello rotto si riprende al giro dopo: la fase 3 ripassa ogni giorno.
  });

  it('cancella i link di accesso dello staff usati o scaduti da oltre un giorno', async () => {
    // Senza, ogni link lascerebbe per sempre una riga: lo storico degli
    // accessi di ogni persona, conservato senza scopo.
    stubEventQueries({});
    await runCleanup();
    const chiamata = db.staffLoginToken.deleteMany.mock.calls[0]?.[0] as {
      where: { OR: Array<{ usedAt?: { lt: Date }; expiresAt?: { lt: Date } }> };
    };
    const soglie = chiamata.where.OR.map((c) => (c.usedAt ?? c.expiresAt)!.lt.getTime());
    for (const t of soglie) {
      expect(Date.now() - t).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
    }
    expect(chiamata.where.OR).toHaveLength(2);
  });

  it('svuota la coda delle email concluse oltre la conservazione, tenendo le chiavi di deduplica', async () => {
    stubEventQueries({});
    await runCleanup();
    const del = db.emailOutbox.deleteMany.mock.calls[0]?.[0] as {
      where: { status: { in: string[] }; updatedAt: { lt: Date }; dedupKey: null };
    };
    expect(del.where.status.in).toEqual(['SENT', 'FAILED']);
    expect(del.where.dedupKey).toBeNull();
    expect(Date.now() - del.where.updatedAt.lt.getTime()).toBeGreaterThanOrEqual(
      30 * 86_400_000 - 1000,
    );
    const scrub = db.emailOutbox.updateMany.mock.calls[0]?.[0] as {
      where: { dedupKey: unknown };
      data: Record<string, unknown>;
    };
    expect(scrub.where.dedupKey).toEqual({ not: null });
    expect(scrub.data).toMatchObject({ toAddress: '', html: '', text: null });
  });

  it("toglie IP, user agent e nomi dal registro audit oltre la conservazione", async () => {
    stubEventQueries({});
    await runCleanup();
    const [ipCall, namesCall] = db.adminAuditLog.updateMany.mock.calls.map(
      (c) => c[0] as { where: Record<string, unknown>; data: Record<string, unknown> },
    );
    expect(ipCall!.data).toEqual({ ip: null, userAgent: null });
    expect(namesCall!.where.action).toEqual({ in: ['POSTPROD_SPEAKER_MAP'] });
    expect(namesCall!.data).toEqual({ details: null });
    const cutoff = (ipCall!.where.createdAt as { lt: Date }).lt.getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(90 * 86_400_000 - 1000);
  });

  it('disattiva gli account dello staff senza accesso da oltre un anno', async () => {
    stubEventQueries({});
    await runCleanup();
    const call = db.staffAccount.updateMany.mock.calls[0]?.[0] as {
      where: { active: boolean; createdAt: { lt: Date }; AND: Array<{ OR: Array<Record<string, unknown>> }> };
      data: { active: boolean };
    };
    expect(call.where.active).toBe(true);
    expect(call.data).toEqual({ active: false });
    expect(Date.now() - call.where.createdAt.lt.getTime()).toBeGreaterThanOrEqual(365 * 86_400_000 - 1000);
    // Conta anche la riattivazione: un account appena riattivato non si spegne.
    expect(JSON.stringify(call.where.AND)).toContain('reactivatedAt');
    expect(JSON.stringify(call.where.AND)).toContain('lastLoginAt');
  });

  it('non disattiva nessun account con STAFF_INACTIVE_DEACTIVATE_DAYS=0', async () => {
    process.env.STAFF_INACTIVE_DEACTIVATE_DAYS = '0';
    try {
      stubEventQueries({});
      await runCleanup();
      expect(db.staffAccount.updateMany).not.toHaveBeenCalled();
    } finally {
      delete process.env.STAFF_INACTIVE_DEACTIVATE_DAYS;
    }
  });

  it('fallisce con 500 se la pulizia della coda email non riesce', async () => {
    stubEventQueries({});
    db.emailOutbox.deleteMany.mockRejectedValueOnce(new Error('db down'));
    const res = await runCleanup();
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toMatchObject({ ok: false, failures: ['email-outbox'] });
  });

  it('non fa nulla quando nessun evento ha superato la retention', async () => {
    stubEventQueries({ ended: [endedEvent({ id: 'evt-ieri', endsAt: daysAgo(1) })] });

    const res = await runCleanup();
    const body = await res.json();

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.event.update).not.toHaveBeenCalled();
    expect(deleteRecordingBlobMock).not.toHaveBeenCalled();
    expect(deleteBlobMock).not.toHaveBeenCalled();
    expect(body).toEqual({
      ok: true,
      grantFingerprintsFilled: 0,
      staffLoginLinksDeleted: 0,
      staffAccountsDeactivated: 0,
      emailOutboxDeleted: 0,
      emailOutboxScrubbed: 0,
      auditLogRowsScrubbed: 0,
      tempRecordingsCleaned: 0,
      publishedRecordingsCleaned: 0,
      eventsProcessed: 0,
      unfinishedEventsArchived: 0,
      registrationsDeleted: 0,
      questionsAnonymized: 0,
      pollVotesAnonymized: 0,
      recordingBlobsDeleted: 0,
      chatAttachmentBlobsDeleted: 0,
      profilePhotosDeleted: 0,
    });
  });

  it('foto profilo: una sola DELETE per le vecchie senza iscrizioni', async () => {
    stubEventQueries({});
    db.$executeRaw.mockResolvedValue(3);
    const body = await (await runCleanup()).json();
    const chiamata = db.$executeRaw.mock.calls.find((c: unknown[]) =>
      String((c[0] as TemplateStringsArray).join('?')).includes('profile_photos'),
    );
    expect(chiamata).toBeDefined();
    const sql = (chiamata![0] as TemplateStringsArray).join('?');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('"registrations"');
    const limite = chiamata![1] as Date;
    expect(Date.now() - limite.getTime()).toBeGreaterThan(29 * 86_400_000);
    expect(body.profilePhotosDeleted).toBe(3);
  });

});



describe('GET /api/cron/cleanup — giro quotidiano idempotente', () => {
  it('un giro che non toglie niente non scrive nel registro GDPR', async () => {
    vi.resetAllMocks();
    process.env.CRON_API_KEY = CRON_KEY;
    // Tutto a zero: l'evento era gia' stato ripulito un altro giorno. Le
    // sessioni di chiamata si ripuliscono sempre (contano 1), ma non bastano.
    for (const delegate of Object.values(prisma as unknown as Record<string, unknown>)) {
      if (!delegate || typeof delegate !== 'object') continue;
      for (const [name, fn] of Object.entries(delegate as Record<string, unknown>)) {
        const mock = fn as Mock;
        if (typeof mock !== 'function') continue;
        if (name === 'findMany') mock.mockResolvedValue([]);
        else if (name === 'deleteMany' || name === 'updateMany') mock.mockResolvedValue({ count: 0 });
        else mock.mockResolvedValue({});
      }
    }
    db.callSession.updateMany.mockResolvedValue({ count: 1 });
    db.$executeRaw.mockResolvedValue(0);
    db.$transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? await (arg as (tx: unknown) => Promise<unknown>)(prisma) : arg,
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    stubEventQueries({ ended: [endedEvent({ id: 'evt-gia-pulito' })] });
    const res = await runCleanup();
    expect((await res.json()).eventsProcessed).toBe(1);
    expect(db.gdprAuditLog.create).not.toHaveBeenCalled();
  });
});
