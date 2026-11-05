// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Una sessione della chiamata: la legge e la cancella solo il link primario, e
 * solo per il suo evento. La cancellazione porta via il file della registrazione,
 * ma un guasto dello storage non blocca la cancellazione dei dati.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, deleteRecordingBlob } = vi.hoisted(() => ({
  prisma: {
    event: { findFirst: vi.fn(), update: vi.fn() },
    callSession: { findFirst: vi.fn(), delete: vi.fn() },
    gdprAuditLog: { create: vi.fn() },
    $transaction: vi.fn(async (operazioni: unknown[]) => Promise.all(operazioni)),
  },
  deleteRecordingBlob: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/storage/recordings', () => ({ deleteRecordingBlob }));

import { encryptJSON } from '@/lib/crypto/pii';

import { DELETE, GET } from './route';

const EVENTO = '11111111-1111-4111-8111-111111111111';
const ALTRO_EVENTO = '22222222-2222-4222-8222-222222222222';
const SESSIONE = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'token-del-moderatore-primario';
const FILE = 'https://archivio.example.com/mix.mp4';
const BEARER = { authorization: `Bearer ${TOKEN}` };

let riga: Record<string, unknown>;
let registrazioneEvento: string | null;

function richiesta(
  metodo: 'GET' | 'DELETE',
  headers: Record<string, string> = BEARER,
  query = ''
) {
  return new Request(
    `http://localhost:3000/api/events/evento/sessions/${SESSIONE}${query}`,
    {
      method: metodo,
      headers,
    }
  ) as unknown as NextRequest;
}

const parametri = (param = 'evento') => ({
  params: Promise.resolve({ param, id: SESSIONE }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  registrazioneEvento = null;
  riga = {
    id: SESSIONE,
    eventId: EVENTO,
    jitsiRoomName: 'stanza-1',
    startedAt: new Date('2026-10-02T08:00:00Z'),
    endedAt: null,
    duration: null,
    peakParticipants: 12,
    participants: encryptJSON([{ name: 'Anna Bianchi' }]),
    recordingUrl: FILE,
    recordingFileSize: BigInt(2048),
    recordingDuration: 3500,
    recordingFilename: 'mix.mp4',
    telemetry: {},
    dominantSpeakerLog: [{ atMs: 1, participantId: 'p1', displayName: 'Luca Verdi' }],
    createdAt: new Date('2026-10-02T08:00:00Z'),
  };
  // Come il database: i filtri su token ed evento decidono cosa si trova.
  prisma.event.findFirst.mockImplementation(
    async ({ where }: { where: { moderatorToken?: string } }) =>
      where.moderatorToken === TOKEN
        ? { id: EVENTO, recordingUrl: registrazioneEvento }
        : null
  );
  prisma.callSession.findFirst.mockImplementation(
    async ({ where }: { where: { id: string; eventId?: string } }) =>
      where.id === riga.id && where.eventId === riga.eventId ? riga : null
  );
  prisma.callSession.delete.mockResolvedValue({ id: SESSIONE });
  deleteRecordingBlob.mockResolvedValue(true);
});

const chiama = {
  GET: (headers?: Record<string, string>, query?: string) =>
    GET(richiesta('GET', headers, query), parametri()),
  DELETE: (headers?: Record<string, string>, query?: string) =>
    DELETE(richiesta('DELETE', headers, query), parametri()),
};

describe.each(['GET', 'DELETE'] as const)('%s: chi arriva alla sessione', (metodo) => {
  it('senza token e’ 403, senza toccare il database', async () => {
    expect((await chiama[metodo]({})).status).toBe(403);
    expect(prisma.event.findFirst).not.toHaveBeenCalled();
  });

  it('il token non viaggia in un header proprio', async () => {
    expect((await chiama[metodo]({ 'x-moderator-token': TOKEN })).status).toBe(403);
    expect(prisma.callSession.delete).not.toHaveBeenCalled();
  });

  it('un token sbagliato non raggiunge la sessione', async () => {
    expect((await chiama[metodo]({ authorization: 'Bearer sbagliato' })).status).toBe(
      404
    );
    expect(prisma.callSession.findFirst).not.toHaveBeenCalled();
    expect(prisma.callSession.delete).not.toHaveBeenCalled();
    expect(deleteRecordingBlob).not.toHaveBeenCalled();
  });

  it('il token passa anche con ?token=', async () => {
    expect((await chiama[metodo]({}, `?token=${TOKEN}`)).status).toBe(200);
  });

  it('la sessione di un altro evento e’ 404', async () => {
    riga = { ...riga, eventId: ALTRO_EVENTO };
    expect((await chiama[metodo]()).status).toBe(404);
    expect(prisma.callSession.delete).not.toHaveBeenCalled();
    expect(deleteRecordingBlob).not.toHaveBeenCalled();
  });
});

describe('un identificativo malformato', () => {
  const malformato = { params: Promise.resolve({ param: 'evento', id: 'non-un-uuid' }) };

  it('e’ 404, come una sessione che non c’e’, senza interrogare il database', async () => {
    expect((await GET(richiesta('GET'), malformato)).status).toBe(404);
    expect((await DELETE(richiesta('DELETE'), malformato)).status).toBe(404);
    expect(prisma.callSession.findFirst).not.toHaveBeenCalled();
  });
});

describe('la lettura', () => {
  it('i partecipanti cifrati arrivano in chiaro a chi conduce', async () => {
    const corpo = (await (await chiama.GET()).json()) as { participants: unknown };
    expect(corpo.participants).toEqual([{ name: 'Anna Bianchi' }]);
  });

  it('la dimensione del file e’ un numero, e la sessione aperta non ha fine', async () => {
    await expect((await chiama.GET()).json()).resolves.toMatchObject({
      id: SESSIONE,
      recordingFileSize: 2048,
      endedAt: null,
    });
  });

  it('la cronologia di chi parla non esce', async () => {
    expect(await (await chiama.GET()).text()).not.toContain('Luca Verdi');
  });

  it('l’evento si cerca anche per identificativo', async () => {
    await GET(richiesta('GET'), parametri(EVENTO));
    expect(prisma.event.findFirst.mock.calls[0]![0].where).toEqual({
      OR: [{ id: EVENTO }, { slug: EVENTO }],
      moderatorToken: TOKEN,
    });
  });
});

describe('la cancellazione', () => {
  it('se il file era quello dell’evento, la pagina smette di puntarci', async () => {
    registrazioneEvento = FILE;
    await chiama.DELETE();
    const { where, data } = prisma.event.update.mock.calls[0]![0];
    expect(where).toEqual({ id: EVENTO });
    expect(data).toMatchObject({
      recordingUrl: null,
      recordingPublished: false,
      recordingPublishedAt: null,
    });
    expect(JSON.parse(prisma.gdprAuditLog.create.mock.calls[0]![0].data.details)).toEqual(
      {
        callSession: SESSIONE,
        wasEventRecording: true,
      }
    );
  });

  it('un file diverso da quello pubblicato non tocca l’evento, ma resta tracciato', async () => {
    registrazioneEvento = 'https://archivio.example.com/altro.mp4';
    await chiama.DELETE();
    expect(prisma.event.update).not.toHaveBeenCalled();
    expect(prisma.gdprAuditLog.create).toHaveBeenCalledTimes(1);
  });

  it('una sessione senza file non lascia traccia di una registrazione cancellata', async () => {
    riga = { ...riga, recordingUrl: null };
    await chiama.DELETE();
    expect(prisma.event.update).not.toHaveBeenCalled();
    expect(prisma.gdprAuditLog.create).not.toHaveBeenCalled();
    expect(prisma.callSession.delete).toHaveBeenCalledWith({ where: { id: SESSIONE } });
  });

  it('toglie il file dall’indirizzo salvato e poi la riga', async () => {
    const r = await chiama.DELETE();
    expect(deleteRecordingBlob).toHaveBeenCalledWith(FILE);
    expect(prisma.callSession.delete).toHaveBeenCalledWith({ where: { id: SESSIONE } });
    await expect(r.json()).resolves.toEqual({ deleted: true });
  });

  it('senza registrazione non cerca nessun file', async () => {
    riga = { ...riga, recordingUrl: null };
    expect((await chiama.DELETE()).status).toBe(200);
    expect(deleteRecordingBlob).not.toHaveBeenCalled();
    expect(prisma.callSession.delete).toHaveBeenCalledTimes(1);
  });

  it('un guasto dello storage non blocca la cancellazione della riga', async () => {
    deleteRecordingBlob.mockRejectedValue(new Error('storage irraggiungibile'));
    expect((await chiama.DELETE()).status).toBe(200);
    expect(prisma.callSession.delete).toHaveBeenCalledTimes(1);
  });
});
