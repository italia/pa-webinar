import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * I materiali che la scheda pubblica dell'evento passa al client.
 *
 * Prima dell'inizio la scheda è l'unica superficie in cui il pubblico può
 * trovare un materiale «prima dell'evento»: in sala si entra solo in diretta,
 * dove la fase è già «durante». Qui si verifica che la pagina li chieda al DB
 * con il filtro della fase giusta, e che in diretta non ne elenchi nessuno.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventMaterial: { findMany: vi.fn() },
    question: { findMany: vi.fn() },
    poll: { findMany: vi.fn() },
    eventFeedback: { aggregate: vi.fn(), groupBy: vi.fn() },
    eventQuestionnaire: { findUnique: vi.fn() },
  },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'it',
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({
    organizationName: 'Ente di prova',
    organizationUrl: '',
    siteName: 'PA Webinar',
    publicRegistrationEnabled: true,
    guestAccessEnabled: false,
    parseTitleKicker: false,
    ogCardEnabled: false,
    seoImage: null,
  })),
}));
vi.mock('@/lib/event-session', () => ({
  eventAccessCookieName: (id: string) => `event_access_${id}`,
  verifyEventAccess: vi.fn(async () => null),
}));
vi.mock('@/lib/events/registration-access', () => ({
  registrationAccessFor: vi.fn(async () => 'open'),
}));
vi.mock('@/lib/events/recap', () => ({
  ensureEventRecap: vi.fn(async () => null),
}));
// Il client è un componente pesante: qui conta solo con quali props lo chiama
// la pagina.
vi.mock('@/components/events/event-detail-client', () => ({
  default: function EventDetailClientStub() {
    return null;
  },
}));

import { prisma } from '@/lib/db';
import EventDetailClient from '@/components/events/event-detail-client';

import EventDetailPage from './page';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedMaterials = prisma.eventMaterial.findMany as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const SLUG = 'evento-di-prova';
const HOUR = 60 * 60 * 1000;

function eventRow(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: EVENT_ID,
    slug: SLUG,
    title: { it: 'Evento di prova' },
    description: { it: 'Descrizione' },
    status: 'PUBLISHED',
    eventType: 'SCHEDULED',
    startsAt: new Date(now + 2 * HOUR),
    endsAt: new Date(now + 4 * HOUR),
    timezone: 'Europe/Rome',
    maxParticipants: 100,
    _count: { registrations: 0 },
    tagLinks: [],
    recordingPublished: false,
    recordingUrl: null,
    youtubeUrl: null,
    qaEnabled: true,
    chatEnabled: true,
    recordingEnabled: false,
    participantsCanUnmute: false,
    participantsCanStartVideo: false,
    participantsCanShareScreen: false,
    privacyPolicyUrl: null,
    speakersInfo: null,
    organizerName: null,
    imageUrl: null,
    coverImageUrl: null,
    peakParticipants: 0,
    postEventPublic: true,
    postEventPublicUntil: null,
    postEventShowQA: false,
    postEventShowMaterials: true,
    postEventShowPolls: false,
    postEventShowFeedback: false,
    postEventShowRecap: false,
    postEventShowWordCloud: false,
    dataRetentionDays: 30,
    parseTitleKicker: null,
    updatedAt: new Date(now),
    ...over,
  };
}

const MATERIAL_ROW = {
  id: 'mat-1',
  eventId: EVENT_ID,
  type: 'LINK',
  title: 'Lettura preparatoria',
  url: 'https://example.org/lettura',
  description: null,
  addedBy: 'Moderatore',
  fileName: null,
  fileSize: null,
  mimeType: null,
  blobPath: null,
  visibility: 'BEFORE',
  createdAt: new Date('2026-09-22T10:00:00.000Z'),
};

/** Le props con cui la pagina ha chiamato il client. */
async function clientProps(): Promise<Record<string, unknown>> {
  const tree = (await EventDetailPage({
    params: Promise.resolve({ slug: SLUG }),
  })) as ReactElement<{ children: ReactNode }>;
  const children = ([] as ReactNode[]).concat(tree.props.children);
  const client = children.find(
    (c): c is ReactElement<Record<string, unknown>> =>
      isValidElement(c) && c.type === EventDetailClient,
  );
  expect(client, 'la pagina non ha reso il client').toBeDefined();
  return client!.props;
}

function whereInterrogato(): Record<string, unknown> {
  const call = mockedMaterials.mock.calls[0]?.[0] as { where: Record<string, unknown> } | undefined;
  expect(call, 'nessuna interrogazione ai materiali').toBeDefined();
  return call!.where;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedMaterials.mockResolvedValue([MATERIAL_ROW]);
});

