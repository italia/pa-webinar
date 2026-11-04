// @vitest-environment node
/**
 * Le sessioni di una chiamata. L'elenco contiene i nomi di chi ha partecipato,
 * cifrati a riposo, e lo legge solo il link primario. L'apertura e' libera ma si
 * ferma agli eventi davvero aperti, e non crea doppioni.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    event: { findFirst: vi.fn() },
    callSession: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma }));

import { encryptJSON } from '@/lib/crypto/pii';

import { GET, POST } from './route';

const EVENTO = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'token-del-moderatore-primario';
const INIZIO = new Date('2026-10-02T08:00:00Z');

let contatore = 0;
let indirizzo = '';
let statoEvento = 'LIVE';

function elenca(
  headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` },
  query = '',
  param = 'evento'
) {
  const request = new Request(
    `http://localhost:3000/api/events/${param}/sessions${query}`,
    {
      headers,
    }
  );
  return GET(request as unknown as NextRequest, { params: Promise.resolve({ param }) });
}

function apri(param = 'evento') {
  const request = new Request(`http://localhost:3000/api/events/${param}/sessions`, {
    method: 'POST',
    headers: { 'x-forwarded-for': indirizzo },
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({ param }) });
}

function sessione(extra: Record<string, unknown> = {}) {
  return {
    id: 's1',
    jitsiRoomName: 'stanza-1',
    startedAt: INIZIO,
    endedAt: new Date('2026-10-02T09:00:00Z'),
    duration: 3600,
    peakParticipants: 12,
    participants: encryptJSON([{ name: 'Anna Bianchi' }]),
    recordingUrl: 'https://archivio.example.com/mix.mp4',
    recordingFileSize: BigInt(2048),
    recordingDuration: 3500,
    recordingFilename: 'mix.mp4',
    telemetry: { qualita: 'buona' },
    dominantSpeakerLog: [{ atMs: 1, participantId: 'p1', displayName: 'Luca Verdi' }],
    handRaiseLog: [{ participantId: 'endpoint-opaco', raised: true }],
    createdAt: INIZIO,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  indirizzo = `203.0.113.${++contatore}`;
  statoEvento = 'LIVE';
  // Come il database: un filtro sul token che non combacia non trova l'evento.
  prisma.event.findFirst.mockImplementation(
    async ({ where }: { where: { moderatorToken?: string } }) =>
      where.moderatorToken === undefined || where.moderatorToken === TOKEN
        ? { id: EVENTO, status: statoEvento, jitsiRoomName: 'stanza-1' }
        : null
  );
  prisma.callSession.findMany.mockResolvedValue([sessione()]);
  prisma.callSession.findFirst.mockResolvedValue(null);
  prisma.callSession.create.mockResolvedValue({ id: 's-nuova', startedAt: INIZIO });
});

describe('l’elenco delle sessioni', () => {
  it('senza token e’ 403, senza toccare il database', async () => {
    expect((await elenca({})).status).toBe(403);
    expect(prisma.event.findFirst).not.toHaveBeenCalled();
  });

  it('il token non viaggia in un header proprio', async () => {
    expect((await elenca({ 'x-moderator-token': TOKEN })).status).toBe(403);
  });

  it('un token sbagliato non legge niente', async () => {
    expect((await elenca({ authorization: 'Bearer sbagliato' })).status).toBe(404);
    expect(prisma.callSession.findMany).not.toHaveBeenCalled();
  });

  it('il token passa anche con ?token=', async () => {
    expect((await elenca({}, `?token=${TOKEN}`)).status).toBe(200);
  });

  it('l’evento si cerca per slug, o per identificativo se ne ha la forma', async () => {
    await elenca();
    expect(prisma.event.findFirst.mock.calls[0]![0].where).toEqual({
      slug: 'evento',
      moderatorToken: TOKEN,
    });
    await elenca(undefined, '', EVENTO);
    expect(prisma.event.findFirst.mock.calls[1]![0].where).toEqual({
      OR: [{ id: EVENTO }, { slug: EVENTO }],
      moderatorToken: TOKEN,
    });
  });

  it('legge solo le sessioni di questo evento', async () => {
    await elenca();
    expect(prisma.callSession.findMany.mock.calls[0]![0].where).toEqual({
      eventId: EVENTO,
    });
  });

  it('i partecipanti cifrati arrivano in chiaro a chi conduce', async () => {
    const corpo = (await (await elenca()).json()) as {
      sessions: Array<{ participants: unknown }>;
    };
    expect(corpo.sessions[0]!.participants).toEqual([{ name: 'Anna Bianchi' }]);
  });

  it('la cronologia di chi parla e delle mani alzate non esce', async () => {
    const testo = await (await elenca()).text();
    expect(testo).not.toContain('Luca Verdi');
    expect(testo).not.toContain('endpoint-opaco');
  });

  it('la dimensione del file e’ un numero, o null se manca', async () => {
    prisma.callSession.findMany.mockResolvedValue([
      sessione(),
      sessione({ id: 's2', recordingFileSize: null, endedAt: null }),
    ]);
    const corpo = (await (await elenca()).json()) as {
      sessions: Array<{ recordingFileSize: number | null; endedAt: string | null }>;
    };
    expect(corpo.sessions[0]!.recordingFileSize).toBe(2048);
    expect(corpo.sessions[1]).toMatchObject({ recordingFileSize: null, endedAt: null });
  });
});

describe('l’apertura di una sessione', () => {
  it('un evento inesistente e’ 404', async () => {
    prisma.event.findFirst.mockResolvedValue(null);
    expect((await apri()).status).toBe(404);
    expect(prisma.callSession.create).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'PUBLISHED', 'IDLE', 'ENDED', 'ARCHIVED'])(
    'con l’evento in stato %s non si apre niente',
    async (status) => {
      statoEvento = status;
      expect((await apri()).status).toBe(409);
      expect(prisma.callSession.create).not.toHaveBeenCalled();
    }
  );

  it.each(['LIVE', 'PROVISIONING'])('con la sala in stato %s si apre', async (status) => {
    statoEvento = status;
    const r = await apri();
    expect(r.status).toBe(201);
    await expect(r.json()).resolves.toEqual({
      id: 's-nuova',
      createdNow: true,
      startedAt: INIZIO.toISOString(),
    });
  });

  it('nella riga nuova ci sono solo la stanza e l’ora, non chi l’ha aperta', async () => {
    const prima = Date.now();
    await apri();
    const { data } = prisma.callSession.create.mock.calls[0]![0] as {
      data: { startedAt: Date };
    };
    expect(data).toEqual({
      eventId: EVENTO,
      jitsiRoomName: 'stanza-1',
      startedAt: expect.any(Date),
      peakParticipants: 0,
    });
    expect(data.startedAt.getTime()).toBeGreaterThanOrEqual(prima);
  });

  it('una sessione gia’ aperta si riusa, senza scrivere', async () => {
    prisma.callSession.findFirst.mockResolvedValue({ id: 's-aperta', startedAt: INIZIO });
    const r = await apri();
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({
      id: 's-aperta',
      createdNow: false,
      startedAt: INIZIO.toISOString(),
    });
    expect(prisma.callSession.findFirst.mock.calls[0]![0].where).toEqual({
      eventId: EVENTO,
      endedAt: null,
    });
    expect(prisma.callSession.create).not.toHaveBeenCalled();
  });

  it('oltre il limite per indirizzo si ferma prima di leggere l’evento', async () => {
    prisma.event.findFirst.mockResolvedValue(null);
    for (let i = 0; i < 30; i++) await apri();
    const r = await apri();
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
    expect(prisma.event.findFirst).toHaveBeenCalledTimes(30);
  });
});
