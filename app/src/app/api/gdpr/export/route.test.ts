// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

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
    person: { findUnique: vi.fn() },
    retainedConsentProof: { findMany: vi.fn() },
    staffAccount: { findUnique: vi.fn() },
    event: { findMany: vi.fn() },
    recordingConsent: { findMany: vi.fn() },
    multitrackConsent: { findMany: vi.fn() },
    recording: { findMany: vi.fn() },
    recordingRedactionRequest: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn(async () => ({})) }));

import { encryptPII } from '@/lib/crypto/pii';
import { issueGdprToken, verifyGdprToken } from '@/lib/gdpr/request-token';
import { verifyRubricaOptOutToken } from '@/lib/persons/opt-out-token';
import { getSettings } from '@/lib/settings';

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
  prisma.person.findUnique.mockResolvedValue(null);
  prisma.retainedConsentProof.findMany.mockResolvedValue([]);
  prisma.staffAccount.findUnique.mockResolvedValue(null);
  prisma.event.findMany.mockResolvedValue([]);
  prisma.recordingConsent.findMany.mockResolvedValue([]);
  prisma.multitrackConsent.findMany.mockResolvedValue([]);
  prisma.recording.findMany.mockResolvedValue([]);
  prisma.recordingRedactionRequest.findMany.mockResolvedValue([]);
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

describe('testo letto', () => {
  it('riporta la spunta della rubrica che aspetta la conferma', async () => {
    prisma.registration.findMany.mockResolvedValue([
      iscrizione('r1', 'e1', { addressBookPending: true }),
    ]);
    const corpo = (await (await conToken()).json()) as {
      data: Array<{ registration: Record<string, unknown> }>;
    };
    expect(corpo.data[0]!.registration.addressBookPending).toBe(true);
  });

  it('propone la conferma solo dove la rubrica si propone ancora', async () => {
    const base = iscrizione('r3', 'e3').event;
    prisma.registration.findMany.mockResolvedValue([
      iscrizione('r1', 'e1', { addressBookPending: true }),
      iscrizione('r2', 'e2', {
        addressBookPending: true,
        event: { ...base, offerAddressBook: false },
      }),
    ]);
    const legge = async () => {
      const corpo = (await (await conToken()).json()) as {
        data: Array<{
          registration: {
            addressBookPending: boolean;
            consents: { addressBookPending: boolean };
          };
        }>;
      };
      return corpo.data.map((d) => [
        d.registration.addressBookPending,
        d.registration.consents.addressBookPending,
      ]);
    };

    expect(await legge()).toEqual([
      [true, true],
      [true, false],
    ]);

    vi.mocked(getSettings).mockResolvedValueOnce({ addressBookEnabled: false } as never);
    expect(await legge()).toEqual([
      [true, false],
      [true, false],
    ]);
  });

  it('dice quali consensi si danno di nuovo: solo finche’ l’evento li chiede', async () => {
    vi.stubEnv('RECORDING_VOICE_EXCLUSION', 'true');
    vi.stubEnv('RECORDING_PARTICIPANT_VOICE', 'true');
    const evento = (campi: Record<string, unknown>) => ({
      ...iscrizione('x', 'x').event,
      eventType: 'SCHEDULED',
      recordingEnabled: true,
      participantsCanUnmute: true,
      recordingDestination: 'PUBLIC',
      recordingConsentText: 'Testo dell’ente',
      ...campi,
    });
    prisma.registration.findMany.mockResolvedValue([
      iscrizione('r1', 'e1', {
        event: evento({ status: 'PUBLISHED', endsAt: new Date(Date.now() + 3_600_000) }),
      }),
      iscrizione('r2', 'e2', { event: evento({ status: 'ENDED' }) }),
    ]);
    const corpo = (await (await conToken()).json()) as {
      data: Array<{ registration: { consentOffer: Record<string, unknown> } }>;
    };
    vi.unstubAllEnvs();
    expect(corpo.data[0]!.registration.consentOffer).toEqual({
      recording: {
        destination: 'PUBLIC',
        voice: 'rimovibile',
        participants: 'solo-voce',
        eventText: 'Testo dell’ente',
        // Il consenso all'iscrizione non dichiara la destinazione: non copre un
        // video pubblico, e va dato di nuovo.
        inForce: false,
      },
      transcription: null,
      futureCommunications: true,
    });
    expect(corpo.data[1]!.registration.consentOffer).toMatchObject({
      recording: null,
      transcription: null,
    });
  });

  it('riporta la destinazione e la versione del consenso alla registrazione', async () => {
    prisma.registration.findMany.mockResolvedValue([
      iscrizione('r1', 'e1', {
        consentRecordingDestination: 'REGISTRANTS',
        consentRecordingVersion: 1,
        recordingConsents: [
          {
            consentedAt: new Date('2026-10-02T08:00:00Z'),
            locale: 'it',
            withdrawnAt: null,
            destination: 'PUBLIC',
            textVersion: 1,
          },
        ],
      }),
    ]);
    const corpo = (await (await conToken()).json()) as {
      data: Array<{ registration: Record<string, unknown> }>;
    };
    expect(corpo.data[0]!.registration).toMatchObject({
      consentRecordingDestination: 'REGISTRANTS',
      consentRecordingVersion: 1,
      recordingConsentsInRoom: [{ destination: 'PUBLIC', textVersion: 1 }],
    });
  });
});

