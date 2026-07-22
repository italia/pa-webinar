import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findMany: vi.fn(), update: vi.fn() },
    gdprAuditLog: { create: vi.fn() },
    eventMaterial: { findMany: vi.fn(), deleteMany: vi.fn() },
    chatMessage: { findMany: vi.fn(), deleteMany: vi.fn() },
    questionUpvote: { deleteMany: vi.fn() },
    question: { deleteMany: vi.fn() },
    pollVote: { deleteMany: vi.fn() },
    poll: { deleteMany: vi.fn() },
    eventFeedback: { deleteMany: vi.fn() },
    questionnaireResponse: { deleteMany: vi.fn() },
    wordCloudSubmission: { deleteMany: vi.fn() },
    wordCloudRound: { deleteMany: vi.fn() },
    reminderSent: { deleteMany: vi.fn() },
    eventReminder: { deleteMany: vi.fn() },
    registration: { deleteMany: vi.fn() },
    reaction: { deleteMany: vi.fn() },
    agendaItemReaction: { deleteMany: vi.fn() },
    eventAgendaItem: { deleteMany: vi.fn() },
    recordingTrack: { deleteMany: vi.fn() },
    callSession: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/storage/recordings', () => ({ deleteRecordingBlob: vi.fn() }));
vi.mock('@/lib/azure/blob-storage', () => ({
  deleteBlob: vi.fn(),
  isAzureConfigured: vi.fn(),
}));

import { prisma } from '@/lib/db';
import { deleteRecordingBlob } from '@/lib/storage/recordings';
import { deleteBlob, isAzureConfigured } from '@/lib/azure/blob-storage';

import { GET } from './route';

/**
 * Il cron di cleanup è il codice che CANCELLA dati di persone. Le tre fasi
 * lavorano su una `where` diversa ciascuna e su un evento che NON viene mai
 * hard-deleted: sbagliare la selezione significa o perdere dati vivi, o
 * lasciare PII oltre la retention promessa in `docs/GDPR.md`.
 *
 * Il DB è mockato con lo stesso oggetto usato come `tx`, così le deleteMany
 * dentro la transazione sono ispezionabili come le altre chiamate: qui non si
 * verifica Prisma, si verifica CHE COSA il cron chiede di cancellare e su
 * quali eventi.
 */

type Mock = ReturnType<typeof vi.fn>;

