import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il momento di un modello si cambia con il PUT, salvo per il modello di
 * sistema: il feedback predefinito lo aggancia sempre dopo l'evento.
 */
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/admin-session', () => ({ isAdminAuthenticated: vi.fn(async () => true) }));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/db', () => {
  const tx = { questionTemplate: { findUnique: vi.fn(), update: vi.fn() } };
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});

import { prisma } from '@/lib/db';

import { PUT } from './route';

const tx = (prisma as unknown as {
  __tx: { questionTemplate: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } };
}).__tx;

const ID = 'f00dbac0-0000-4000-a000-000000000001';
const ctx = { params: Promise.resolve({ id: ID }) };

function put(body: Record<string, unknown>): Request {
  return new Request(`https://portale.example.test/api/admin/question-templates/${ID}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.questionTemplate.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: ID,
    ...data,
  }));
});

describe('PUT /api/admin/question-templates/[id] — momento', () => {
  it('cambia il momento di un modello qualsiasi, senza toccare le domande', async () => {
    tx.questionTemplate.findUnique.mockResolvedValue({ id: ID, isSystem: false, usage: null, items: [] });
    const res = await PUT(put({ usage: 'PRE_REGISTRATION' }) as never, ctx as never);
    expect(res.status).toBe(200);
    const data = tx.questionTemplate.update.mock.calls[0]![0].data;
    expect(data).toEqual({ usage: 'PRE_REGISTRATION' });
  });

  it('il modello di sistema resta dopo l’evento', async () => {
    tx.questionTemplate.findUnique.mockResolvedValue({ id: ID, isSystem: true, usage: 'POST_EVENT', items: [] });
    const res = await PUT(put({ usage: 'PRE_REGISTRATION' }) as never, ctx as never);
    expect(res.status).toBe(422);
    expect(tx.questionTemplate.update).not.toHaveBeenCalled();
  });

  it('il modello di sistema si salva se il momento non cambia', async () => {
    tx.questionTemplate.findUnique.mockResolvedValue({ id: ID, isSystem: true, usage: 'POST_EVENT', items: [] });
    const res = await PUT(put({ name: 'Feedback generico', usage: 'POST_EVENT' }) as never, ctx as never);
    expect(res.status).toBe(200);
  });
});