describe('rimozione da una registrazione', () => {
  it('dice dove si puo’ chiedere e lo stato delle richieste fatte, senza altri dati', async () => {
    prisma.registration.findMany.mockResolvedValue([iscrizione('r1', 'e1'), iscrizione('r2', 'e2')]);
    prisma.recording.findMany.mockResolvedValue([
      { eventId: 'e1', blobKey: 'recordings/sala.mp4', mediaStartedAt: null },
      // Una registrazione con la sola trascrizione dai sottotitoli non ha media.
      { eventId: 'e2', blobKey: '', mediaStartedAt: null },
    ]);
    prisma.recordingRedactionRequest.findMany.mockResolvedValue([
      {
        registrationId: 'r1',
        status: 'CLOSED',
        createdAt: new Date('2026-11-01T08:00:00Z'),
        closedAt: new Date('2026-11-03T08:00:00Z'),
      },
    ]);
    const corpo = (await (await conToken()).json()) as {
      data: Array<{ registration: { recordingRemoval: unknown } }>;
    };
    expect(corpo.data[0]!.registration.recordingRemoval).toEqual({
      available: true,
      requests: [
        { status: 'CLOSED', createdAt: '2026-11-01T08:00:00.000Z', closedAt: '2026-11-03T08:00:00.000Z' },
      ],
    });
    expect(corpo.data[1]!.registration.recordingRemoval).toEqual({ available: false, requests: [] });
    expect(prisma.recordingRedactionRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { emailHash: HASH, registrationId: { not: null } } }),
    );
  });
});

const prova = () => ({
  id: 'p1',
  eventId: 'e9',
  kind: 'recording',
  source: 'room',
  role: 'registrant',
  displayName: encryptPII('Anna Bianchi'),
  nameRemovedAt: null,
  locale: 'it',
  textVersion: 1,
  destination: 'PUBLIC',
  givenAt: new Date('2026-09-01T08:00:00Z'),
  withdrawnAt: null,
  retainedAt: new Date('2026-10-30T03:00:00Z'),
  event: { title: { it: 'Evento passato' }, startsAt: new Date('2026-09-02T08:00:00Z') },
});