const db = prisma as unknown as {
  event: { findMany: Mock; update: Mock };
  gdprAuditLog: { create: Mock };
  eventMaterial: { findMany: Mock; deleteMany: Mock };
  chatMessage: { findMany: Mock; deleteMany: Mock };
  question: { deleteMany: Mock };
  poll: { deleteMany: Mock };
  questionnaireResponse: { deleteMany: Mock };
  registration: { deleteMany: Mock };
  reaction: { deleteMany: Mock };
  agendaItemReaction: { deleteMany: Mock };
  eventAgendaItem: { deleteMany: Mock };
  recordingTrack: { deleteMany: Mock };
  callSession: { updateMany: Mock };
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

/** Tutte le chiamate registrate su tutti i delegate, serializzate. */
function everyDbCall(): string {
  const chunks: string[] = [];
  for (const delegate of Object.values(prisma as unknown as Record<string, unknown>)) {
    if (!delegate || typeof delegate !== 'object') continue;
    for (const fn of Object.values(delegate as Record<string, unknown>)) {
      const mock = (fn as { mock?: { calls: unknown[][] } }).mock;
      if (mock) chunks.push(JSON.stringify(mock.calls));
    }
  }
  return chunks.join('|');
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
    deleteRecordingBlobMock.mockResolvedValue(true);
    deleteBlobMock.mockResolvedValue(true);
    isAzureConfiguredMock.mockReturnValue(true);
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

    // La query parte già ristretta agli eventi finiti…
    const phase3Args = db.event.findMany.mock.calls[2]?.[0];
    expect(phase3Args.where).toEqual({ status: { in: ['ENDED', 'ARCHIVED'] } });

    // …e il filtro sulla retention scarta l'evento di ieri: i suoi dati
    // servono ancora (recap, pubblicazione del video, feedback) e
    // l'informativa ne promette 30 giorni.
    expect(body.eventsProcessed).toBe(1);
    expect(body.registrationsDeleted).toBe(12);
    expect(everyDbCall()).toContain('evt-vecchio');
    expect(everyDbCall()).not.toContain('evt-ieri');
  });

  it('fase 3: cancella tutte le entità con PII dell’evento scaduto', async () => {
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });

    await runCleanup();

    const byEvent = { where: { eventId: 'evt-vecchio' } };
    // Registrazioni (email cifrata, nome, hash, token) e Q&A: sono le due voci
    // che `docs/GDPR.md` promette esplicitamente di cancellare.
    expect(db.registration.deleteMany).toHaveBeenCalledWith(byEvent);
    expect(db.question.deleteMany).toHaveBeenCalledWith(byEvent);
    expect(db.poll.deleteMany).toHaveBeenCalledWith(byEvent);
    // Le risposte ai questionari contengono nome + hash email del rispondente
    // e non sono raggiungibili da `eventId`: si passa dal questionario.
    expect(db.questionnaireResponse.deleteMany).toHaveBeenCalledWith({
      where: { questionnaire: { eventId: 'evt-vecchio' } },
    });
    // Reazioni e agenda non hanno PII ma sono dati dell'evento oltre la
    // retention, e la loro cascade non scatta (vedi il test sulla chat).
    expect(db.reaction.deleteMany).toHaveBeenCalledWith(byEvent);
    expect(db.eventAgendaItem.deleteMany).toHaveBeenCalledWith(byEvent);
    expect(db.agendaItemReaction.deleteMany).toHaveBeenCalledWith({
      where: { agendaItem: { eventId: 'evt-vecchio' } },
    });
  });

  it('fase 3: cancella la CHAT anche quando l’evento è già ARCHIVED', async () => {
    // Il difetto storico: `ChatMessage.eventId` è onDelete: Cascade, ma
    // l'evento non viene MAI hard-deleted (resta ARCHIVED come riferimento
    // storico), quindi la cascata non scatta e nomi + testi dei messaggi
    // sopravvivevano alla retention. Vanno cancellati esplicitamente, e
    // l'evento già archiviato deve comunque essere ripreso in carico.
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

  it('fase 3: archivia l’evento ENDED dopo averlo ripulito', async () => {
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio', status: 'ENDED' })] });

    await runCleanup();

    // L'evento sopravvive come riferimento storico (titolo, date): è
    // esattamente ciò che `docs/GDPR.md` dichiara.
    expect(db.event.update).toHaveBeenCalledWith({
      where: { id: 'evt-vecchio' },
      data: { status: 'ARCHIVED' },
    });
  });

  it('fase 3: cancella i blob degli allegati chat e dei materiali', async () => {
    // Cancellare la riga senza il blob lascerebbe il file caricato in chat
    // (contenuto scritto da un partecipante) nello storage per sempre, senza
    // più nessuna riga che lo indichi.
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });
    db.eventMaterial.findMany.mockResolvedValue([{ blobPath: 'events/x/files/slide.pdf' }]);
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
      'events/x/files/slide.pdf',
    ]);
    expect(body.materialBlobsDeleted).toBe(3);
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
    expect(db.eventMaterial.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.$transaction.mock.invocationCallOrder[0] as number
    );
  });

  it('fase 3: senza storage file configurato cancella comunque i dati dal DB', async () => {
    // In dev non c'è provider: `deleteBlob` tornerebbe false a vuoto. La
    // cancellazione delle PII dal database non deve dipenderne.
    isAzureConfiguredMock.mockReturnValue(false);
    stubEventQueries({ ended: [endedEvent({ id: 'evt-vecchio' })] });
    db.chatMessage.findMany.mockResolvedValue([{ attachmentBlobPath: 'assets/chat/a.png' }]);

    const res = await runCleanup();
    const body = await res.json();

    expect(deleteBlobMock).not.toHaveBeenCalled();
    expect(db.chatMessage.deleteMany).toHaveBeenCalled();
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
    // La risposta resta 200 (il cron non va in retry cieco) ma conta solo
    // l'evento davvero ripulito: quello rotto tornerà al giro dopo.
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.eventsProcessed).toBe(1);
    expect(db.chatMessage.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'evt-sano' },
    });
  });

  it('non fa nulla quando nessun evento ha superato la retention', async () => {
    stubEventQueries({ ended: [endedEvent({ id: 'evt-ieri', endsAt: daysAgo(1) })] });

    const res = await runCleanup();
    const body = await res.json();

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(deleteRecordingBlobMock).not.toHaveBeenCalled();
    expect(deleteBlobMock).not.toHaveBeenCalled();
    expect(body).toEqual({
      ok: true,
      tempRecordingsCleaned: 0,
      publishedRecordingsCleaned: 0,
      eventsProcessed: 0,
      registrationsDeleted: 0,
      questionsDeleted: 0,
      pollsDeleted: 0,
      recordingBlobsDeleted: 0,
      materialBlobsDeleted: 0,
    });
  });
});
