// @vitest-environment node
/**
 * Invio delle risposte a un questionario di evento.
 *
 * - La valutazione di fine evento (POST_EVENT) si accetta solo con la raccolta
 *   accesa e a evento in corso (anche con la sala ferma) o concluso: prima, o
 *   ad archivio, 403.
 * - Arriva a chi organizza senza nome e senza hash dell'email, anche da chi e'
 *   iscritto: l'iscrizione resta collegata solo per tenere una risposta a
 *   testa.
 * - Il questionario d'iscrizione (PRE_REGISTRATION) conserva il nome
 *   (decifrato) e l'hash dell'email gia' calcolato nella colonna `emailHash`
 *   dell'iscrizione, non un hash dell'email cifrata.
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  getClientIp: vi.fn(() => '192.0.2.1'),
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 59, resetAt: Date.now() + 60_000 })),
}));
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: vi.fn((v: string) => (v.startsWith('cifrato:') ? v.slice('cifrato:'.length) : null)),
}));
vi.mock('@/lib/questionnaires', async (importOriginal) => ({
  // La validazione delle risposte resta quella vera: e' parte del contratto.
  ...(await importOriginal<typeof QuestionnairesModule>()),
  findEventQuestionnaireByPlacement: vi.fn(),
  submitResponse: vi.fn(),
}));

import type * as QuestionnairesModule from '@/lib/questionnaires';
import { prisma } from '@/lib/db';
import { findEventQuestionnaireByPlacement, submitResponse } from '@/lib/questionnaires';

import { POST } from './route';

// Concluso da poco, entro la conservazione dei suoi dati.
const RECENTE = { endsAt: new Date(Date.now() - 86_400_000), dataRetentionDays: 30 };
const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedRegistration = prisma.registration.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedFind = vi.mocked(findEventQuestionnaireByPlacement);
const mockedSubmit = vi.mocked(submitResponse);

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const SLUG = 'evento-di-prova';
const ITEM_ID = '44444444-4444-4444-8444-444444444444';
const REG_ID = '55555555-5555-4555-8555-555555555555';
const EMAIL_HASH = 'a'.repeat(64);

function questionario(placement: 'POST_EVENT' | 'PRE_REGISTRATION') {
  return {
    id: 'q-1',
    eventId: EVENT_ID,
    placement,
    title: { it: 'Questionario' },
    description: {},
    required: false,
    allowEdit: false,
    items: [
      {
        id: ITEM_ID,
        prompt: { it: 'Voto complessivo' },
        type: 'LIKERT' as const,
        options: null,
        scaleMin: 1,
        scaleMax: 5,
        scaleMinLabel: null,
        scaleMaxLabel: null,
        required: false,
        source: 'template' as const,
        templateId: 'tpl-1',
      },
    ],
  };
}

function post(
  placement: string,
  body: Record<string, unknown>,
): [NextRequest, { params: Promise<{ param: string; placement: string }> }] {
  return [
    new Request(`https://webinar.example.gov.it/api/events/${SLUG}/questionnaires/${placement}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [{ itemId: ITEM_ID, valueScale: 4 }], ...body }),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ param: SLUG, placement }) },
  ];
}

/** I parametri con cui la rotta ha chiamato submitResponse. */
function inviato() {
  expect(mockedSubmit).toHaveBeenCalledTimes(1);
  return mockedSubmit.mock.calls[0]![0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedEvent.mockResolvedValue({ id: EVENT_ID, status: 'ENDED', feedbackEnabled: true, ...RECENTE });
  mockedFind.mockImplementation(async (_id, placement) => questionario(placement));
  mockedSubmit.mockResolvedValue({ id: 'resp-1', created: true });
  mockedRegistration.mockResolvedValue({
    id: REG_ID,
    eventId: EVENT_ID,
    emailHash: EMAIL_HASH,
    displayName: 'cifrato:Partecipante 1',
  });
});

