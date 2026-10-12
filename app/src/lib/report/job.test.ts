import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  $executeRaw: vi.fn(async (..._a: unknown[]) => 1),
  postprodJob: { findUnique: vi.fn(async (..._a: unknown[]) => ({ status: 'RUNNING', attempts: 2 })) },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

import { avanzamentoResoconto } from './job';

/** Il testo SQL di una chiamata, con i frammenti composti e i loro valori. */
function sql(i: number): { testo: string; valori: unknown[] } {
  const [parti, ...valori] = db.$executeRaw.mock.calls[i]! as [string[], ...unknown[]];
  const tutti: unknown[] = [];
  const testo = parti
    .map((t, k) => {
      const v = valori[k];
      if (v && typeof v === 'object' && 'strings' in v) {
        tutti.push(...(v as unknown as { values: unknown[] }).values);
        return t + (v as unknown as { strings: string[] }).strings.join('?');
      }
      if (k < valori.length) tutti.push(v);
      return t;
    })
    .join('?');
  return { testo, valori: tutti };
}
const lavoro = (extra: object = {}) => ({ id: 'j', status: 'RUNNING', attempts: 2, ...extra });
const regole = { tentativiMassimi: async () => 3, ritardoMs: 30_000 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('avanzamentoResoconto', () => {
  it('in corso: vale solo il claim corrente, chi e\' stato superato lo legge e si ferma', async () => {
    expect(await avanzamentoResoconto(lavoro(), { status: 'RUNNING', attempt: 2 }, regole)).toEqual({ status: 'RUNNING' });
    const { testo, valori } = sql(0);
    expect(testo).toContain('attempts = ?');
    expect(valori).toContain(2);
    db.$executeRaw.mockResolvedValueOnce(0);
    expect(await avanzamentoResoconto(lavoro(), { status: 'RUNNING', attempt: 1 }, regole)).toEqual({
      status: 'RUNNING',
      superseded: true,
    });
  });

  it('senza il numero del claim il messaggio non conta', async () => {
    expect(await avanzamentoResoconto(lavoro(), { status: 'FAILED', error: 'x' }, regole)).toEqual({
      status: 'RUNNING',
      superseded: true,
    });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('un lavoro chiuso non si riapre, e chi lo dice lo sa', async () => {
    expect(await avanzamentoResoconto(lavoro({ status: 'DONE' }), { status: 'FAILED', attempt: 2 }, regole)).toEqual({
      status: 'DONE',
    });
    expect(db.postprodJob.findUnique).not.toHaveBeenCalled();
    // Chiuso tra la lettura e la scrittura: la scrittura non passa.
    db.$executeRaw.mockResolvedValueOnce(0);
    db.postprodJob.findUnique.mockResolvedValueOnce({ status: 'FAILED', attempts: 2 });
    expect(await avanzamentoResoconto(lavoro(), { status: 'RUNNING', attempt: 2 }, regole)).toEqual({ status: 'FAILED' });
  });

  it('concluso lo dice solo la consegna', async () => {
    expect(await avanzamentoResoconto(lavoro(), { status: 'DONE', attempt: 2 }, regole)).toEqual({ status: 'RUNNING' });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it("all'ultimo tentativo fallisce e perde i numeri; prima si ritenta", async () => {
    expect(await avanzamentoResoconto(lavoro({ attempts: 3 }), { status: 'FAILED', error: 'x', attempt: 3 }, regole)).toEqual({
      status: 'FAILED',
      chiusoOra: true,
    });
    expect(sql(0).testo).toContain("payload = payload - 'metrics'");
    expect(sql(0).testo).toContain("status IN ('PENDING', 'CLAIMED', 'RUNNING') AND attempts = ?");
    expect(await avanzamentoResoconto(lavoro(), { status: 'FAILED', error: 'x', attempt: 2 }, regole)).toEqual({
      status: 'PENDING',
    });
    expect(sql(1).testo).toContain("SET status = 'PENDING'");
  });
});
