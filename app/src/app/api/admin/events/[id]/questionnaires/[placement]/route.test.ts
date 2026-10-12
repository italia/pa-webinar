/**
 * Il rifiuto del questionario come CONTRATTO, non come dettaglio interno.
 *
 * Il wizard mostra all'operatore il motivo che arriva da qui: finché lo
 * ingoiava, un questionario rifiutato spariva senza che nessuno lo dicesse.
 * Ora che quel messaggio è in pagina, la forma della risposta è un contratto
 * fra le due metà — e questa è la metà che si può pinnare, visto che nel
 * progetto non ci sono test di componenti.
 *
 * Il caso più frequente non è il questionario bloccato dalle risposte: è una
 * domanda estemporanea incompleta, che fa cadere l'intero questionario — non
 * solo quella domanda. Sono coperti entrambi.
 */

import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: 'admin-session' }) })),
}));

vi.mock('@/lib/auth/staff-session', () => ({
  requireEventManager: vi.fn(async () => ({ role: 'admin' })),
}));

vi.mock('@/lib/audit/admin-audit', () => ({
  logAdminAction: vi.fn(async () => undefined),
}));

vi.mock('@/lib/db', () => {
  const tx = {
    eventQuestionnaire: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    questionnaireTemplateLink: { deleteMany: vi.fn(), createMany: vi.fn() },
    questionnaireItem: { deleteMany: vi.fn(), createMany: vi.fn() },
    questionnaireResponse: { count: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return {
    prisma: {
      event: { findUnique: vi.fn() },
      questionTemplate: { count: vi.fn() },
      eventQuestionnaire: { findUnique: vi.fn() },
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
      __tx: tx,
    },
  };
});

import { prisma } from '@/lib/db';

import { DELETE, PUT } from './route';

const EVENT_ID = '4b3c2d1e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';

const mocked = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn> };
  questionTemplate: { count: ReturnType<typeof vi.fn> };
  __tx: {
    eventQuestionnaire: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
};

function corpo(extra: Record<string, unknown> = {}) {
  return {
    placement: 'POST_EVENT',
    title: { it: 'Questionario' },
    description: {},
    required: false,
    allowEdit: false,
    templateIds: [],
    adhocItems: [
      {
        type: 'OPEN_TEXT',
        prompt: { it: 'Com’è andata?' },
        required: false,
        sortOrder: 0,
      },
    ],
    ...extra,
  };
}

function richiesta(body: unknown): NextRequest {
  return new Request(
    `http://localhost/api/admin/events/${EVENT_ID}/questionnaires/POST_EVENT`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  ) as unknown as NextRequest;
}

const contesto = {
  params: Promise.resolve({ id: EVENT_ID, placement: 'POST_EVENT' }),
};

describe('PUT questionnaires/[placement] — il rifiuto è leggibile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.event.findUnique.mockResolvedValue({ id: EVENT_ID });
    mocked.questionTemplate.count.mockResolvedValue(0);
    mocked.__tx.eventQuestionnaire.findUnique.mockResolvedValue(null);
    mocked.__tx.eventQuestionnaire.create.mockResolvedValue({ id: 'q-1' });
  });

  it('rifiuta con 409 e un codice riconoscibile quando ci sono già risposte', async () => {
    mocked.__tx.eventQuestionnaire.findUnique.mockResolvedValue({
      id: 'q-1',
      _count: { responses: 3 },
    });

    const res = await PUT(richiesta(corpo()), contesto as never);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string; error?: string };
    expect(body.code).toBe('QUESTIONNAIRE_IN_USE');
    // Il wizard mostra questo testo così com'è: se sparisce, l'operatore
    // torna a vedere un messaggio generico che non dice cosa fare.
    expect(body.error).toBeTruthy();
  });

  it('rifiuta con 422 una domanda estemporanea incompleta, e dice quale', async () => {
    // È il rifiuto più frequente: una domanda lasciata vuota fa cadere
    // l'intero questionario, non solo quella domanda.
    const res = await PUT(
      richiesta(
        corpo({
          adhocItems: [
            // Come nasce una domanda nel wizard: testo vuoto e due opzioni
            // vuote. Basta lasciarla così per far cadere tutto il
            // questionario.
            {
              type: 'SINGLE_CHOICE',
              prompt: { it: '' },
              options: [],
              required: false,
              sortOrder: 0,
            },
          ],
        }),
      ),
      contesto as never,
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { details?: Array<{ path: string[] }> };
    expect(body.details?.length).toBeGreaterThan(0);
  });

  it('accetta un questionario valido su un evento senza risposte', async () => {
    const res = await PUT(richiesta(corpo()), contesto as never);

    expect(res.status).toBeLessThan(300);
    expect(mocked.__tx.eventQuestionnaire.create).toHaveBeenCalled();
  });
});

describe('DELETE — le risposte si cancellano solo con conferma', () => {
  const db = prisma as unknown as {
    eventQuestionnaire: { findUnique: ReturnType<typeof vi.fn> };
    __tx: {
      eventQuestionnaire: { delete: ReturnType<typeof vi.fn> };
      questionnaireResponse: { count: ReturnType<typeof vi.fn> };
      $queryRaw: ReturnType<typeof vi.fn>;
    };
  };
  const tx = () => db.__tx;
  const elimina = (query = '') =>
    DELETE(
      new Request(
        `http://localhost/api/admin/events/${EVENT_ID}/questionnaires/POST_EVENT${query}`,
        { method: 'DELETE' },
      ) as unknown as NextRequest,
      { params: Promise.resolve({ id: EVENT_ID, placement: 'POST_EVENT' }) } as never,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    db.eventQuestionnaire.findUnique.mockResolvedValue({ id: 'q1' });
    tx().$queryRaw.mockResolvedValue([{ id: 'q1' }]);
  });

  it('conta le risposte a riga bloccata, prima di decidere', async () => {
    tx().questionnaireResponse.count.mockResolvedValue(0);

    await elimina();

    expect(String(tx().$queryRaw.mock.calls[0]![0])).toContain('FOR UPDATE');
    expect(tx().$queryRaw.mock.invocationCallOrder[0]!).toBeLessThan(
      tx().questionnaireResponse.count.mock.invocationCallOrder[0]!,
    );
  });

  it('con risposte e senza conferma rifiuta e non cancella niente', async () => {
    tx().questionnaireResponse.count.mockResolvedValue(3);

    const res = await elimina();

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('HAS_RESPONSES');
    expect(tx().eventQuestionnaire.delete).not.toHaveBeenCalled();
  });

  it('con risposte e conferma cancella tutto', async () => {
    tx().questionnaireResponse.count.mockResolvedValue(3);

    const res = await elimina('?withResponses=1');

    expect(res.status).toBe(200);
    expect(tx().eventQuestionnaire.delete).toHaveBeenCalledWith({ where: { id: 'q1' } });
    expect((await res.json()).deletedResponses).toBe(3);
  });

  it('senza risposte non serve conferma', async () => {
    tx().questionnaireResponse.count.mockResolvedValue(0);

    const res = await elimina();

    expect(res.status).toBe(200);
    expect(tx().eventQuestionnaire.delete).toHaveBeenCalledTimes(1);
  });

  it('gia eliminato da un\'altra richiesta: 404', async () => {
    tx().$queryRaw.mockResolvedValue([]);

    const res = await elimina();

    expect(res.status).toBe(404);
    expect(tx().eventQuestionnaire.delete).not.toHaveBeenCalled();
  });
});
