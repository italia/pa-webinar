/**
 * Banca dati finta, in memoria, per i test del ciclo di vita degli eventi.
 *
 * Copre solo le chiamate che il giro del ciclo di vita e la chiusura delle
 * sessioni fanno davvero su `event` e `callSession`, con i filtri che usano
 * (uguaglianza, `in`, `not`, `lt`/`lte`/`gt`, `OR`, filtro sulla relazione
 * `event`). Tenere le righe in memoria, invece di rispondere chiamata per
 * chiamata, fa verificare lo STATO a fine giro: quale evento è finito dove,
 * quale sessione è stata chiusa e quando.
 */

export interface FakeEvent {
  id: string;
  status: string;
  eventType: string;
  startsAt: Date;
  endsAt: Date;
  gracePeriodMinutes: number | null;
  lastActiveAt: Date | null;
  provisioningStartedAt: Date | null;
  peakParticipants: number;
  updatedAt: Date;
  /** Iscritti, per le select con `_count: { select: { registrations } }`. */
  registrationCount?: number;
}

export interface FakeSession {
  id: string;
  eventId: string;
  startedAt: Date;
  endedAt: Date | null;
  duration: number | null;
  peakParticipants: number;
}

type Where = Record<string, unknown>;

function matchValue(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null;
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
  if (typeof cond !== 'object') return value === cond;
  const c = cond as Record<string, unknown>;
  if ('in' in c && !(c.in as unknown[]).includes(value)) return false;
  if ('notIn' in c && (c.notIn as unknown[]).includes(value)) return false;
  if ('not' in c && value === c.not) return false;
  const t = value instanceof Date ? value.getTime() : null;
  const cmp = (k: string, ok: (a: number, b: number) => boolean) =>
    !(k in c) || (t !== null && ok(t, (c[k] as Date).getTime()));
  return (
    cmp('lt', (a, b) => a < b) &&
    cmp('lte', (a, b) => a <= b) &&
    cmp('gt', (a, b) => a > b) &&
    cmp('gte', (a, b) => a >= b)
  );
}

function matches<T extends object>(row: T, where: Where | undefined, db: FakeLifecycleDb): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Where[]).some((w) => matches(row, w, db))) return false;
      continue;
    }
    if (key === 'event') {
      const ev = db.events.find((e) => e.id === (row as unknown as FakeSession).eventId);
      if (!ev || !matches(ev, cond as Where, db)) return false;
      continue;
    }
    if (!matchValue((row as Record<string, unknown>)[key], cond)) return false;
  }
  return true;
}

function pick<T extends object>(row: T, select?: Record<string, unknown>): Partial<T> {
  if (!select) return { ...row };
  const out: Partial<T> = {};
  for (const k of Object.keys(select)) {
    (out as Record<string, unknown>)[k] =
      k === '_count'
        ? { registrations: (row as unknown as FakeEvent).registrationCount ?? 0 }
        : (row as Record<string, unknown>)[k];
  }
  return out;
}

export class FakeLifecycleDb {
  events: FakeEvent[] = [];
  sessions: FakeSession[] = [];
  /** Ogni scrittura, nell'ordine: per verificare cosa il giro NON deve fare. */
  writes: Array<{ model: string; op: string; where: unknown; data: unknown }> = [];

  constructor(private readonly clock: () => Date) {}

  event = {
    findMany: async (args: { where?: Where; select?: Record<string, unknown> }) =>
      this.events.filter((e) => matches(e, args.where, this)).map((e) => pick(e, args.select)),
    updateMany: async (args: { where?: Where; data: Partial<FakeEvent> }) => {
      this.writes.push({ model: 'event', op: 'updateMany', where: args.where, data: args.data });
      const rows = this.events.filter((e) => matches(e, args.where, this));
      for (const r of rows) Object.assign(r, args.data, { updatedAt: this.clock() });
      return { count: rows.length };
    },
    updateManyAndReturn: async (args: {
      where?: Where;
      data: Partial<FakeEvent>;
      select?: Record<string, unknown>;
    }) => {
      this.writes.push({ model: 'event', op: 'updateManyAndReturn', where: args.where, data: args.data });
      const rows = this.events.filter((e) => matches(e, args.where, this));
      for (const r of rows) Object.assign(r, args.data, { updatedAt: this.clock() });
      return rows.map((r) => pick(r, args.select));
    },
  };

  callSession = {
    findMany: async (args: {
      where?: Where;
      select?: Record<string, unknown>;
      distinct?: string[];
      take?: number;
    }) => {
      let rows = this.sessions.filter((s) => matches(s, args.where, this));
      if (args.distinct) {
        const seen = new Set<string>();
        rows = rows.filter((r) => {
          const key = args.distinct!.map((k) => String((r as unknown as Record<string, unknown>)[k])).join('|');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      if (args.take !== undefined) rows = rows.slice(0, args.take);
      return rows.map((r) => pick(r, args.select));
    },
    update: async (args: { where: { id: string }; data: Partial<FakeSession> }) => {
      this.writes.push({ model: 'callSession', op: 'update', where: args.where, data: args.data });
      const row = this.sessions.find((s) => s.id === args.where.id);
      if (!row) throw new Error(`sessione ${args.where.id} inesistente`);
      Object.assign(row, args.data);
      return { ...row };
    },
  };

  /** La transazione non è simulata: le chiamate vanno sulle stesse righe. */
  $transaction = async <T>(fn: (tx: FakeLifecycleDb) => Promise<T>): Promise<T> => fn(this);

  addEvent(over: Partial<FakeEvent> & { id: string }): FakeEvent {
    const now = this.clock();
    const ev: FakeEvent = {
      status: 'PUBLISHED',
      eventType: 'SCHEDULED',
      startsAt: new Date(now.getTime() - 30 * 60_000),
      endsAt: new Date(now.getTime() + 30 * 60_000),
      gracePeriodMinutes: null,
      lastActiveAt: null,
      provisioningStartedAt: null,
      peakParticipants: 0,
      updatedAt: now,
      ...over,
    };
    this.events.push(ev);
    return ev;
  }

  addSession(over: Partial<FakeSession> & { id: string; eventId: string }): FakeSession {
    const s: FakeSession = {
      startedAt: new Date(this.clock().getTime() - 10 * 60_000),
      endedAt: null,
      duration: null,
      peakParticipants: 0,
      ...over,
    };
    this.sessions.push(s);
    return s;
  }

  status(id: string): string | undefined {
    return this.events.find((e) => e.id === id)?.status;
  }

  session(id: string): FakeSession | undefined {
    return this.sessions.find((s) => s.id === id);
  }
}
