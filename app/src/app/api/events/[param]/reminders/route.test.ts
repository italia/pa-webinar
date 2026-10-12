import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Le regole dei promemoria stanno nelle rotte, non solo nella pagina: un
 * momento gia' passato non si aggiunge, oltre il massimo nemmeno, un doppione
 * si dice; un promemoria gia' partito non si cancella (con lui sparirebbero
 * le sue consegne).
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventReminder: { count: vi.fn(), findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  },
}));

import { prisma } from '@/lib/db';

import { DELETE } from './[id]/route';
import { POST } from './route';

const db = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn> };
  eventReminder: Record<'count' | 'findFirst' | 'create' | 'findUnique' | 'delete', ReturnType<typeof vi.fn>>;
};

const EVENT_ID = '0e5c3a9e-4b1d-4c7e-9f2a-6d8b1c3e5f70';
const TOKEN = '7b2f9c1e-3a4d-4e5f-8a6b-9c0d1e2f3a4b';
const ctx = { params: Promise.resolve({ param: 'evento-di-prova' }) };
const ctxId = { params: Promise.resolve({ param: 'evento-di-prova', id: 'r-1' }) };

const post = (offsetMinutes: number) =>
  new Request('https://portale.example.test/api/events/evento-di-prova/reminders', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ offsetMinutes }),
  });
const del = () =>
  new Request('https://portale.example.test/api/events/evento-di-prova/reminders/r-1', {
    method: 'DELETE',
    headers: { authorization: `Bearer ${TOKEN}` },
  });

beforeEach(() => {
  vi.clearAllMocks();
  db.event.findUnique.mockResolvedValue({
    id: EVENT_ID,
    moderatorToken: TOKEN,
    startsAt: new Date(Date.now() + 2 * 3_600_000),
  });
  db.eventReminder.count.mockResolvedValue(1);
  db.eventReminder.findFirst.mockResolvedValue(null);
  db.eventReminder.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'r-nuovo',
    createdAt: new Date(),
    ...data,
  }));
});

describe('POST /api/events/[slug]/reminders', () => {
  it('crea un promemoria con l\'etichetta del momento', async () => {
    const res = await POST(post(60) as never, ctx as never);
    expect(res.status).toBe(201);
    expect(db.eventReminder.create).toHaveBeenCalledWith({
      data: { eventId: EVENT_ID, offsetMinutes: 60, label: '1 ora prima' },
    });
  });

  it('un momento gia\' passato no: non partirebbe', async () => {
    // Inizio fra due ore: «3 ore prima» e' passato.
    const res = await POST(post(180) as never, ctx as never);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('REMINDER_PASSED');
    expect(db.eventReminder.create).not.toHaveBeenCalled();
  });

  it('oltre il massimo e i doppioni si dicono con il loro codice', async () => {
    db.eventReminder.count.mockResolvedValueOnce(5);
    expect((await (await POST(post(60) as never, ctx as never)).json()).code).toBe('REMINDER_LIMIT');
    db.eventReminder.findFirst.mockResolvedValueOnce({ id: 'r-gia' });
    expect((await (await POST(post(60) as never, ctx as never)).json()).code).toBe('REMINDER_EXISTS');
    expect(db.eventReminder.create).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/events/[slug]/reminders/[id]', () => {
  it('cancella un promemoria non ancora partito', async () => {
    db.eventReminder.findUnique.mockResolvedValue({ id: 'r-1', eventId: EVENT_ID, _count: { sentRecords: 0 } });
    expect((await DELETE(del() as never, ctxId as never)).status).toBe(200);
    expect(db.eventReminder.delete).toHaveBeenCalledWith({ where: { id: 'r-1' } });
  });

  it('un promemoria gia\' partito resta', async () => {
    db.eventReminder.findUnique.mockResolvedValue({ id: 'r-1', eventId: EVENT_ID, _count: { sentRecords: 4 } });
    const res = await DELETE(del() as never, ctxId as never);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('REMINDER_SENT');
    expect(db.eventReminder.delete).not.toHaveBeenCalled();
  });
});