describe('prove dei consensi conservate', () => {
  it('chi ha solo prove le vede, puo’ ritirarle e lascia una traccia', async () => {
    prisma.retainedConsentProof.findMany.mockResolvedValue([prova()]);
    const testo = await (await conToken()).text();
    const corpo = JSON.parse(testo) as {
      data: unknown[];
      consentsToken: string;
      retainedConsentProofs: Array<Record<string, unknown>>;
    };
    expect(corpo.data).toEqual([]);
    expect(corpo.retainedConsentProofs).toEqual([
      expect.objectContaining({
        id: 'p1',
        eventId: 'e9',
        kind: 'recording',
        name: 'Anna Bianchi',
        nameRemoved: false,
        givenAt: '2026-09-01T08:00:00.000Z',
        withdrawnAt: null,
        event: { title: { it: 'Evento passato' }, startsAt: '2026-09-02T08:00:00.000Z' },
      }),
    ]);
    expect(prisma.retainedConsentProof.findMany.mock.calls[0]![0].where).toEqual({
      emailHash: HASH,
    });
    expect(verifyGdprToken(corpo.consentsToken, 'consents')).toEqual({ emailHash: HASH });
    expect(prisma.gdprAuditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.gdprAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      eventId: 'e9',
      action: 'DATA_EXPORTED',
    });
    expect(testo).not.toContain(HASH);
  });

  it('una prova senza nome resta senza nome', async () => {
    prisma.retainedConsentProof.findMany.mockResolvedValue([
      {
        ...prova(),
        displayName: null,
        nameRemovedAt: new Date('2026-10-31T08:00:00Z'),
        withdrawnAt: new Date('2026-10-31T08:00:00Z'),
      },
    ]);
    const corpo = (await (await conToken()).json()) as {
      retainedConsentProofs: Array<Record<string, unknown>>;
    };
    expect(corpo.retainedConsentProofs[0]).toMatchObject({ name: null, nameRemoved: true });
  });

  it('accanto alle iscrizioni: una riga di registro per evento, senza doppioni', async () => {
    prisma.registration.findMany.mockResolvedValue([iscrizione('r1', 'e1')]);
    prisma.retainedConsentProof.findMany.mockResolvedValue([
      { ...prova(), id: 'p1', eventId: 'e1' },
      { ...prova(), id: 'p2', eventId: 'e9' },
    ]);
    const corpo = (await (await conToken()).json()) as { retainedConsentProofs: unknown[] };
    expect(corpo.retainedConsentProofs).toHaveLength(2);
    const eventi = prisma.gdprAuditLog.create.mock.calls.map((c) => c[0].data.eventId);
    expect(eventi).toEqual(['e1', 'e9']);
  });

  it('senza niente non consegna il token per ritirare', async () => {
    const corpo = (await (await conToken()).json()) as Record<string, unknown>;
    expect(corpo).toEqual({
      data: [],
      profilePhoto: null,
      grants: [],
      addressBook: null,
      retainedConsentProofs: [],
      roomConsentProofs: [],
    });
  });
});

const VOCE_ID = '55555555-5555-4555-8555-555555555555';
const voce = () => ({
  id: VOCE_ID,
  displayName: encryptPII('Anna Bianchi'),
  email: encryptPII('anna@example.com'),
  organization: 'Comune',
  organizationRole: null,
  organizationType: null,
  optedInToAddressBook: true,
  optedInAt: new Date('2026-01-31T08:00:00Z'),
  optedOutAt: null,
  retentionMonths: 24,
});

describe('rubrica', () => {
  it('chi e’ solo in rubrica vede i suoi dati, la scadenza e il modo di uscirne', async () => {
    prisma.person.findUnique.mockResolvedValue(voce());
    const testo = await (await conToken()).text();
    const corpo = JSON.parse(testo) as {
      data: unknown[];
      addressBook: Record<string, unknown> & { optOutToken: string };
    };
    expect(prisma.person.findUnique.mock.calls[0]![0].where).toEqual({ emailHash: HASH });
    expect(corpo.data).toEqual([]);
    expect(corpo.addressBook).toMatchObject({
      name: 'Anna Bianchi',
      email: 'anna@example.com',
      organization: 'Comune',
      optedIn: true,
      optedInAt: '2026-01-31T08:00:00.000Z',
      optedOutAt: null,
      expiresAt: '2028-01-31T08:00:00.000Z',
    });
    expect(verifyRubricaOptOutToken(corpo.addressBook.optOutToken)).toEqual({
      personId: VOCE_ID,
    });
    expect(testo).not.toContain(HASH);
  });

  it('accanto alle iscrizioni c’e’ lo stesso blocco', async () => {
    prisma.person.findUnique.mockResolvedValue(voce());
    prisma.registration.findMany.mockResolvedValue([iscrizione('r1', 'e1')]);
    const corpo = (await (await conToken()).json()) as {
      addressBook: Record<string, unknown>;
    };
    expect(corpo.addressBook).toMatchObject({ email: 'anna@example.com' });
  });

  it('chi ne e’ uscito vede il ritiro, senza scadenza e senza token', async () => {
    prisma.person.findUnique.mockResolvedValue({
      ...voce(),
      optedInToAddressBook: false,
      optedOutAt: new Date('2026-03-01T08:00:00Z'),
    });
    const corpo = (await (await conToken()).json()) as {
      addressBook: Record<string, unknown>;
    };
    expect(corpo.addressBook).toMatchObject({
      optedIn: false,
      optedOutAt: '2026-03-01T08:00:00.000Z',
      expiresAt: null,
      optOutToken: null,
    });
  });

  it('una voce senza data di consenso non ha una scadenza inventata', async () => {
    prisma.person.findUnique.mockResolvedValue({ ...voce(), optedInAt: null, email: null });
    const corpo = (await (await conToken()).json()) as {
      addressBook: Record<string, unknown>;
    };
    expect(corpo.addressBook).toMatchObject({ expiresAt: null, email: null });
  });
});

