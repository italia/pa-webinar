// @vitest-environment node
/**
 * La biblioteca delle pubblicazioni e l’import dei video d’archivio: tutta
 * l’istanza, quindi solo l’amministrazione. Un evento d’archivio nasce concluso,
 * senza sala e senza nulla di interattivo.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, sessione } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    event: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
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
  const request = new Request(`http://localhost/api/admin/publications${query}`);
  return GET(request as never, { params: Promise.resolve({}) });
}

function importa(corpo: unknown) {
  const request = new Request('http://localhost/api/admin/publications', {
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

const evento = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  slug: id,
  title: { it: `Evento ${id}`, en: `Event ${id}` },
  description: { it: 'Descrizione', en: 'Description' },
  eventType: 'SCHEDULED',
  status: 'ENDED',
  startsAt: new Date('2026-10-01T08:00:00Z'),
  endsAt: new Date('2026-10-01T09:00:00Z'),
  libraryListed: false,
  postEventPublic: true,
  coverImageUrl: null,
  imageUrl: null,
  youtubeUrl: null,
  recordingPublished: false,
  recordingUrl: null,
  recordingPublishedAt: null,
  callSessions: [],
  _count: { registrations: 4, callSessions: 0 },
  ...extra,
});

const ARCHIVIO = {
  title: { it: 'Archivio del convegno' },
  startsAt: '2026-03-01T09:00:00Z',
  endsAt: '2026-03-01T11:00:00Z',
  recordingUrl: 'https://storage.example.com/recordings/convegno.mp4',
};

interface Elenco {
  rows: Array<{ id: string; hasPublishedRecording: boolean; title: string }>;
  total: number;
  counters: Record<string, number>;
}
const ids = async (r: Response) => ((await r.json()) as Elenco).rows.map((e) => e.id);

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-delle-pubblicazioni-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.event.findUnique.mockResolvedValue(null);
  prisma.event.create.mockImplementation(async ({ data }: { data: object }) => ({
    id: 'evento-nuovo',
    ...data,
  }));
  prisma.event.findMany.mockResolvedValue([
    evento('programmato', {
      recordingPublished: true,
      recordingUrl: 'https://storage.example.com/a.mp4',
      libraryListed: true,
    }),
    evento('rapido-da-promuovere', {
      eventType: 'INSTANT',
      callSessions: [{ id: 's1' }, { id: 's2' }],
    }),
    evento('rapido-in-biblioteca', {
      eventType: 'INSTANT',
      callSessions: [{ id: 's3' }],
      libraryListed: true,
    }),
    evento('archivio', { eventType: 'LEGACY', libraryListed: true }),
  ]);
});

describe('chi puo’ entrare', () => {
  it('senza sessione e’ 401', async () => {
    sessione.cookie = undefined;
    expect((await elenca()).status).toBe(401);
    expect((await importa(ARCHIVIO)).status).toBe(401);
    expect(prisma.event.findMany).not.toHaveBeenCalled();
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('chi organizza e’ rifiutato: l’elenco riguarda tutta l’istanza', async () => {
    await entra('ORGANIZER');
    expect((await elenca()).status).toBe(401);
    expect((await importa(ARCHIVIO)).status).toBe(401);
    expect(prisma.event.findMany).not.toHaveBeenCalled();
    expect(prisma.event.create).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('filtra per fonte e conta comunque tutto', async () => {
    const r = await elenca('?source=instant');
    const corpo = (await r.json()) as Elenco;
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(corpo.rows.map((e) => e.id)).toEqual([
      'rapido-da-promuovere',
      'rapido-in-biblioteca',
    ]);
    expect(corpo.total).toBe(2);
    expect(corpo.counters).toEqual({
      scheduled: 1,
      instant: 2,
      legacy: 1,
      pending: 1,
      listed: 3,
    });
  });

  it('«da promuovere» sono le sole sessioni registrate fuori biblioteca', async () => {
    expect(await ids(await elenca('?source=pending'))).toEqual(['rapido-da-promuovere']);
  });

  it('filtra per presenza in biblioteca', async () => {
    expect(await ids(await elenca('?listed=no'))).toEqual(['rapido-da-promuovere']);
    expect(await ids(await elenca('?listed=yes'))).toEqual([
      'programmato',
      'rapido-in-biblioteca',
      'archivio',
    ]);
  });

  it('cerca nel titolo e nella descrizione della lingua chiesta', async () => {
    expect(await ids(await elenca('?q=ARCHIVIO&locale=it'))).toEqual(['archivio']);
    expect(await ids(await elenca('?q=evento%20archivio&locale=en'))).toEqual([]);
    expect(await ids(await elenca('?q=event%20archivio&locale=en'))).toEqual([
      'archivio',
    ]);
  });

  it('una registrazione risulta pubblicata solo se ha anche il file', async () => {
    prisma.event.findMany.mockResolvedValue([
      evento('senza-file', { recordingPublished: true, recordingUrl: null }),
    ]);
    const corpo = (await (await elenca()).json()) as Elenco;
    expect(corpo.rows[0]!.hasPublishedRecording).toBe(false);
  });
});

describe('POST', () => {
  it('un corpo non valido e’ 422, e non nasce niente', async () => {
    const { recordingUrl: _senzaVideo, ...senzaVideo } = ARCHIVIO;
    const corpi = [
      senzaVideo,
      { ...ARCHIVIO, title: { it: 'ab' } },
      { ...ARCHIVIO, title: { en: 'Solo in inglese' } },
      { ...ARCHIVIO, recordingUrl: 'non-un-indirizzo' },
      { ...ARCHIVIO, recordingUrl: 'javascript:alert(1)' },
      { ...ARCHIVIO, startsAt: 'ieri' },
      { ...ARCHIVIO, endsAt: '2000-01-01T00:00:00.000Z' },
      { ...ARCHIVIO, youtubeUrl: 'https://video.example.com/1' },
      { ...ARCHIVIO, recordingFileSize: 0 },
    ];
    for (const corpo of corpi) {
      expect((await importa(corpo)).status).toBe(422);
    }
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('l’evento nasce concluso, pubblicato e senza nulla di interattivo', async () => {
    const r = await importa(ARCHIVIO);
    expect(r.status).toBe(201);
    const { data } = prisma.event.create.mock.calls[0]![0];
    expect(data).toMatchObject({
      slug: 'archivio-del-convegno',
      eventType: 'LEGACY',
      status: 'ENDED',
      title: ARCHIVIO.title,
      recordingUrl: ARCHIVIO.recordingUrl,
      recordingPublished: true,
      libraryListed: true,
      maxParticipants: 0,
      qaEnabled: false,
      chatEnabled: false,
      feedbackEnabled: false,
      participantsCanUnmute: false,
      participantsCanStartVideo: false,
      participantsCanShareScreen: false,
    });
    expect(data.startsAt).toEqual(new Date(ARCHIVIO.startsAt));
    expect(data.recordingPublishedAt).toBeInstanceOf(Date);
  });

  it('ogni evento ha un token e una stanza propri', async () => {
    await importa(ARCHIVIO);
    await importa(ARCHIVIO);
    const [primo, secondo] = prisma.event.create.mock.calls.map((c) => c[0].data);
    expect(primo.jitsiRoomName).toMatch(/^legacy-/);
    expect(primo.jitsiRoomName).not.toBe(secondo.jitsiRoomName);
    expect(primo.moderatorToken).not.toBe(secondo.moderatorToken);
  });

  it('uno slug gia’ preso riceve un suffisso', async () => {
    prisma.event.findUnique.mockImplementation(
      async ({ where }: { where: { slug: string } }) =>
        where.slug === 'archivio-del-convegno' ? { id: 'esistente' } : null
    );
    await importa(ARCHIVIO);
    expect(prisma.event.create.mock.calls[0]![0].data.slug).toBe(
      'archivio-del-convegno-2'
    );
  });

  it('si puo’ tenere fuori dalla biblioteca', async () => {
    await importa({ ...ARCHIVIO, libraryListed: false });
    expect(prisma.event.create.mock.calls[0]![0].data.libraryListed).toBe(false);
  });

  it('la dimensione del file si salva come BigInt e torna come numero', async () => {
    const r = await importa({ ...ARCHIVIO, recordingFileSize: 1_048_576 });
    expect(r.status).toBe(201);
    expect(prisma.event.create.mock.calls[0]![0].data.recordingFileSize).toBe(1_048_576n);
    const corpo = (await r.json()) as { recordingFileSize: number };
    expect(corpo.recordingFileSize).toBe(1_048_576);
  });

  it('senza dimensione il campo resta nullo', async () => {
    const corpo = (await (await importa(ARCHIVIO)).json()) as {
      recordingFileSize: unknown;
    };
    expect(corpo.recordingFileSize).toBeNull();
  });

  it('lascia traccia dell’evento creato', async () => {
    await importa(ARCHIVIO);
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'LEGACY_EVENT_CREATE',
      target: 'evento-nuovo',
    });
  });
});
