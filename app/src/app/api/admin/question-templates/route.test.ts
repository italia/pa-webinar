// @vitest-environment node
/**
 * La libreria delle domande: tutto lo staff la legge per comporre i questionari
 * dei propri eventi, ma scriverla resta dell’amministrazione.
 */
import { Prisma } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, sessione } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    questionTemplate: { findMany: vi.fn(), create: vi.fn() },
  },
  sessione: { cookie: undefined as string | undefined },
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'admin_session' && sessione.cookie
        ? { value: sessione.cookie }
        : undefined,
  }),
}));

import { signStaffSession } from '@/lib/auth/staff-session';

import { GET, POST } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

function elenca(query = '') {
  const request = new Request(`http://localhost/api/admin/question-templates${query}`);
  return GET(request as never, { params: Promise.resolve({}) });
}

function crea(corpo: unknown) {
  const request = new Request('http://localhost/api/admin/question-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return POST(request as never, { params: Promise.resolve({}) });
}

async function entra(role: 'ADMIN' | 'ORGANIZER') {
  prisma.staffAccount.findUnique.mockResolvedValue({
    id: ACCOUNT,
    active: true,
    role,
    emailHash: 'impronta-account',
  });
  sessione.cookie = await signStaffSession({ id: ACCOUNT, role });
}

const riga = (extra: Record<string, unknown> = {}) => ({
  id: 'm1',
  name: 'Gradimento',
  description: null,
  isSystem: false,
  sortOrder: 0,
  usage: null,
  createdAt: new Date('2026-10-01T08:00:00Z'),
  updatedAt: new Date('2026-10-02T08:00:00Z'),
  _count: { items: 2, questionnaires: 5 },
  ...extra,
});

const DOMANDA = { prompt: { it: 'Come valuti l’evento?' }, type: 'LIKERT' };

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-della-libreria-domande-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.questionTemplate.findMany.mockResolvedValue([riga()]);
  prisma.questionTemplate.create.mockImplementation(
    async ({ data }: { data: object }) => ({
      id: 'nuovo',
      ...data,
    })
  );
});

describe('chi puo’ leggere', () => {
  it('senza sessione e’ 401', async () => {
    sessione.cookie = undefined;
    expect((await elenca()).status).toBe(401);
    expect(prisma.questionTemplate.findMany).not.toHaveBeenCalled();
  });

  it('chi organizza legge la libreria', async () => {
    await entra('ORGANIZER');
    expect((await elenca()).status).toBe(200);
  });
});

describe('GET', () => {
  it('conta domande e questionari che usano il modello, senza cache', async () => {
    const r = await elenca();
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const corpo = (await r.json()) as { rows: Array<Record<string, unknown>> };
    expect(corpo.rows[0]).toMatchObject({
      itemCount: 2,
      usedByQuestionnaires: 5,
      createdAt: '2026-10-01T08:00:00.000Z',
    });
  });

  it('senza richiesta le domande non si leggono', async () => {
    const r = await elenca();
    expect(prisma.questionTemplate.findMany.mock.calls[0]![0].select).not.toHaveProperty(
      'items'
    );
    const corpo = (await r.json()) as { rows: Array<Record<string, unknown>> };
    expect(corpo.rows[0]).not.toHaveProperty('items');
  });

  it('con domande=1 ogni riga porta le sue domande', async () => {
    const domande = [{ prompt: { it: 'Come valuti?' }, type: 'LIKERT' }];
    prisma.questionTemplate.findMany.mockResolvedValue([riga({ items: domande })]);
    const r = await elenca('?domande=1');
    expect(prisma.questionTemplate.findMany.mock.calls[0]![0].select).toHaveProperty(
      'items'
    );
    const corpo = (await r.json()) as { rows: Array<{ items: unknown }> };
    expect(corpo.rows[0]!.items).toEqual(domande);
  });
});

describe('POST', () => {
  it('senza sessione e’ 401', async () => {
    sessione.cookie = undefined;
    expect((await crea({ name: 'Gradimento' })).status).toBe(401);
    expect(prisma.questionTemplate.create).not.toHaveBeenCalled();
  });

  it('chi organizza legge ma non scrive', async () => {
    await entra('ORGANIZER');
    expect((await crea({ name: 'Gradimento' })).status).toBe(401);
    expect(prisma.questionTemplate.create).not.toHaveBeenCalled();
  });

  it('un corpo non valido e’ 422, e non si scrive niente', async () => {
    const corpi = [
      { name: 'G' },
      { name: 'Gradimento', usage: 'QUANDO_CAPITA' },
      { name: 'Gradimento', items: [{ ...DOMANDA, prompt: { en: 'Only English' } }] },
      { name: 'Gradimento', items: [{ ...DOMANDA, type: 'SINGLE_CHOICE' }] },
      { name: 'Gradimento', items: [{ ...DOMANDA, scaleMin: 5, scaleMax: 3 }] },
    ];
    for (const corpo of corpi) {
      expect((await crea(corpo)).status).toBe(422);
    }
    expect(prisma.questionTemplate.create).not.toHaveBeenCalled();
  });

  it('una domanda copiata con il suo id non sparisce dal modello nuovo', async () => {
    await crea({
      name: 'Gradimento',
      items: [DOMANDA, { ...DOMANDA, id: '77777777-7777-4777-8777-777777777777' }],
    });
    const { data } = prisma.questionTemplate.create.mock.calls[0]![0];
    expect(data.items.create).toHaveLength(2);
    expect(data.items.create[1]).not.toHaveProperty('id');
  });

  it('crea il modello con le sue domande in una sola scrittura', async () => {
    const r = await crea({
      name: 'Gradimento',
      usage: 'POST_EVENT',
      sortOrder: 3,
      items: [{ ...DOMANDA, required: true, sortOrder: 1 }],
    });
    expect(r.status).toBe(201);
    const { data } = prisma.questionTemplate.create.mock.calls[0]![0];
    expect(data).toMatchObject({
      name: 'Gradimento',
      description: null,
      usage: 'POST_EVENT',
      sortOrder: 3,
    });
    expect(data.items.create).toEqual([
      expect.objectContaining({
        ...DOMANDA,
        required: true,
        sortOrder: 1,
        scaleMin: null,
      }),
    ]);
    expect(data.items.create[0].options).toBe(Prisma.JsonNull);
  });

  it('senza momento il modello vale prima e dopo l’evento', async () => {
    await crea({ name: 'Gradimento' });
    const { data } = prisma.questionTemplate.create.mock.calls[0]![0];
    expect(data).toMatchObject({ usage: null, sortOrder: 0, items: { create: [] } });
  });

  it('lascia traccia del modello creato', async () => {
    await crea({ name: 'Gradimento' });
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'QUESTION_TEMPLATE_CREATE',
      target: 'nuovo',
    });
  });
});
