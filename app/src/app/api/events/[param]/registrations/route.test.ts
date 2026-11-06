// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Chi può iscriversi quando l'amministrazione spegne l'iscrizione pubblica.
 *
 * Spenta, l'elenco degli invitati dell'evento diventa l'elenco di chi può
 * iscriversi, e il link personale lo consegna solo l'email: chi compila il
 * modulo non ha provato di possedere l'indirizzo. La risposta è la stessa per
 * chiunque, così da qui non si scopre chi è invitato; chi era già iscritto
 * riceve di nuovo il link nella propria casella.
 */
import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { siteSettings, tx } = vi.hoisted(() => ({
  siteSettings: {
    publicRegistrationEnabled: true,
    addressBookEnabled: true,
    aiPipelineEnabled: false,
  },
  tx: {
    registration: { findUnique: vi.fn(), create: vi.fn() },
    gdprAuditLog: { create: vi.fn() },
    eventInvitation: { findFirst: vi.fn() },
    person: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock('@/lib/settings', () => ({ getSettings: async () => siteSettings }));
vi.mock('@/lib/persons', () => ({ upsertPersonOnRegistration: vi.fn(async () => null) }));
vi.mock('@/lib/persons/inviti-fermati', () => ({
  indirizzoFermato: vi.fn(async () => false),
}));
vi.mock('@/lib/email/confirmation', () => ({ sendConfirmationEmail: vi.fn() }));
vi.mock('@/lib/questionnaires', async (importOriginal) => ({
  ...(await importOriginal<typeof Questionari>()),
  findEventQuestionnaireByPlacement: vi.fn(async () => null),
  writeResponse: vi.fn(async () => ({ id: 'resp-1', created: true })),
}));

import { prisma } from '@/lib/db';
import { hashEmail } from '@/lib/crypto/pii';
import { sendConfirmationEmail } from '@/lib/email/confirmation';
import { verifyRegistrationEntry } from '@/lib/events/registration-link';
import { upsertPersonOnRegistration } from '@/lib/persons';
import { indirizzoFermato } from '@/lib/persons/inviti-fermati';
import { findEventQuestionnaireByPlacement, writeResponse } from '@/lib/questionnaires';
import type * as Questionari from '@/lib/questionnaires';

import { POST } from './route';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const SLUG = 'evento-di-prova';

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.APP_SECRET = 'test-app-secret-per-la-rotta-delle-iscrizioni';
  process.env.NEXT_PUBLIC_APP_URL = 'https://webinar.example.gov.it';
});

let ipCounter = 0;

function iscriviti(email: string, extra: Record<string, unknown> = {}): Promise<Response> {
  ipCounter += 1;
  const request = new Request(`http://localhost:3000/api/events/${SLUG}/registrations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.1.0.${ipCounter}`,
    },
    body: JSON.stringify({ displayName: 'Anna Bianchi', email, consentGiven: true, ...extra }),
  });
  return POST(request as unknown as NextRequest, {
    params: Promise.resolve({ param: SLUG }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  siteSettings.publicRegistrationEnabled = true;
  siteSettings.addressBookEnabled = true;
  siteSettings.aiPipelineEnabled = false;
  vi.mocked(prisma.event.findUnique).mockResolvedValue({
    id: EVENT_ID,
    slug: SLUG,
    status: 'PUBLISHED',
    eventType: 'SCHEDULED',
    endsAt: new Date(Date.now() + 3_600_000),
    recordingEnabled: false,
    multitrackRecordingEnabled: false,
    _count: { registrations: 0 },
  } as never);
  tx.registration.findUnique.mockResolvedValue(null);
  tx.registration.create.mockImplementation(async ({ data }: { data: object }) => ({
    id: 'reg-1',
    ...data,
  }));
  tx.gdprAuditLog.create.mockResolvedValue({});
  tx.eventInvitation.findFirst.mockResolvedValue(null);
  tx.person.findUnique.mockResolvedValue(null);
  vi.mocked(findEventQuestionnaireByPlacement).mockResolvedValue(null);
  vi.mocked(writeResponse).mockResolvedValue({ id: 'resp-1', created: true });
});

/** Il link personale passato all'email, come oggetto URL. */
function linkEmail(): URL {
  const input = vi.mocked(sendConfirmationEmail).mock.calls[0]?.[0];
  if (!input) throw new Error('nessuna email accodata');
  return new URL(input.joinUrl);
}

describe('POST registrations — iscrizione pubblica', () => {
  it('accesa: chiunque si iscrive, senza guardare gli inviti', async () => {
    const res = await iscriviti('anna@example.com');
    expect(res.status).toBe(201);
    expect(tx.eventInvitation.findFirst).not.toHaveBeenCalled();
  });

  it("accesa: token, link e cookie nella risposta; nell'email il link firmato", async () => {
    const res = await iscriviti('anna@example.com');
    const body = (await res.json()) as { accessToken: string; joinUrl: string };
    expect(body.accessToken).toBeTruthy();
    expect(body.joinUrl).toContain(`/live?token=${body.accessToken}`);
    // La firma prova che l'indirizzo e' di chi apre l'email: non esce mai
    // nella risposta al modulo.
    expect(body.joinUrl).not.toContain('sig=');
    expect(res.headers.get('Set-Cookie')).toContain(`event_access_${EVENT_ID}=`);
    const link = linkEmail();
    expect(link.pathname).toBe(`/api/events/${SLUG}/registrations/enter`);
    expect(link.searchParams.get('token')).toBe(body.accessToken);
    // Iscrizione pubblica: la firma che prova l'indirizzo, non quella che lega.
    expect(link.searchParams.get('proof')).toBeTruthy();
    expect(link.searchParams.get('sig')).toBeNull();
  });

  it('accesa: un indirizzo già iscritto riceve «già iscritto»', async () => {
    tx.registration.findUnique.mockResolvedValue({
      id: 'reg-vecchia',
      accessToken: 'tok-vecchio',
      locale: 'it',
    });
    const res = await iscriviti('anna@example.com');
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('ALREADY_REGISTERED');
  });
});

describe('POST registrations — iscrizione pubblica spenta', () => {
  beforeEach(() => {
    siteSettings.publicRegistrationEnabled = false;
  });

  /** La risposta uguale per chiunque: niente token, link o cookie. */
  async function rispostaNeutra(res: Response) {
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ eventSlug: SLUG, delivery: 'email' });
    expect(res.headers.get('Set-Cookie')).toBeNull();
  }

  it('un indirizzo non invitato: risposta neutra, nessuna iscrizione, nessuna email', async () => {
    const res = await iscriviti('anna@example.com');
    await rispostaNeutra(res);
    expect(tx.registration.create).not.toHaveBeenCalled();
    expect(sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('un indirizzo invitato si iscrive, cercato per impronta e senza badare a maiuscole', async () => {
    tx.eventInvitation.findFirst.mockResolvedValue({ id: 'inv-1' });

    const res = await iscriviti('Anna@Example.com');
    await rispostaNeutra(res);
    expect(tx.registration.create).toHaveBeenCalledTimes(1);
    const where = tx.eventInvitation.findFirst.mock.calls[0]?.[0]?.where as {
      eventId: string;
      OR: Array<Record<string, unknown>>;
    };
    expect(where.eventId).toBe(EVENT_ID);
    expect(where.OR).toContainEqual({ emailHash: hashEmail('anna@example.com') });
  });

  it("l'invitato riceve il link solo per email, firmato per legare il browser che lo apre", async () => {
    tx.eventInvitation.findFirst.mockResolvedValue({ id: 'inv-1' });

    await iscriviti('anna@example.com');
    const token = tx.registration.create.mock.calls[0]?.[0]?.data?.accessToken as string;
    const link = linkEmail();
    expect(link.pathname).toBe(`/api/events/${SLUG}/registrations/enter`);
    expect(link.searchParams.get('token')).toBe(token);
    expect(verifyRegistrationEntry(EVENT_ID, token, link.searchParams.get('sig') ?? '')).toBe(true);
    // Gli eventi di calendario, che si inoltrano, hanno il link della sala.
    const calendario = vi.mocked(sendConfirmationEmail).mock.calls[0]?.[0]?.calendarJoinUrl ?? '';
    expect(new URL(calendario).pathname).toBe(`/it/eventi/${SLUG}/live`);
    expect(new URL(calendario).searchParams.has('sig')).toBe(false);
  });

  it('chi si era già iscritto: risposta neutra e il suo link di nuovo nella sua casella', async () => {
    tx.registration.findUnique.mockResolvedValue({
      id: 'reg-vecchia',
      accessToken: 'tok-vecchio',
      locale: 'en',
    });

    const res = await iscriviti('anna@example.com');
    await rispostaNeutra(res);
    expect(tx.registration.create).not.toHaveBeenCalled();
    // Già iscritto non vuol dire invitato: non si guarda l'elenco.
    expect(tx.eventInvitation.findFirst).not.toHaveBeenCalled();
    const input = vi.mocked(sendConfirmationEmail).mock.calls[0]?.[0];
    expect(input?.registrationId).toBe('reg-vecchia');
    // Nella lingua dell'iscrizione, non in quella di chi ha compilato ora.
    expect(input?.locale).toBe('en');
    expect(linkEmail().searchParams.get('token')).toBe('tok-vecchio');
  });
});

describe('POST registrations — l ente quando l evento lo chiede', () => {
  it('senza ente: 422, nessuna iscrizione', async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValue({
      id: EVENT_ID,
      slug: SLUG,
      status: 'PUBLISHED',
      eventType: 'SCHEDULED',
      endsAt: new Date(Date.now() + 3_600_000),
      recordingEnabled: false,
      multitrackRecordingEnabled: false,
      requireOrganization: true,
      accessMode: null,
      _count: { registrations: 0 },
    } as never);
    const res = await iscriviti('anna@example.com');
    expect(res.status).toBe(422);
    expect(tx.registration.create).not.toHaveBeenCalled();
  });
});

describe('POST registrations — la scelta dell evento vale sopra quella del sito', () => {
  function evento(accessMode: 'OPEN' | 'INVITATION') {
    vi.mocked(prisma.event.findUnique).mockResolvedValue({
      id: EVENT_ID,
      slug: SLUG,
      status: 'PUBLISHED',
      eventType: 'SCHEDULED',
      endsAt: new Date(Date.now() + 3_600_000),
      recordingEnabled: false,
      multitrackRecordingEnabled: false,
      accessMode,
      _count: { registrations: 0 },
    } as never);
  }

  it('solo su invito, con il sito aperto: chi non e invitato non si iscrive', async () => {
    siteSettings.publicRegistrationEnabled = true;
    evento('INVITATION');
    const res = await iscriviti('anna@example.com');
    expect(res.status).toBe(202);
    expect(tx.registration.create).not.toHaveBeenCalled();
    expect(sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('aperto, con il sito solo su invito: chiunque si iscrive', async () => {
    siteSettings.publicRegistrationEnabled = false;
    evento('OPEN');
    const res = await iscriviti('anna@example.com');
    expect(res.status).toBe(201);
    expect(tx.registration.create).toHaveBeenCalledTimes(1);
    expect(tx.eventInvitation.findFirst).not.toHaveBeenCalled();
  });
});

describe('POST registrations — consensi secondo il formato dell\'evento', () => {
  function evento(over: Record<string, unknown>) {
    vi.mocked(prisma.event.findUnique).mockResolvedValue({
      id: EVENT_ID,
      slug: SLUG,
      status: 'PUBLISHED',
      eventType: 'SCHEDULED',
      endsAt: new Date(Date.now() + 3_600_000),
      recordingEnabled: true,
      multitrackRecordingEnabled: true,
      participantsCanUnmute: false,
      participantsCanStartVideo: false,
      participantsCanShareScreen: false,
      _count: { registrations: 0 },
      ...over,
    } as never);
  }

  function iscrivitiCon(consensi: Record<string, unknown>): Promise<Response> {
    ipCounter += 1;
    const request = new Request(`http://localhost:3000/api/events/${SLUG}/registrations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.2.0.${ipCounter}` },
      body: JSON.stringify({ displayName: 'Anna Bianchi', email: 'anna@example.com', consentGiven: true, ...consensi }),
    });
    return POST(request as unknown as NextRequest, { params: Promise.resolve({ param: SLUG }) });
  }

  it('solo ascolto: niente consenso alla registrazione, la trascrizione si chiede ma e\' facoltativa', async () => {
    evento({});
    const senza = await iscrivitiCon({});
    expect(senza.status).toBe(201);
    expect((tx.registration.create.mock.calls[0]?.[0]?.data as Record<string, unknown>).consentMultitrack).toBe(false);
    tx.registration.create.mockClear();
    tx.gdprAuditLog.create.mockClear();
    const res = await iscrivitiCon({ consentMultitrack: true });
    expect(res.status).toBe(201);
    const data = tx.registration.create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.consentRecording).toBeNull();
    expect(data.consentMultitrack).toBe(true);
    const audit = JSON.parse(
      (tx.gdprAuditLog.create.mock.calls[0]?.[0] as { data: { details: string } }).data.details,
    );
    expect(audit.recordingConsentRequired).toBe(false);
  });

  it('con il microfono concesso la registrazione si chiede, ma non e\' mai una condizione', async () => {
    evento({ participantsCanUnmute: true });
    expect((await iscrivitiCon({})).status).toBe(201);
    expect((await iscrivitiCon({ consentRecording: true })).status).toBe(201);
    const ok = await iscrivitiCon({ consentRecording: true, consentMultitrack: true });
    expect(ok.status).toBe(201);
  });

  it('con il solo schermo condiviso si chiede il consenso alla registrazione', async () => {
    evento({ participantsCanShareScreen: true, multitrackRecordingEnabled: false });
    expect((await iscrivitiCon({})).status).toBe(201);
    expect((await iscrivitiCon({ consentRecording: true })).status).toBe(201);
  });

  it('dove la voce resta fuori dal video, senza registrazione la trascrizione non vale', async () => {
    vi.stubEnv('JIBRI_HEALTH_URL', 'http://jibri');
    vi.stubEnv('RECORDING_VOICE_EXCLUSION', 'true');
    try {
      evento({ participantsCanUnmute: true });
      expect((await iscrivitiCon({ consentMultitrack: true })).status).toBe(201);
      const data = tx.registration.create.mock.calls.at(-1)?.[0]?.data as Record<string, unknown>;
      expect(data.consentMultitrack).toBe(false);
      expect(data.consentMultitrackVersion).toBeNull();
      await iscrivitiCon({ consentRecording: true, consentMultitrack: true });
      const dopo = tx.registration.create.mock.calls.at(-1)?.[0]?.data as Record<string, unknown>;
      expect(dopo.consentMultitrack).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('dove l\'installazione non puo\' registrare il consenso alla registrazione non si chiede', async () => {
    // Jitsi del chart, senza Jibri, senza registratore per partecipante e senza storage.
    vi.stubEnv('JITSI_WEB_INTERNAL_URL', 'http://jitsi-web');
    vi.stubEnv('JIBRI_HEALTH_URL', '');
    vi.stubEnv('RECORDER_CONTROLLER_URL', '');
    try {
      evento({ participantsCanUnmute: true, multitrackRecordingEnabled: false });
      expect((await iscrivitiCon({})).status).toBe(201);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/** L'evento della prova: PUBLISHED e con la registrazione spenta, salvo `over`. */
function eventoCon(over: Record<string, unknown>) {
  vi.mocked(prisma.event.findUnique).mockResolvedValue({
    id: EVENT_ID,
    slug: SLUG,
    status: 'PUBLISHED',
    eventType: 'SCHEDULED',
    endsAt: new Date(Date.now() + 3_600_000),
    recordingEnabled: false,
    multitrackRecordingEnabled: false,
    participantsCanUnmute: false,
    participantsCanStartVideo: false,
    participantsCanShareScreen: false,
    _count: { registrations: 0 },
    ...over,
  } as never);
}

const iscrizioneScritta = () =>
  tx.registration.create.mock.calls.at(-1)?.[0]?.data as Record<string, unknown>;
const auditScritto = () =>
  JSON.parse(
    (tx.gdprAuditLog.create.mock.calls.at(-1)?.[0] as { data: { details: string } }).data.details,
  ) as Record<string, unknown>;

/** Jitsi del chart, con il solo registratore per partecipante: nessun video. */
function senzaVideo() {
  vi.stubEnv('JITSI_WEB_INTERNAL_URL', 'http://jitsi-web');
  vi.stubEnv('JIBRI_HEALTH_URL', '');
  vi.stubEnv('RECORDER_CONTROLLER_URL', 'http://recorder-controller');
}

describe('POST registrations — presa visione dell\'informativa', () => {
  it('senza la spunta: 422 con il suo messaggio, nessuna iscrizione', async () => {
    const res = await iscriviti('anna@example.com', { consentGiven: false });
    expect(res.status).toBe(422);
    const corpo = (await res.json()) as { details: Array<{ path: string[]; message: string }> };
    expect(corpo.details).toEqual([
      { path: ['consentGiven'], message: 'registration.errors.consentRequired' },
    ]);
    expect(tx.registration.create).not.toHaveBeenCalled();
  });

  it('con la spunta il corpo resta consentGiven: true, e si salva con l\'ora', async () => {
    expect((await iscriviti('anna@example.com')).status).toBe(201);
    expect(iscrizioneScritta().consentGiven).toBe(true);
    expect(iscrizioneScritta().consentTimestamp).toBeInstanceOf(Date);
    expect(auditScritto().consentGiven).toBe(true);
  });
});

describe('POST registrations — dove non si registra niente', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('un consenso in arrivo non si salva: niente video e niente tracce', async () => {
    senzaVideo();
    eventoCon({ recordingEnabled: true, participantsCanUnmute: true });
    const res = await iscriviti('anna@example.com', { consentRecording: true });
    expect(res.status).toBe(201);
    expect(iscrizioneScritta()).toMatchObject({ consentRecording: null, consentMultitrack: null });
  });

  it('con le sole tracce il consenso resta', async () => {
    senzaVideo();
    eventoCon({
      recordingEnabled: true,
      participantsCanUnmute: true,
      multitrackRecordingEnabled: true,
      aiTranscriptEnabled: true,
    });
    const res = await iscriviti('anna@example.com', { consentRecording: true });
    expect(res.status).toBe(201);
    expect(iscrizioneScritta().consentRecording).toBe(true);
  });
});

describe('POST registrations — la destinazione del video nel consenso', () => {
  const conRegistrazione = (recordingDestination: 'PUBLIC' | 'REGISTRANTS' | null) =>
    eventoCon({ recordingEnabled: true, participantsCanUnmute: true, recordingDestination });

  const errore = async (res: Response) =>
    ((await res.json()) as { details?: Array<{ path: string[]; message: string }> }).details;

  it('con il consenso salva il testo letto e la sua versione, anche nell\'audit', async () => {
    conRegistrazione('REGISTRANTS');
    const res = await iscriviti('anna@example.com', {
      consentRecording: true,
      consentRecordingDestination: 'REGISTRANTS',
    });
    expect(res.status).toBe(201);
    expect(iscrizioneScritta()).toMatchObject({
      consentRecording: true,
      consentRecordingDestination: 'REGISTRANTS',
      consentRecordingVersion: 1,
    });
    expect(auditScritto()).toMatchObject({
      consentRecordingDestination: 'REGISTRANTS',
      consentRecordingVersion: 1,
    });
  });

  it('senza consenso destinazione e versione restano nulle', async () => {
    conRegistrazione('PUBLIC');
    const res = await iscriviti('anna@example.com', {
      consentRecording: false,
      consentRecordingDestination: 'PUBLIC',
    });
    expect(res.status).toBe(201);
    expect(iscrizioneScritta()).toMatchObject({
      consentRecording: false,
      consentRecordingDestination: null,
      consentRecordingVersion: null,
    });
    expect(auditScritto()).toMatchObject({
      consentRecordingDestination: null,
      consentRecordingVersion: null,
    });
  });

  it.each([
    ['allargata', 'REGISTRANTS', 'PUBLIC'],
    ['ristretta', 'PUBLIC', 'REGISTRANTS'],
    ['dichiarata dopo', null, 'PUBLIC'],
    ['non piu\' dichiarata', 'REGISTRANTS', null],
  ] as const)('destinazione %s a pagina aperta: 422 sulla casella', async (_nome, letta, evento) => {
    conRegistrazione(evento);
    const res = await iscriviti('anna@example.com', {
      consentRecording: true,
      consentRecordingDestination: letta,
    });
    expect(res.status).toBe(422);
    expect(await errore(res)).toEqual([
      { path: ['consentRecording'], message: 'registration.errors.recordingDestinationChanged' },
    ]);
    expect(tx.registration.create).not.toHaveBeenCalled();
    expect(sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('il testo cambiato non ferma chi non ha spuntato la casella', async () => {
    conRegistrazione('PUBLIC');
    const res = await iscriviti('anna@example.com', {
      consentRecording: false,
      consentRecordingDestination: 'REGISTRANTS',
    });
    expect(res.status).toBe(201);
    expect(iscrizioneScritta().consentRecordingDestination).toBeNull();
  });

  it('una pagina aperta prima del campo vale per il testo in vigore', async () => {
    conRegistrazione('PUBLIC');
    const res = await iscriviti('anna@example.com', { consentRecording: true });
    expect(res.status).toBe(201);
    expect(iscrizioneScritta()).toMatchObject({
      consentRecordingDestination: 'PUBLIC',
      consentRecordingVersion: 1,
    });
  });

  it('su un evento senza destinazione il testo non ne dichiara una: niente versione', async () => {
    conRegistrazione(null);
    const res = await iscriviti('anna@example.com', {
      consentRecording: true,
      consentRecordingDestination: null,
    });
    expect(res.status).toBe(201);
    expect(iscrizioneScritta()).toMatchObject({
      consentRecording: true,
      consentRecordingDestination: null,
      consentRecordingVersion: null,
    });
  });

  it('dove non c\'e\' un video il testo non dichiara la destinazione dell\'evento', async () => {
    senzaVideo();
    try {
      eventoCon({
        recordingEnabled: true,
        participantsCanUnmute: true,
        recordingDestination: 'REGISTRANTS',
        multitrackRecordingEnabled: true,
        aiTranscriptEnabled: true,
      });
      const res = await iscriviti('anna@example.com', {
        consentRecording: true,
        consentRecordingDestination: null,
      });
      expect(res.status).toBe(201);
      expect(iscrizioneScritta()).toMatchObject({
        consentRecording: true,
        consentRecordingDestination: null,
        consentRecordingVersion: null,
      });

      const dichiarata = await iscriviti('anna@example.com', {
        consentRecording: true,
        consentRecordingDestination: 'REGISTRANTS',
      });
      expect(dichiarata.status).toBe(422);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('una casella non piu\' chiesta non si rifiuta e non salva niente', async () => {
    eventoCon({ recordingEnabled: true, recordingDestination: 'PUBLIC' });
    const res = await iscriviti('anna@example.com', {
      consentRecording: true,
      consentRecordingDestination: 'REGISTRANTS',
    });
    expect(res.status).toBe(201);
    expect(iscrizioneScritta()).toMatchObject({
      consentRecording: null,
      consentRecordingDestination: null,
      consentRecordingVersion: null,
    });
  });

  it('solo su invito il testo cambiato risponde a tutti allo stesso modo', async () => {
    siteSettings.publicRegistrationEnabled = false;
    conRegistrazione('PUBLIC');
    const corpo = { consentRecording: true, consentRecordingDestination: 'REGISTRANTS' };
    tx.eventInvitation.findFirst.mockResolvedValue({ id: 'inv-1' });
    expect((await iscriviti('invitata@example.com', corpo)).status).toBe(422);
    tx.eventInvitation.findFirst.mockResolvedValue(null);
    expect((await iscriviti('estranea@example.com', corpo)).status).toBe(422);
    expect(tx.eventInvitation.findFirst).not.toHaveBeenCalled();
  });
});

describe('POST registrations — trascrizione dal video', () => {
  const conAi = (over: Record<string, unknown> = {}) =>
    eventoCon({ recordingEnabled: true, aiTranscriptEnabled: true, ...over });

  it('la pipeline accesa chiede il consenso, anche senza tracce per persona', async () => {
    siteSettings.aiPipelineEnabled = true;
    conAi();
    expect((await iscriviti('anna@example.com', { consentMultitrack: true })).status).toBe(201);
    expect(iscrizioneScritta()).toMatchObject({
      consentMultitrack: true,
      consentMultitrackVersion: 2,
    });
  });

  it('chi non spunta la casella si iscrive e il rifiuto resta scritto', async () => {
    siteSettings.aiPipelineEnabled = true;
    conAi();
    expect((await iscriviti('anna@example.com')).status).toBe(201);
    expect(iscrizioneScritta()).toMatchObject({
      consentMultitrack: false,
      consentMultitrackVersion: null,
    });
  });

  it('a pipeline spenta il consenso non si chiede', async () => {
    conAi();
    await iscriviti('anna@example.com', { consentMultitrack: true });
    expect(iscrizioneScritta()).toMatchObject({
      consentMultitrack: null,
      consentMultitrackVersion: null,
    });
  });

  it('dove non c\'e\' un video da trascrivere il consenso non si chiede', async () => {
    siteSettings.aiPipelineEnabled = true;
    senzaVideo();
    try {
      conAi();
      await iscriviti('anna@example.com', { consentMultitrack: true });
      expect(iscrizioneScritta().consentMultitrack).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('POST registrations — rubrica', () => {
  const conRubrica = { consentAddressBook: true, consentFutureCommunications: true };

  it('proposta: passa alla rubrica l\'email cifrata dell\'iscrizione', async () => {
    const res = await iscriviti('anna@example.com', conRubrica);
    expect(res.status).toBe(201);
    const input = vi.mocked(upsertPersonOnRegistration).mock.calls[0]?.[1];
    expect(input).toMatchObject({ emailHash: hashEmail('anna@example.com'), optedIn: true });
    expect(input?.email).toBe(iscrizioneScritta().email);
    expect(input?.email).not.toContain('anna@example.com');
    expect(iscrizioneScritta().consentFutureCommunications).toBe(true);
    expect(auditScritto()).toMatchObject({
      consentAddressBook: true,
      consentFutureCommunications: true,
    });
  });

  it('proposta, senza la spunta: nessun consenso alla rubrica', async () => {
    await iscriviti('anna@example.com');
    expect(vi.mocked(upsertPersonOnRegistration).mock.calls[0]?.[1]?.optedIn).toBe(false);
  });

  it('su un indirizzo con un ritiro la spunta resta in attesa: niente rubrica, niente consenso', async () => {
    vi.mocked(indirizzoFermato).mockResolvedValueOnce(true);
    await iscriviti('anna@example.com', conRubrica);
    expect(vi.mocked(indirizzoFermato).mock.calls[0]?.[1]).toBe(hashEmail('anna@example.com'));
    expect(vi.mocked(upsertPersonOnRegistration).mock.calls[0]?.[1]?.optedIn).toBe(false);
    expect(iscrizioneScritta()).toMatchObject({
      consentFutureCommunications: false,
      addressBookPending: true,
    });
    expect(auditScritto()).toMatchObject({
      consentAddressBook: false,
      consentFutureCommunications: false,
      addressBookPending: true,
    });
  });

  it('senza spunta non cerca ritiri', async () => {
    await iscriviti('anna@example.com');
    expect(indirizzoFermato).not.toHaveBeenCalled();
    expect(iscrizioneScritta()).toMatchObject({ addressBookPending: false });
  });

  async function nonScriveNulla() {
    const res = await iscriviti('anna@example.com', conRubrica);
    expect(res.status).toBe(201);
    expect(upsertPersonOnRegistration).not.toHaveBeenCalled();
    expect(iscrizioneScritta()).toMatchObject({
      personId: null,
      consentFutureCommunications: false,
    });
    expect(auditScritto()).toMatchObject({
      consentAddressBook: false,
      consentFutureCommunications: false,
    });
  }

  it('non proposta dall\'evento: 201 e nessuna scrittura', async () => {
    eventoCon({ offerAddressBook: false });
    await nonScriveNulla();
  });

  it('spenta nell\'installazione: 201 e nessuna scrittura', async () => {
    siteSettings.addressBookEnabled = false;
    eventoCon({ offerAddressBook: true });
    await nonScriveNulla();
  });

  it('non proposta: chi ha gia\' una voce resta legato a quella, senza scritture', async () => {
    eventoCon({ offerAddressBook: false });
    tx.person.findUnique.mockResolvedValue({ id: 'persona-1' });
    const res = await iscriviti('anna@example.com', conRubrica);
    expect(res.status).toBe(201);
    expect(tx.person.findUnique).toHaveBeenCalledWith({
      where: { emailHash: hashEmail('anna@example.com') },
      select: { id: true },
    });
    expect(upsertPersonOnRegistration).not.toHaveBeenCalled();
    expect(iscrizioneScritta()).toMatchObject({
      personId: 'persona-1',
      consentFutureCommunications: false,
    });
  });
});

describe('POST registrations — questionario dell\'iscrizione', () => {
  const DOMANDA = '22222222-2222-4222-8222-222222222222';
  const FACOLTATIVA = '33333333-3333-4333-8333-333333333333';
  const questionario = (required: boolean) => ({
    id: 'q-1',
    eventId: EVENT_ID,
    placement: 'PRE_REGISTRATION' as const,
    title: { it: 'Prima di iscriverti' },
    description: {},
    required,
    allowEdit: false,
    items: [
      {
        id: DOMANDA,
        prompt: { it: 'Da quale ufficio?' },
        type: 'OPEN_TEXT' as const,
        options: null,
        scaleMin: null,
        scaleMax: null,
        scaleMinLabel: null,
        scaleMaxLabel: null,
        required: true,
        source: 'adhoc' as const,
        templateId: null,
      },
      {
        id: FACOLTATIVA,
        prompt: { it: 'Altro?' },
        type: 'OPEN_TEXT' as const,
        options: null,
        scaleMin: null,
        scaleMax: null,
        scaleMinLabel: null,
        scaleMaxLabel: null,
        required: false,
        source: 'adhoc' as const,
        templateId: null,
      },
    ],
  });
  const errore = async (res: Response) =>
    ((await res.json()) as { details?: Array<{ path: string[]; message: string }> }).details?.[0];

  it('obbligatorio e senza risposte: 422 sul questionario, nessuna iscrizione', async () => {
    vi.mocked(findEventQuestionnaireByPlacement).mockResolvedValue(questionario(true) as never);
    const res = await iscriviti('anna@example.com', {
      questionnaireAnswers: [{ itemId: DOMANDA, valueText: '   ' }],
    });
    expect(res.status).toBe(422);
    expect(await errore(res)).toEqual({
      path: ['questionnaireAnswers'],
      message: 'registration.errors.questionnaireRequired',
    });
    expect(tx.registration.create).not.toHaveBeenCalled();
  });

  it('una domanda obbligatoria senza risposta: 422, anche se il questionario è facoltativo', async () => {
    vi.mocked(findEventQuestionnaireByPlacement).mockResolvedValue(questionario(false) as never);
    const res = await iscriviti('anna@example.com', {
      questionnaireAnswers: [{ itemId: FACOLTATIVA, valueText: 'Solo questa' }],
    });
    expect(res.status).toBe(422);
    expect((await errore(res))?.message).toBe('registration.errors.questionnaireIncomplete');
    expect(tx.registration.create).not.toHaveBeenCalled();
  });

  it('con le risposte: si iscrive e le risposte si salvano con l\'iscrizione', async () => {
    vi.mocked(findEventQuestionnaireByPlacement).mockResolvedValue(questionario(true) as never);
    const res = await iscriviti('anna@example.com', {
      questionnaireAnswers: [{ itemId: DOMANDA, valueText: 'Ufficio stampa' }],
    });
    expect(res.status).toBe(201);
    expect(writeResponse).toHaveBeenCalledTimes(1);
    const [t, scritta] = vi.mocked(writeResponse).mock.calls[0]!;
    // Nella stessa transazione dell'iscrizione.
    expect(t).toBe(tx);
    expect(scritta).toMatchObject({
      registrationId: 'reg-1',
      guestId: null,
      // Il nome sta cifrato nell'iscrizione: qui non si ripete in chiaro.
      respondentName: null,
      respondentEmailHash: hashEmail('anna@example.com'),
      answers: [{ itemId: DOMANDA, valueText: 'Ufficio stampa' }],
    });
  });

  it('facoltativo e senza risposte: si iscrive, nessuna risposta', async () => {
    vi.mocked(findEventQuestionnaireByPlacement).mockResolvedValue(questionario(false) as never);
    const res = await iscriviti('anna@example.com');
    expect(res.status).toBe(201);
    expect(writeResponse).not.toHaveBeenCalled();
  });

  it('solo su invito: le risposte dell\'invitato si salvano, quelle degli altri no', async () => {
    siteSettings.publicRegistrationEnabled = false;
    vi.mocked(findEventQuestionnaireByPlacement).mockResolvedValue(questionario(true) as never);
    const risposte = { questionnaireAnswers: [{ itemId: DOMANDA, valueText: 'Ufficio stampa' }] };

    const estraneo = await iscriviti('anna@example.com', risposte);
    expect(estraneo.status).toBe(202);
    expect(writeResponse).not.toHaveBeenCalled();

    tx.eventInvitation.findFirst.mockResolvedValue({ id: 'inv-1' });
    const invitato = await iscriviti('anna@example.com', risposte);
    expect(invitato.status).toBe(202);
    expect(writeResponse).toHaveBeenCalledTimes(1);
  });

  it('un questionario senza domande non chiede niente, anche se obbligatorio', async () => {
    vi.mocked(findEventQuestionnaireByPlacement).mockResolvedValue({
      ...questionario(true),
      items: [],
    } as never);
    const res = await iscriviti('anna@example.com');
    expect(res.status).toBe(201);
    expect(writeResponse).not.toHaveBeenCalled();
  });

  it("chi è già iscritto riceve «già iscritto», non l'errore del questionario", async () => {
    vi.mocked(findEventQuestionnaireByPlacement).mockResolvedValue(questionario(true) as never);
    tx.registration.findUnique.mockResolvedValue({ id: 'reg-0', accessToken: 'T', locale: 'it' });
    const res = await iscriviti('anna@example.com');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('ALREADY_REGISTERED');
  });

  it('una risposta a una domanda che non c\'è più: il questionario è cambiato', async () => {
    vi.mocked(findEventQuestionnaireByPlacement).mockResolvedValue(questionario(false) as never);
    const res = await iscriviti('anna@example.com', {
      questionnaireAnswers: [
        { itemId: DOMANDA, valueText: 'Ufficio stampa' },
        { itemId: '44444444-4444-4444-8444-444444444444', valueText: 'Sparita' },
      ],
    });
    expect(res.status).toBe(422);
    expect((await errore(res))?.message).toBe('registration.errors.questionnaireChanged');
  });

  it('il questionario cambiato durante la scrittura: 422, non un errore generico', async () => {
    vi.mocked(findEventQuestionnaireByPlacement).mockResolvedValue(questionario(false) as never);
    vi.mocked(writeResponse).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );
    const res = await iscriviti('anna@example.com', {
      questionnaireAnswers: [{ itemId: DOMANDA, valueText: 'Ufficio stampa' }],
    });
    expect(res.status).toBe(422);
    expect((await errore(res))?.message).toBe('registration.errors.questionnaireChanged');
  });
});
