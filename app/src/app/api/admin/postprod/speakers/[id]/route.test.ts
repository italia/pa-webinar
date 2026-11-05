// @vitest-environment node
/**
 * Dare un nome a un relatore riconosciuto dalla post-produzione: lo fa chi
 * gestisce l’evento. Collegarlo a una persona vuol dire leggere la rubrica, che
 * e’ dell’amministrazione: chi organizza rinomina e scollega, non collega.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, sessione } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    event: { count: vi.fn() },
    speaker: { findUnique: vi.fn(), update: vi.fn() },
    person: { findUnique: vi.fn() },
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
import { encryptPII, tryDecryptPII } from '@/lib/crypto/pii';

import { PUT } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const EVENTO = '22222222-2222-4222-8222-222222222222';
const RELATORE = '55555555-5555-4555-8555-555555555555';
const PERSONA = '66666666-6666-4666-8666-666666666666';

function assegna(corpo: unknown, id = RELATORE) {
  const request = new Request(`http://localhost/api/admin/postprod/speakers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return PUT(request as never, { params: Promise.resolve({ id }) });
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

const scrittura = () =>
  prisma.speaker.update.mock.calls[0]![0] as {
    where: { id: string };
    data: { displayName: string | null; personId?: string | null };
  };

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.APP_SECRET = 'segreto-di-prova-della-post-produzione-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.event.count.mockResolvedValue(0);
  prisma.speaker.findUnique.mockResolvedValue({
    id: RELATORE,
    recordingId: 'registrazione-1',
    diarLabel: 'SPEAKER_00',
    recording: { eventId: EVENTO },
  });
  prisma.person.findUnique.mockResolvedValue({ displayName: encryptPII('Anna Bianchi') });
  prisma.speaker.update.mockImplementation(async ({ data }: { data: object }) => ({
    id: RELATORE,
    personId: null,
    ...data,
  }));
});

describe('chi puo’ assegnare', () => {
  it('senza sessione e’ 401', async () => {
    sessione.cookie = undefined;
    expect((await assegna({ displayName: 'Relatore 1' })).status).toBe(401);
    expect(prisma.speaker.update).not.toHaveBeenCalled();
  });

  it('il relatore di un altro organizzatore e’ 403', async () => {
    await entra('ORGANIZER');
    expect((await assegna({ displayName: 'Relatore 1' })).status).toBe(403);
    expect(prisma.event.count.mock.calls[0]![0].where).toMatchObject({
      id: EVENTO,
      AND: [{ OR: expect.arrayContaining([{ createdById: ACCOUNT }]) }],
    });
    expect(prisma.speaker.update).not.toHaveBeenCalled();
  });

  it('per chi organizza, un relatore inesistente risponde come uno altrui', async () => {
    await entra('ORGANIZER');
    prisma.speaker.findUnique.mockResolvedValue(null);
    expect((await assegna({ displayName: 'Relatore 1' })).status).toBe(403);
    expect(prisma.speaker.update).not.toHaveBeenCalled();
  });

  it('per l’amministrazione un relatore inesistente e’ 404', async () => {
    prisma.speaker.findUnique.mockResolvedValue(null);
    expect((await assegna({ displayName: 'Relatore 1' })).status).toBe(404);
    expect(prisma.speaker.update).not.toHaveBeenCalled();
  });
});

describe('chi organizza, sul proprio evento', () => {
  beforeEach(async () => {
    await entra('ORGANIZER');
    prisma.event.count.mockResolvedValue(1);
  });

  it('rinomina', async () => {
    expect((await assegna({ displayName: 'Relatore 1' })).status).toBe(200);
    expect(scrittura()).toEqual({
      where: { id: RELATORE },
      data: { displayName: 'Relatore 1' },
    });
  });

  it('non collega una persona: la rubrica non si legge nemmeno', async () => {
    const r = await assegna({ displayName: null, personId: PERSONA });
    expect(r.status).toBe(403);
    expect(prisma.person.findUnique).not.toHaveBeenCalled();
    expect(prisma.speaker.update).not.toHaveBeenCalled();
  });

  it('scollega una persona: togliere il collegamento non legge niente', async () => {
    expect((await assegna({ displayName: 'Relatore 1', personId: null })).status).toBe(
      200
    );
    expect(prisma.person.findUnique).not.toHaveBeenCalled();
    expect(scrittura().data).toEqual({ displayName: 'Relatore 1', personId: null });
  });
});

describe('cosa si accetta', () => {
  it('un corpo che non e’ JSON e’ 400, non un errore del server', async () => {
    const request = new Request('http://localhost/x', {
      method: 'PUT',
      body: 'non json',
    });
    const r = await PUT(request as never, { params: Promise.resolve({ id: RELATORE }) });
    expect(r.status).toBe(400);
  });

  it('un corpo non valido e’ 422, e non si scrive niente', async () => {
    const corpi = [
      {},
      { displayName: '' },
      { displayName: 'x'.repeat(201) },
      { displayName: 'Relatore 1', personId: 'non-un-uuid' },
    ];
    for (const corpo of corpi) {
      expect((await assegna(corpo)).status).toBe(422);
    }
    expect(prisma.speaker.update).not.toHaveBeenCalled();
  });
});

describe('il collegamento alla rubrica', () => {
  it('senza un nome dato vale quello della rubrica, decifrato', async () => {
    const cifrato = encryptPII('Anna Bianchi');
    prisma.person.findUnique.mockResolvedValue({ displayName: cifrato });
    const r = await assegna({ displayName: null, personId: PERSONA });
    expect(r.status).toBe(200);
    expect(prisma.person.findUnique.mock.calls[0]![0].where).toEqual({ id: PERSONA });
    const { data } = scrittura();
    expect(data.personId).toBe(PERSONA);
    expect(data.displayName).not.toBe(cifrato);
    expect(tryDecryptPII(data.displayName)).toBe('Anna Bianchi');
  });

  it('una persona senza nome lascia il nome vuoto, non una stringa vuota', async () => {
    prisma.person.findUnique.mockResolvedValue({ displayName: null });
    await assegna({ displayName: null, personId: PERSONA });
    expect(scrittura().data.displayName).toBeNull();
  });

  it('un nome dato vince su quello della rubrica', async () => {
    await assegna({ displayName: 'Dott.ssa Bianchi', personId: PERSONA });
    expect(scrittura().data).toEqual({
      displayName: 'Dott.ssa Bianchi',
      personId: PERSONA,
    });
  });

  it('una persona che non esiste e’ 404', async () => {
    prisma.person.findUnique.mockResolvedValue(null);
    expect((await assegna({ displayName: null, personId: PERSONA })).status).toBe(404);
    expect(prisma.speaker.update).not.toHaveBeenCalled();
  });

  it('rinominare non tocca un collegamento gia’ fatto', async () => {
    await assegna({ displayName: 'Altro nome' });
    expect(scrittura().data).not.toHaveProperty('personId');
    expect(prisma.person.findUnique).not.toHaveBeenCalled();
  });

  it('nome e collegamento nulli azzerano l’associazione', async () => {
    await assegna({ displayName: null, personId: null });
    expect(scrittura().data).toEqual({ displayName: null, personId: null });
  });
});

describe('la traccia', () => {
  it('dice quale relatore di quale registrazione', async () => {
    await assegna({ displayName: 'Relatore 1' });
    const riga = prisma.adminAuditLog.create.mock.calls[0]![0].data as {
      action: string;
      target: string;
      details: string;
    };
    expect(riga).toMatchObject({ action: 'POSTPROD_SPEAKER_MAP', target: RELATORE });
    expect(JSON.parse(riga.details)).toMatchObject({
      recordingId: 'registrazione-1',
      diarLabel: 'SPEAKER_00',
    });
  });
});