describe('le prove di sala di chi conduce', () => {
  const prova = (altri: Record<string, unknown>) => ({
    eventId: 'ev-sala',
    jitsiUserId: 'mod-ev-sala-aa',
    displayName: encryptPII('Ada Rossi'),
    registrationId: null,
    eventModeratorId: null,
    staffAccountId: null,
    emailHash: null,
    locale: 'it',
    consentedAt: new Date('2026-10-02T08:00:00Z'),
    withdrawnAt: null,
    textVersion: 2,
    registration: null,
    eventModerator: null,
    staffAccount: null,
    ...altri,
  });
  beforeEach(() => {
    prisma.event.findMany.mockResolvedValue([
      { id: 'ev-sala', title: { it: 'Riunione' }, startsAt: new Date('2026-10-02T08:00:00Z') },
    ]);
  });
  const leggi = async () =>
    (await (await conToken()).json()) as {
      roomConsentProofs: Array<Record<string, unknown>>;
    };

  it('consegna la trascrizione data con una concessione, con gli stessi legami della cancellazione', async () => {
    prisma.eventModerator.findMany.mockResolvedValue([
      {
        id: 'grant-1',
        name: encryptPII('Ada Rossi'),
        role: 'SPEAKER',
        organizer: false,
        organization: null,
        publicListed: false,
        createdAt: new Date('2026-10-01T08:00:00Z'),
        revokedAt: null,
        event: { title: { it: 'Riunione' }, startsAt: new Date('2026-10-02T08:00:00Z') },
        photo: null,
        recordingConsents: [],
      },
    ]);
    prisma.multitrackConsent.findMany.mockResolvedValue([
      prova({ eventModeratorId: 'grant-1' }),
    ]);

    const { roomConsentProofs } = await leggi();

    expect(prisma.multitrackConsent.findMany.mock.calls[0]![0].where).toEqual({
      OR: [
        { registrationId: { in: [] } },
        { eventModeratorId: { in: ['grant-1'] } },
        { staffAccountId: { in: [] } },
        { emailHash: HASH },
      ],
    });
    expect(roomConsentProofs).toEqual([
      {
        eventId: 'ev-sala',
        kind: 'transcription',
        name: 'Ada Rossi',
        locale: 'it',
        textVersion: 2,
        destination: null,
        givenAt: '2026-10-02T08:00:00.000Z',
        withdrawnAt: null,
        superseded: false,
        event: { title: { it: 'Riunione' }, startsAt: '2026-10-02T08:00:00.000Z' },
      },
    ]);
  });

  it('trova le prove di un account dello staff, e l’evento finisce nel registro', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({ id: 'acc-1' });
    prisma.recordingConsent.findMany.mockResolvedValue([
      prova({ staffAccountId: 'acc-1', destination: 'PUBLIC', earlierPeriods: null }),
    ]);

    const { roomConsentProofs } = await leggi();

    expect(prisma.recordingConsent.findMany.mock.calls[0]![0].where.OR).toContainEqual({
      staffAccountId: { in: ['acc-1'] },
    });
    expect(roomConsentProofs).toMatchObject([{ kind: 'recording', destination: 'PUBLIC' }]);
    expect(prisma.gdprAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventId: 'ev-sala', action: 'DATA_EXPORTED' }),
    });
  });

  it('una prova con l’impronta resta anche senza legami, e quella di un’iscrizione arriva con l’iscrizione', async () => {
    prisma.multitrackConsent.findMany.mockResolvedValue([
      prova({ emailHash: HASH }),
      prova({
        emailHash: HASH,
        jitsiUserId: 'ospite-1',
        registrationId: 'r1',
      }),
    ]);

    const { roomConsentProofs } = await leggi();

    expect(roomConsentProofs).toHaveLength(1);
  });

  it('chi ha solo queste prove le riceve anche con un’iscrizione', async () => {
    prisma.registration.findMany.mockResolvedValue([iscrizione('r1', 'ev-1')]);
    prisma.multitrackConsent.findMany.mockResolvedValue([prova({ emailHash: HASH })]);

    const { roomConsentProofs } = await leggi();

    expect(roomConsentProofs).toHaveLength(1);
  });
});
