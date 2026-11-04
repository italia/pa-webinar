// @vitest-environment node
/**
 * Art. 15, il diritto di accesso: i dati si consegnano solo a chi ha il token
 * arrivato alla sua casella, sono tutti quelli della persona e solo i suoi, e la
 * consegna lascia una traccia che non rivela l'indirizzo.
 */
import type { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    registration: { findMany: vi.fn() },
    profilePhoto: { findUnique: vi.fn() },
    eventModerator: { findMany: vi.fn() },
    gdprAuditLog: { create: vi.fn() },
    captionSegment: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma }));

import { encryptPII } from '@/lib/crypto/pii';
import { issueGdprToken } from '@/lib/gdpr/request-token';

import { GET } from './route';

const HASH = 'f'.repeat(64);
let ip = 0;

function chiedi(query = '', indirizzo = `10.2.0.${(ip += 1)}`) {
  const request = new Request(`http://localhost:3000/api/gdpr/export${query}`, {
    headers: { 'x-forwarded-for': indirizzo },
  });
  return GET(request as unknown as NextRequest, { params: Promise.resolve({}) });
}
const conToken = () => chiedi(`?t=${issueGdprToken('export', HASH)}`);

function iscrizione(id: string, eventId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    eventId,
    emailHash: HASH,
    accessToken: 'token-segreto-di-accesso',
    email: encryptPII('anna@example.com'),
    displayName: encryptPII('Anna Bianchi'),
    organization: 'Comune',
    organizationRole: null,
    organizationType: null,
    consentGiven: true,
    consentTimestamp: new Date('2026-10-01T08:00:00Z'),
    consentRecording: true,
    consentMultitrack: false,
    consentRecordingWithdrawnAt: null,
    consentMultitrackWithdrawnAt: null,
    consentFutureCommunications: false,
    locale: 'it',
    createdAt: new Date('2026-10-01T08:00:00Z'),
    joinedAt: null,
    event: {
      title: { it: 'Evento' },
      startsAt: new Date('2026-10-02T08:00:00Z'),
      endsAt: new Date('2026-10-02T09:00:00Z'),
      status: 'ENDED',
    },
    questions: [],
    pollVotes: [],
    multitrackConsents: [],
    recordingConsents: [],
    ...extra,
  };
}

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.APP_SECRET = 'segreto-di-prova-dell-esportazione-gdpr-lungo';
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.registration.findMany.mockResolvedValue([]);
  prisma.profilePhoto.findUnique.mockResolvedValue(null);
  prisma.eventModerator.findMany.mockResolvedValue([]);
  prisma.captionSegment.findMany.mockResolvedValue([]);
});

describe('chi puo’ scaricare', () => {
  it('senza token e’ 400, e non si legge niente', async () => {
    expect((await chiedi()).status).toBe(400);
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
  });

  it('un token falso e’ 401', async () => {
    expect((await chiedi('?t=abc.def')).status).toBe(401);
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
  });

  it('il token della cancellazione non vale per l’esportazione', async () => {
    expect((await chiedi(`?t=${issueGdprToken('erasure', HASH)}`)).status).toBe(401);
  });

  it('un token scaduto e’ 401', async () => {
    const vecchio = issueGdprToken('export', HASH, new Date(Date.now() - 2 * 3_600_000));
    expect((await chiedi(`?t=${vecchio}`)).status).toBe(401);
  });

  it('un indirizzo che insiste viene fermato', async () => {
    const insistente = '10.2.9.9';
    for (let i = 0; i < 10; i += 1) await chiedi('', insistente);
    expect((await chiedi('', insistente)).status).toBe(429);
  });
});

