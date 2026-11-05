// @vitest-environment node
/**
 * I file di registrazione rimasti orfani: solo l’amministrazione li vede e
 * decide. La lettura dice quando sparira’ ogni file, con la stessa regola della
 * pulizia; la decisione accetta solo i tre valori che la pulizia conosce.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, sessione } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    orphanRecording: { findMany: vi.fn(), updateMany: vi.fn() },
    siteSetting: { findFirst: vi.fn() },
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
const ORFANA = '77777777-7777-4777-8777-777777777777';

function chiama(handler: typeof GET, method: string, corpo?: unknown) {
  const request = new Request('http://localhost/api/admin/recordings/orphans', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  return handler(request as never, { params: Promise.resolve({}) });
}
const elenca = () => chiama(GET, 'GET');
const decidi = (corpo: unknown) => chiama(POST, 'POST', corpo);

async function entra(role: 'ADMIN' | 'ORGANIZER') {
  prisma.staffAccount.findUnique.mockResolvedValue({
    id: ACCOUNT,
    active: true,
    role,
    emailHash: 'impronta-account',
  });
  sessione.cookie = await signStaffSession({ id: ACCOUNT, role });
}

const orfana = (extra: Record<string, unknown> = {}) => ({
  id: ORFANA,
  blobName: 'recordings/vecchia.mp4',
  sizeBytes: 1024n,
  lastModified: null,
  discoveredAt: new Date('2026-10-01T00:00:00Z'),
  lastSeenAt: new Date('2026-10-02T00:00:00Z'),
  decision: 'pending',
  note: null,
  ...extra,
});

interface Elenco {
  rows: Array<{ deletesAt: string | null; sizeBytes: string | null }>;
  total: number;
  totalBytes: string;
  graceDays: number;
}
const leggi = async () => (await (await elenca()).json()) as Elenco;

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-delle-registrazioni-orfane-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.orphanRecording.findMany.mockResolvedValue([orfana()]);
  prisma.orphanRecording.updateMany.mockResolvedValue({ count: 1 });
  prisma.siteSetting.findFirst.mockResolvedValue({ orphanRecordingGraceDays: 7 });
});

describe('chi puo’ entrare', () => {
  it('senza sessione e’ 401', async () => {
    sessione.cookie = undefined;
    expect((await elenca()).status).toBe(401);
    expect((await decidi({ ids: [ORFANA], decision: 'ignore' })).status).toBe(401);
    expect(prisma.orphanRecording.findMany).not.toHaveBeenCalled();
    expect(prisma.orphanRecording.updateMany).not.toHaveBeenCalled();
  });

  it('chi organizza e’ rifiutato: i file sono di tutta l’istanza', async () => {
    await entra('ORGANIZER');
    expect((await elenca()).status).toBe(401);
    expect((await decidi({ ids: [ORFANA], decision: 'delete-now' })).status).toBe(401);
    expect(prisma.orphanRecording.findMany).not.toHaveBeenCalled();
    expect(prisma.orphanRecording.updateMany).not.toHaveBeenCalled();
  });
});

describe('GET: quando sparisce un file', () => {
  it('in attesa: alla scadenza del periodo di grazia', async () => {
    const corpo = await leggi();
    expect(corpo.graceDays).toBe(7);
    expect(corpo.rows[0]!.deletesAt).toBe('2026-10-08T00:00:00.000Z');
  });

  it('con «cancella ora»: al prossimo passaggio', async () => {
    prisma.orphanRecording.findMany.mockResolvedValue([
      orfana({ decision: 'delete-now' }),
    ]);
    expect((await leggi()).rows[0]!.deletesAt).toBe('next-sweep');
  });

  it('con «ignora»: mai', async () => {
    prisma.orphanRecording.findMany.mockResolvedValue([orfana({ decision: 'ignore' })]);
    expect((await leggi()).rows[0]!.deletesAt).toBeNull();
  });

  it('con il periodo di grazia a zero la pulizia automatica e’ spenta', async () => {
    prisma.siteSetting.findFirst.mockResolvedValue({ orphanRecordingGraceDays: 0 });
    expect((await leggi()).rows[0]!.deletesAt).toBeNull();
  });

  it('senza impostazioni il periodo e’ di trenta giorni', async () => {
    prisma.siteSetting.findFirst.mockResolvedValue(null);
    const corpo = await leggi();
    expect(corpo.graceDays).toBe(30);
    expect(corpo.rows[0]!.deletesAt).toBe('2026-10-31T00:00:00.000Z');
  });
});

describe('GET: le dimensioni', () => {
  it('sommano come BigInt e viaggiano come testo, anche senza dimensione nota', async () => {
    prisma.orphanRecording.findMany.mockResolvedValue([
      orfana({ sizeBytes: 9_007_199_254_740_993n }),
      orfana({ sizeBytes: 1n }),
      orfana({ sizeBytes: null }),
    ]);
    const corpo = await leggi();
    expect(corpo.total).toBe(3);
    expect(corpo.totalBytes).toBe('9007199254740994');
    expect(corpo.rows.map((r) => r.sizeBytes)).toEqual(['9007199254740993', '1', null]);
  });
});

describe('POST', () => {
  it('un corpo non valido e’ 422, e non si decide niente', async () => {
    const corpi = [
      { ids: [], decision: 'ignore' },
      { ids: ['non-un-uuid'], decision: 'ignore' },
      { ids: [ORFANA], decision: 'cancella' },
      { ids: Array.from({ length: 501 }, () => ORFANA), decision: 'ignore' },
    ];
    for (const corpo of corpi) {
      expect((await decidi(corpo)).status).toBe(422);
    }
    expect(prisma.orphanRecording.updateMany).not.toHaveBeenCalled();
  });

  it('applica la decisione alle sole righe indicate', async () => {
    const r = await decidi({ ids: [ORFANA], decision: 'delete-now' });
    expect(await r.json()).toEqual({ updated: 1, decision: 'delete-now' });
    expect(prisma.orphanRecording.updateMany.mock.calls[0]![0]).toEqual({
      where: { id: { in: [ORFANA] } },
      data: { decision: 'delete-now' },
    });
  });

  it('una decisione si puo’ ritirare', async () => {
    await decidi({ ids: [ORFANA], decision: 'pending' });
    expect(prisma.orphanRecording.updateMany.mock.calls[0]![0].data).toEqual({
      decision: 'pending',
    });
  });

  it('lascia traccia di righe e decisione', async () => {
    await decidi({ ids: [ORFANA], decision: 'ignore' });
    const riga = prisma.adminAuditLog.create.mock.calls[0]![0].data as {
      action: string;
      details: string;
    };
    expect(riga.action).toBe('ORPHAN_RECORDING_DECISION');
    expect(JSON.parse(riga.details)).toEqual({
      ids: [ORFANA],
      decision: 'ignore',
      updated: 1,
    });
  });
});
