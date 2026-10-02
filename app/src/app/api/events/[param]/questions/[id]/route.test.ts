import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il moderatore cambia lo stato di una domanda o ne scrive la risposta.
 *
 * La prima risposta scritta rende «Risposta data» una domanda in attesa o in
 * evidenza. Correggere una risposta che c'e' gia' non sposta la domanda ne'
 * ne rifa' le date, e una domanda scartata resta scartata. Una risposta vuota
 * la toglie e lascia lo stato com'e'.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    question: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('@/lib/cache', () => ({ deleteCacheByPrefix: vi.fn() }));
vi.mock('@/lib/live-state/publish', () => ({ pokeLivePanel: vi.fn() }));
vi.mock('@/lib/auth/moderator', () => ({
  isEventModerator: vi.fn(async (_e: unknown, token: string) => token === 'token-moderatore'),
}));

import { prisma } from '@/lib/db';
import { pokeLivePanel } from '@/lib/live-state/publish';

import { PATCH } from './route';

const EVENT_ID = '0b6a3f8e-5d1c-4e2b-9a7f-1c2d3e4f5a6b';
const QID = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const mocked = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn> };
  question: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

function richiesta(body: unknown, token = 'token-moderatore'): NextRequest {
  return new Request(`http://localhost/api/events/evento/questions/${QID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const contesto = { params: Promise.resolve({ param: 'evento', id: QID }) };

function datiScritti(): Record<string, unknown> {
  expect(mocked.question.update).toHaveBeenCalledTimes(1);
  return mocked.question.update.mock.calls[0]![0].data as Record<string, unknown>;
}

function domanda(status: string, answerText: string | null = null) {
  mocked.question.findUnique.mockResolvedValue({ id: QID, eventId: EVENT_ID, status, answerText });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.event.findUnique.mockResolvedValue({ id: EVENT_ID, slug: 'evento' });
  mocked.question.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: QID,
    authorName: 'Relatore 1',
    text: 'Quando esce il bando?',
    answerText: null,
    status: 'PENDING',
    upvoteCount: 0,
    createdAt: new Date('2026-10-02T10:00:00Z'),
    highlightedAt: null,
    answeredAt: null,
    ...data,
  }));
});

describe('PATCH /api/events/[param]/questions/[id]', () => {
  it('una risposta scritta rende la domanda «Risposta data»', async () => {
    domanda('PENDING');
    const res = await PATCH(richiesta({ answer: '  Entro giugno.  ' }), contesto as never);

    expect(res.status).toBe(200);
    const dati = datiScritti();
    expect(dati.answerText).toBe('Entro giugno.');
    expect(dati.status).toBe('ANSWERED');
    expect(dati.answeredAt).toBeInstanceOf(Date);
    expect((await res.json()).answerText).toBe('Entro giugno.');
    expect(pokeLivePanel).toHaveBeenCalledWith(EVENT_ID, 'qa');
  });

  it('correggere la risposta di una domanda gia\' risposta non tocca stato e date', async () => {
    domanda('ANSWERED', 'Entro giugno.');
    await PATCH(richiesta({ answer: 'Entro la fine di giugno.' }), contesto as never);

    const dati = datiScritti();
    expect(dati.answerText).toBe('Entro la fine di giugno.');
    expect(dati).not.toHaveProperty('status');
    expect(dati).not.toHaveProperty('answeredAt');
    expect(dati).not.toHaveProperty('highlightedAt');
  });

  it.each([
    ['in evidenza, con una risposta gia\' scritta', 'HIGHLIGHTED', 'Entro giugno.'],
    ['scartata, con una risposta gia\' scritta', 'DISMISSED', 'Entro giugno.'],
    ['scartata, senza risposta', 'DISMISSED', null],
  ])('una domanda %s non cambia stato', async (_nome, status, prima) => {
    domanda(status, prima);
    await PATCH(richiesta({ answer: 'Entro la fine di giugno.' }), contesto as never);

    const dati = datiScritti();
    expect(dati.answerText).toBe('Entro la fine di giugno.');
    expect(dati).not.toHaveProperty('status');
    expect(dati).not.toHaveProperty('highlightedAt');
  });

  it('la prima risposta a una domanda in evidenza la rende «Risposta data»', async () => {
    domanda('HIGHLIGHTED');
    await PATCH(richiesta({ answer: 'Sì.' }), contesto as never);
    expect(datiScritti().status).toBe('ANSWERED');
  });

  it('una risposta vuota o null la toglie e lascia lo stato', async () => {
    for (const answer of ['', null]) {
      vi.clearAllMocks();
      domanda('ANSWERED');
      await PATCH(richiesta({ answer }), contesto as never);
      const dati = datiScritti();
      expect(dati.answerText).toBeNull();
      expect(dati).not.toHaveProperty('status');
    }
  });

  it('il solo stato funziona come prima e non tocca la risposta', async () => {
    domanda('PENDING');
    await PATCH(richiesta({ status: 'HIGHLIGHTED' }), contesto as never);

    const dati = datiScritti();
    expect(dati.status).toBe('HIGHLIGHTED');
    expect(dati.highlightedAt).toBeInstanceOf(Date);
    expect(dati.answeredAt).toBeNull();
    expect(dati).not.toHaveProperty('answerText');
  });

  it('chi non conduce non risponde', async () => {
    domanda('PENDING');
    const res = await PATCH(richiesta({ answer: 'No.' }, 'token-altrui'), contesto as never);

    expect(res.status).toBe(403);
    expect(mocked.question.update).not.toHaveBeenCalled();
  });

  it('una richiesta senza stato e senza risposta e\' rifiutata', async () => {
    domanda('PENDING');
    const res = await PATCH(richiesta({}), contesto as never);

    expect(res.status).toBe(422);
    expect(mocked.question.update).not.toHaveBeenCalled();
  });
});