describe('cosa si consegna', () => {
  it('cerca solo per l’impronta del token', async () => {
    await conToken();
    expect(prisma.registration.findMany.mock.calls[0]![0].where).toEqual({
      emailHash: HASH,
    });
    expect(prisma.profilePhoto.findUnique.mock.calls[0]![0].where).toEqual({
      emailHash: HASH,
    });
    expect(prisma.eventModerator.findMany.mock.calls[0]![0].where).toEqual({
      emailHash: HASH,
    });
  });

  it('i dati arrivano in chiaro, senza token e impronte', async () => {
    prisma.registration.findMany.mockResolvedValue([iscrizione('r1', 'e1')]);
    const r = await conToken();
    const testo = await r.text();
    const corpo = JSON.parse(testo) as {
      data: Array<{ registration: Record<string, unknown> }>;
    };
    expect(corpo.data[0]!.registration).toMatchObject({
      displayName: 'Anna Bianchi',
      email: 'anna@example.com',
      consentRecording: true,
    });
    expect(testo).not.toContain('token-segreto-di-accesso');
    expect(testo).not.toContain(HASH);
  });

  it('un’email che non si decifra non blocca il resto', async () => {
    prisma.registration.findMany.mockResolvedValue([
      iscrizione('r1', 'e1', { email: 'guasta' }),
    ]);
    const corpo = (await (await conToken()).json()) as {
      data: Array<{ registration: { email: string | null; displayName: string } }>;
    };
    expect(corpo.data[0]!.registration.email).toBeNull();
    expect(corpo.data[0]!.registration.displayName).toBe('Anna Bianchi');
  });

  it('senza iscrizioni restano foto e concessioni, e nessuna traccia', async () => {
    prisma.profilePhoto.findUnique.mockResolvedValue({
      contentType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
      createdAt: new Date('2026-10-01T08:00:00Z'),
    });
    const corpo = (await (await conToken()).json()) as {
      data: unknown[];
      profilePhoto: { dataUrl: string };
    };
    expect(corpo.data).toEqual([]);
    expect(corpo.profilePhoto.dataUrl).toBe('data:image/png;base64,AQID');
    expect(prisma.gdprAuditLog.create).not.toHaveBeenCalled();
  });

  it('una concessione dice il ruolo e la foto caricata dallo staff', async () => {
    const base = {
      name: encryptPII('Anna Bianchi'),
      organization: null,
      publicListed: true,
      createdAt: new Date('2026-10-01T08:00:00Z'),
      revokedAt: null,
      event: { title: { it: 'Evento' }, startsAt: new Date('2026-10-02T08:00:00Z') },
      photo: null,
      recordingConsents: [],
    };
    prisma.eventModerator.findMany.mockResolvedValue([
      { ...base, role: 'SPEAKER', organizer: false },
      { ...base, role: 'MODERATOR', organizer: true },
      {
        ...base,
        role: 'MODERATOR',
        organizer: false,
        photo: { contentType: 'image/png', bytes: new Uint8Array([1]) },
      },
    ]);
    const corpo = (await (await conToken()).json()) as {
      grants: Array<{ role: string; name: string; photo: string | null }>;
    };
    expect(corpo.grants.map((g) => g.role)).toEqual([
      'speaker',
      'organizer',
      'moderator',
    ]);
    expect(corpo.grants[0]!.name).toBe('Anna Bianchi');
    expect(corpo.grants[2]!.photo).toBe('data:image/png;base64,AQ==');
  });

  it('le frasi dei sottotitoli vanno all’iscrizione giusta, senza confondere gli id', async () => {
    prisma.registration.findMany.mockResolvedValue([
      iscrizione('abc', 'e1'),
      iscrizione('abcd', 'e1'),
    ]);
    prisma.captionSegment.findMany.mockResolvedValue([
      {
        seatId: 'reg-abc-1',
        text: encryptPII('la mia frase'),
        startedAt: new Date('2026-10-02T08:00:00Z'),
      },
      {
        seatId: 'reg-abcd-1',
        text: encryptPII('la frase altrui'),
        startedAt: new Date('2026-10-02T08:01:00Z'),
      },
    ]);
    const corpo = (await (await conToken()).json()) as {
      data: Array<{ liveTranscript: Array<{ text: string }> }>;
    };
    expect(corpo.data[0]!.liveTranscript.map((f) => f.text)).toEqual(['la mia frase']);
    expect(corpo.data[1]!.liveTranscript.map((f) => f.text)).toEqual(['la frase altrui']);
  });
});

describe('la completezza della consegna', () => {
  it('ci sono domande, voti, consensi dati in sala e il loro ritiro', async () => {
    const quando = new Date('2026-10-02T08:10:00Z');
    prisma.registration.findMany.mockResolvedValue([
      iscrizione('r1', 'e1', {
        joinedAt: quando,
        consentRecordingWithdrawnAt: quando,
        questions: [{ id: 'q1', text: 'Una domanda', status: 'OPEN', createdAt: quando }],
        pollVotes: [
          {
            id: 'v1',
            optionIndex: 1,
            createdAt: quando,
            poll: { question: 'Un sondaggio', options: ['a', 'b'] },
          },
        ],
        multitrackConsents: [{ consentedAt: quando, locale: 'it', withdrawnAt: quando }],
        recordingConsents: [{ consentedAt: quando, locale: 'en', withdrawnAt: null }],
      }),
    ]);
    const corpo = (await (await conToken()).json()) as {
      data: Array<{
        registration: Record<string, unknown>;
        questions: unknown[];
        pollVotes: unknown[];
      }>;
    };
    const ora = quando.toISOString();
    expect(corpo.data[0]!.questions).toEqual([
      { text: 'Una domanda', status: 'OPEN', createdAt: ora },
    ]);
    expect(corpo.data[0]!.pollVotes).toEqual([
      { question: 'Un sondaggio', optionIndex: 1, createdAt: ora },
    ]);
    expect(corpo.data[0]!.registration).toMatchObject({
      joinedAt: ora,
      consentRecordingWithdrawnAt: ora,
      multitrackConsentsInRoom: [{ consentedAt: ora, locale: 'it', withdrawnAt: ora }],
      recordingConsentsInRoom: [{ consentedAt: ora, locale: 'en', withdrawnAt: null }],
    });
  });
});

describe('la traccia della consegna', () => {
  it('una riga per evento, con un prefisso dell’impronta e mai l’indirizzo', async () => {
    prisma.registration.findMany.mockResolvedValue([
      iscrizione('r1', 'e1'),
      iscrizione('r2', 'e1'),
      iscrizione('r3', 'e2'),
    ]);
    await conToken();
    expect(prisma.gdprAuditLog.create).toHaveBeenCalledTimes(2);
    const riga = prisma.gdprAuditLog.create.mock.calls[0]![0].data as {
      action: string;
      details: string;
    };
    expect(riga.action).toBe('DATA_EXPORTED');
    expect(riga.details).toContain(HASH.slice(0, 8));
    expect(riga.details).not.toContain(HASH);
    expect(riga.details).not.toContain('anna');
  });
});