describe('POST …/POST_EVENT/responses — quando la valutazione e’ aperta', () => {
  // IDLE: evento in corso con la sala ferma per inattivita'.
  it.each(['LIVE', 'IDLE', 'ENDED'])('evento %s con la raccolta accesa: accettata (201)', async (status) => {
    mockedEvent.mockResolvedValue({ id: EVENT_ID, status, feedbackEnabled: true, ...RECENTE });

    const res = await POST(...post('POST_EVENT', { guestId: 'guest-1' }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'resp-1', created: true });
  });

  it.each(['DRAFT', 'PUBLISHED', 'PROVISIONING', 'ARCHIVED'])(
    'evento %s: 403, nessuna risposta salvata',
    async (status) => {
      mockedEvent.mockResolvedValue({ id: EVENT_ID, status, feedbackEnabled: true, ...RECENTE });

      const res = await POST(...post('POST_EVENT', { guestId: 'guest-1' }));

      expect(res.status).toBe(403);
      expect(mockedFind).not.toHaveBeenCalled();
      expect(mockedSubmit).not.toHaveBeenCalled();
    },
  );

  it('raccolta spenta, anche a evento concluso: 403', async () => {
    mockedEvent.mockResolvedValue({ id: EVENT_ID, status: 'ENDED', feedbackEnabled: false, ...RECENTE });

    const res = await POST(...post('POST_EVENT', { guestId: 'guest-1' }));

    expect(res.status).toBe(403);
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it('chi aveva gia’ risposto e il questionario non si modifica: 200 con l’esito di submitResponse', async () => {
    mockedSubmit.mockResolvedValue({ id: 'resp-1', created: false });
    const res = await POST(...post('POST_EVENT', { guestId: 'guest-1' }));
    expect(res.status).toBe(200);
  });
});

describe('POST …/POST_EVENT/responses — senza nome', () => {
  it('chi e’ iscritto: l’iscrizione resta collegata, ma nome e hash dell’email no', async () => {
    const res = await POST(
      ...post('POST_EVENT', { accessToken: 'TOKEN_ISCRIZIONE', respondentName: 'Nome digitato' }),
    );

    expect(res.status).toBe(201);
    expect(inviato()).toMatchObject({
      registrationId: REG_ID,
      guestId: null,
      respondentName: null,
      respondentEmailHash: null,
      answers: [{ itemId: ITEM_ID, valueText: null, valueChoices: null, valueScale: 4 }],
    });
  });

  it('chi non e’ iscritto: l’identificativo del browser, e il nome digitato non si salva', async () => {
    await POST(...post('POST_EVENT', { guestId: 'guest-1', respondentName: 'Nome digitato' }));

    expect(inviato()).toMatchObject({
      registrationId: null,
      guestId: 'guest-1',
      respondentName: null,
      respondentEmailHash: null,
    });
  });

  it('un token d’iscrizione di un altro evento: 403', async () => {
    mockedRegistration.mockResolvedValue({
      id: REG_ID,
      eventId: '99999999-9999-4999-8999-999999999999',
      emailHash: EMAIL_HASH,
      displayName: 'cifrato:Partecipante 1',
    });

    const res = await POST(...post('POST_EVENT', { accessToken: 'TOKEN_ALTRO_EVENTO' }));

    expect(res.status).toBe(403);
    expect(mockedSubmit).not.toHaveBeenCalled();
  });
});

describe('POST …/PRE_REGISTRATION/responses — il questionario d’iscrizione', () => {
  it('non dipende dalla raccolta delle valutazioni ne’ dallo stato dell’evento', async () => {
    mockedEvent.mockResolvedValue({ id: EVENT_ID, status: 'PUBLISHED', feedbackEnabled: false, ...RECENTE });

    const res = await POST(...post('PRE_REGISTRATION', { accessToken: 'TOKEN_ISCRIZIONE' }));

    expect(res.status).toBe(201);
    expect(mockedFind).toHaveBeenCalledWith(EVENT_ID, 'PRE_REGISTRATION');
  });

  it('nome decifrato e hash dell’email preso dalla colonna dell’iscrizione', async () => {
    await POST(...post('PRE_REGISTRATION', { accessToken: 'TOKEN_ISCRIZIONE', respondentName: 'Altro' }));

    expect(inviato()).toMatchObject({
      registrationId: REG_ID,
      respondentName: 'Partecipante 1',
      respondentEmailHash: EMAIL_HASH,
    });
    // Si legge l'hash gia' calcolato, non l'email cifrata da ri-hashare.
    const select = mockedRegistration.mock.calls[0]![0].select;
    expect(select).toMatchObject({ emailHash: true });
    expect(select).not.toHaveProperty('email');
  });

  it('un nome non decifrabile resta com’e’', async () => {
    mockedRegistration.mockResolvedValue({
      id: REG_ID,
      eventId: EVENT_ID,
      emailHash: EMAIL_HASH,
      displayName: 'Nome in chiaro',
    });

    await POST(...post('PRE_REGISTRATION', { accessToken: 'TOKEN_ISCRIZIONE' }));
    expect(inviato().respondentName).toBe('Nome in chiaro');
  });

  it('un ospite: il nome digitato si salva, senza hash dell’email', async () => {
    await POST(...post('PRE_REGISTRATION', { guestId: 'guest-1', respondentName: 'Ospite 1' }));

    expect(inviato()).toMatchObject({
      registrationId: null,
      guestId: 'guest-1',
      respondentName: 'Ospite 1',
      respondentEmailHash: null,
    });
    expect(mockedRegistration).not.toHaveBeenCalled();
  });
});