describe('scheda dell’evento — materiali per il pubblico', () => {
  it('prima dell’inizio elenca solo i materiali scelti per il prima', async () => {
    // Il predefinito (ALWAYS, «in sala e dopo l'evento») resta fuori: sulla
    // scheda pubblica prima dell'inizio compare solo ciò che chi organizza ha
    // marcato esplicitamente «Prima dell'evento».
    mockedEvent.mockResolvedValue(eventRow());
    const props = await clientProps();
    expect(whereInterrogato()).toEqual({
      eventId: EVENT_ID,
      visibility: { in: ['BEFORE'] },
    });
    expect(props.materials).toEqual([
      {
        id: 'mat-1',
        title: 'Lettura preparatoria',
        url: 'https://example.org/lettura',
        description: null,
        addedBy: 'Moderatore',
        createdAt: '2026-09-22T10:00:00.000Z',
      },
    ]);
  });

  it('vale anche durante il pre-riscaldamento della sala', async () => {
    mockedEvent.mockResolvedValue(eventRow({ status: 'PROVISIONING' }));
    await clientProps();
    expect(whereInterrogato()).toEqual({
      eventId: EVENT_ID,
      visibility: { in: ['BEFORE'] },
    });
  });

  it('in diretta non elenca niente: i materiali li mostra la sala', async () => {
    mockedEvent.mockResolvedValue(
      eventRow({
        status: 'LIVE',
        startsAt: new Date(Date.now() - HOUR),
        endsAt: new Date(Date.now() + HOUR),
      }),
    );
    const props = await clientProps();
    expect(mockedMaterials).not.toHaveBeenCalled();
    expect(props.materials).toEqual([]);
  });

  it('dall’orario d’inizio i preparatori spariscono anche se la sala non è ancora in diretta', async () => {
    mockedEvent.mockResolvedValue(
      eventRow({ startsAt: new Date(Date.now() - 60_000) }),
    );
    const props = await clientProps();
    expect(mockedMaterials).not.toHaveBeenCalled();
    expect(props.materials).toEqual([]);
  });

  it('a evento concluso elenca quelli «in sala e dopo» e quelli del dopo', async () => {
    mockedEvent.mockResolvedValue(
      eventRow({
        status: 'ENDED',
        startsAt: new Date(Date.now() - 4 * HOUR),
        endsAt: new Date(Date.now() - 2 * HOUR),
      }),
    );
    await clientProps();
    expect(mockedMaterials).toHaveBeenCalledTimes(1);
    expect(whereInterrogato()).toEqual({
      eventId: EVENT_ID,
      visibility: { in: ['ALWAYS', 'AFTER'] },
    });
  });
});

describe('scheda dell’evento — iscrizione decisa dal server', () => {
  it('un evento in programma accetta iscrizioni', async () => {
    mockedEvent.mockResolvedValue(eventRow());
    const props = await clientProps();
    expect(props.registrationOpen).toBe(true);
  });

  it('oltre l’orario di fine senza che la sala si sia aperta: iscrizione chiusa', async () => {
    // Stato ancora PUBLISHED perché il giro del ciclo di vita non è passato:
    // la pagina d'iscrizione risponde 404 e la POST 409, il pulsante non deve
    // portarci.
    mockedEvent.mockResolvedValue(
      eventRow({
        startsAt: new Date(Date.now() - 3 * HOUR),
        endsAt: new Date(Date.now() - HOUR),
      }),
    );
    const props = await clientProps();
    expect(props.registrationOpen).toBe(false);
  });

  it('in diretta resta aperta anche oltre l’orario di fine', async () => {
    mockedEvent.mockResolvedValue(
      eventRow({
        status: 'LIVE',
        startsAt: new Date(Date.now() - 3 * HOUR),
        endsAt: new Date(Date.now() - 10 * 60_000),
      }),
    );
    const props = await clientProps();
    expect(props.registrationOpen).toBe(true);
  });
});

describe('scheda dell’evento — invito al questionario post-evento', () => {
  const mockedQuestionnaire = prisma.eventQuestionnaire.findUnique as unknown as ReturnType<
    typeof vi.fn
  >;

  function concluso(over: Record<string, unknown> = {}) {
    return eventRow({
      status: 'ENDED',
      startsAt: new Date(Date.now() - 4 * HOUR),
      endsAt: new Date(Date.now() - 2 * HOUR),
      postEventShowFeedback: true,
      ...over,
    });
  }

  /** Il questionario esiste: risponde alla domanda «c'è?» (select id) e non
   *  ha risposte per il riepilogo delle stelle. */
  function conQuestionario() {
    mockedQuestionnaire.mockImplementation(async (args: { select?: { id?: boolean } }) =>
      args.select?.id ? { id: 'questionario-1' } : { _count: { responses: 0 }, responses: [] },
    );
  }

  it('evento concluso con questionario: la pagina lo dice al client', async () => {
    conQuestionario();
    mockedEvent.mockResolvedValue(concluso());
    const props = await clientProps();
    expect(props.hasPostEventQuestionnaire).toBe(true);
    expect(mockedQuestionnaire).toHaveBeenCalledWith({
      where: { eventId_placement: { eventId: EVENT_ID, placement: 'POST_EVENT' } },
      select: { id: true },
    });
  });

  it('senza questionario niente invito, quindi nessuna richiesta che finisce in 404', async () => {
    mockedQuestionnaire.mockResolvedValue(null);
    mockedEvent.mockResolvedValue(concluso());
    const props = await clientProps();
    expect(props.hasPostEventQuestionnaire).toBe(false);
  });

  it('con il feedback pubblico spento non chiede nemmeno se il questionario c’è', async () => {
    conQuestionario();
    mockedEvent.mockResolvedValue(concluso({ postEventShowFeedback: false }));
    const props = await clientProps();
    expect(props.hasPostEventQuestionnaire).toBe(false);
    expect(mockedQuestionnaire).not.toHaveBeenCalled();
  });

  it('prima della fine non serve', async () => {
    conQuestionario();
    mockedEvent.mockResolvedValue(eventRow({ postEventShowFeedback: true }));
    const props = await clientProps();
    expect(props.hasPostEventQuestionnaire).toBe(false);
    expect(mockedQuestionnaire).not.toHaveBeenCalled();
  });
});
