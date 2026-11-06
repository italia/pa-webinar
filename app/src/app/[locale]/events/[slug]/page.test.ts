// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { NextRequest } from 'next/server';
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
    eventFeedback: { aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn(async (): Promise<unknown[]> => []) },
    questionnaireAnswer: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
    eventQuestionnaire: { findUnique: vi.fn() },
    registration: { count: vi.fn(), findFirst: vi.fn() },
  },
}));
const { biscotti } = vi.hoisted(() => ({ biscotti: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      biscotti.has(name) ? { name, value: biscotti.get(name)! } : undefined,
  }),
}));
vi.mock('@/lib/auth/app-secret', () => ({
  tryGetAppSecret: () => 'segreto-di-prova-abbastanza-lungo-per-hmac',
}));
vi.mock('@/lib/auth/staff-session', () => ({ isEventManager: vi.fn(async () => false) }));
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
vi.mock('@/lib/events/recap', async (originale) => ({
  ...(await originale<typeof ModuloRiepilogo>()),
  ensureEventRecap: vi.fn(async () => null),
}));
vi.mock('@/lib/presentation/recording-slides-data', () => ({
  publicRecordingSlides: vi.fn(async () => null),
}));
vi.mock('@/lib/replay/moments', () => ({
  replayMoments: vi.fn(async () => []),
  programmeVideoTimes: vi.fn(async () => null),
}));
// Il client è un componente pesante: qui conta solo con quali props lo chiama
// la pagina.
vi.mock('@/components/events/event-detail-client', () => ({
  default: function EventDetailClientStub() {
    return null;
  },
}));

import { GET as arrivoDalLink } from '@/app/api/events/[param]/recording/access/route';
import { isEventManager } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { ensureEventRecap, type EventRecap } from '@/lib/events/recap';
import type * as ModuloRiepilogo from '@/lib/events/recap';
import { publicRecordingSlides } from '@/lib/presentation/recording-slides-data';
import { issueViewingToken, viewingCookieName } from '@/lib/recording/viewing';
import { replayMoments } from '@/lib/replay/moments';
import EventDetailClient from '@/components/events/event-detail-client';

import EventDetailPage from './page';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedMaterials = prisma.eventMaterial.findMany as unknown as ReturnType<typeof vi.fn>;
const mockedQuestions = prisma.question.findMany as unknown as ReturnType<typeof vi.fn>;
const mockedRegCount = prisma.registration.count as unknown as ReturnType<typeof vi.fn>;
const mockedRegFirst = prisma.registration.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedManager = isEventManager as unknown as ReturnType<typeof vi.fn>;
const mockedRecap = ensureEventRecap as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const FOTO = '33333333-3333-4333-8333-333333333333';
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
    organizers: [],
    additionalMods: [],
    recordingPublished: false,
    transcriptPublished: false,
    recordingAudience: 'PUBLIC',
    recordingDestination: null,
    recordingUrl: null,
    unrecordedSpeech: false,
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

type Parametri = Awaited<NonNullable<Parameters<typeof EventDetailPage>[0]['searchParams']>>;

/** L'albero che la pagina restituisce. */
async function pagina(searchParams?: Parametri) {
  return (await EventDetailPage({
    params: Promise.resolve({ slug: SLUG }),
    searchParams: Promise.resolve(searchParams ?? {}),
  })) as ReactElement<{ children: ReactNode }>;
}

/** Le props con cui la pagina ha chiamato il client. */
async function clientProps(searchParams?: Parametri): Promise<Record<string, unknown>> {
  const tree = await pagina(searchParams);
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
  biscotti.clear();
  mockedMaterials.mockResolvedValue([MATERIAL_ROW]);
  mockedQuestions.mockResolvedValue([]);
  mockedRegCount.mockResolvedValue(0);
  mockedManager.mockResolvedValue(false);
  mockedRecap.mockResolvedValue(null);
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

describe('scheda dell’evento — chi organizza e interviene', () => {
  it('chiede solo le persone da pubblicare e con un accesso valido', async () => {
    mockedEvent.mockResolvedValue(eventRow());
    await clientProps();
    const args = mockedEvent.mock.calls[0]![0] as {
      include: { additionalMods: { where: Record<string, unknown> } };
    };
    expect(args.include.additionalMods.where).toEqual({ publicListed: true, revokedAt: null });
  });

  it('passa enti e persone al client, con i ruoli e senza loghi esterni', async () => {
    mockedEvent.mockResolvedValue(
      eventRow({
        organizers: [
          { name: 'Ente organizzatore', logoUrl: 'https://cdn.example.com/logo.png', websiteUrl: 'https://ente.example.gov.it' },
        ],
        additionalMods: [
          { name: 'Relatore 1', role: 'SPEAKER', organizer: false, organization: 'Ente 2', organizationLogoUrl: '/api/assets/images/l.png', photoId: FOTO },
          { name: 'Organizzatore 1', role: 'MODERATOR', organizer: true, organization: null, organizationLogoUrl: null, photoId: null },
        ],
      }),
    );
    const props = await clientProps();
    const event = props.event as { organizers: unknown; people: unknown };
    expect(event.organizers).toEqual([
      { name: 'Ente organizzatore', logoUrl: null, websiteUrl: 'https://ente.example.gov.it/' },
    ]);
    expect(event.people).toEqual([
      { name: 'Organizzatore 1', role: 'organizer', organization: null, logoUrl: null, photoUrl: null },
      {
        name: 'Relatore 1',
        role: 'speaker',
        organization: 'Ente 2',
        logoUrl: '/api/assets/images/l.png',
        photoUrl: `/api/avatar/person/${FOTO}`,
      },
    ]);
  });

  it('la foto di chi interviene va anche nei dati strutturati della pagina', async () => {
    mockedEvent.mockResolvedValue(
      eventRow({
        additionalMods: [
          { name: 'Relatore 1', role: 'SPEAKER', organizer: false, organization: null, organizationLogoUrl: null, photoId: FOTO },
          { name: 'Relatore 2', role: 'SPEAKER', organizer: false, organization: null, organizationLogoUrl: null, photoId: null },
        ],
      }),
    );
    const tree = (await EventDetailPage({
      params: Promise.resolve({ slug: SLUG }),
    })) as ReactElement<{ children: ReactNode }>;
    const script = ([] as ReactNode[])
      .concat(tree.props.children)
      .find(
        (c): c is ReactElement<{ dangerouslySetInnerHTML: { __html: string } }> =>
          isValidElement(c) && c.type === 'script',
      );
    const dati = JSON.parse(script!.props.dangerouslySetInnerHTML.__html) as {
      performer: Array<{ name: string; image?: string }>;
    };
    expect(dati.performer[0]!.image).toMatch(new RegExp(`/api/avatar/person/${FOTO}$`));
    expect(dati.performer[1]).not.toHaveProperty('image');
  });

  it("l'organizzatore principale compare solo se scelto, fra chi organizza", async () => {
    mockedEvent.mockResolvedValue(
      eventRow({ moderatorName: 'Contatto 1', moderatorOrganization: 'Ente 1', moderatorPublicListed: false }),
    );
    expect(((await clientProps()).event as { people: unknown[] }).people).toEqual([]);

    mockedEvent.mockResolvedValue(
      eventRow({
        moderatorName: 'Contatto 1',
        moderatorOrganization: 'Ente 1',
        moderatorOrganizationLogoUrl: null,
        moderatorPublicListed: true,
      }),
    );
    expect(((await clientProps()).event as { people: unknown[] }).people).toEqual([
      { name: 'Contatto 1', role: 'organizer', organization: 'Ente 1', logoUrl: null, photoUrl: null },
    ]);
  });
});

describe('scheda dell’evento — programma', () => {
  const agenda = [
    {
      id: 'a1',
      label: 'Apertura',
      plannedMinutes: 10,
      status: 'PENDING',
      speakerGrantId: null,
      speakerPrimary: true,
      speaker: null,
    },
    {
      id: 'a2',
      label: 'Intervento',
      plannedMinutes: 30,
      status: 'PENDING',
      speakerGrantId: 'g-pubblica',
      speakerPrimary: false,
      speaker: { name: 'Relatrice 1', organization: 'Ente', photoId: FOTO, publicListed: true, revokedAt: null },
    },
    {
      id: 'a3',
      label: 'Un caso',
      plannedMinutes: null,
      status: 'PENDING',
      speakerGrantId: 'g-nascosta',
      speakerPrimary: false,
      speaker: { name: 'Persona nascosta', organization: null, photoId: null, publicListed: false, revokedAt: null },
    },
  ];
  const INIZIO = new Date('2030-03-05T09:00:00.000Z');
  const conProgramma = (over: Record<string, unknown> = {}) =>
    eventRow({
      startsAt: INIZIO,
      endsAt: new Date(INIZIO.getTime() + 2 * HOUR),
      agendaEnabled: true,
      agendaItems: agenda,
      moderatorName: 'Organizzatrice',
      moderatorPublicListed: true,
      moderatorOrganization: 'Ente A',
      moderatorOrganizationLogoUrl: null,
      moderatorPhotoId: null,
      ...over,
    });

  async function jsonLd(): Promise<Record<string, unknown>> {
    const tree = (await EventDetailPage({ params: Promise.resolve({ slug: SLUG }) })) as ReactElement<{
      children: ReactNode;
    }>;
    const script = ([] as ReactNode[])
      .concat(tree.props.children)
      .find((c): c is ReactElement<{ dangerouslySetInnerHTML: { __html: string } }> => isValidElement(c) && c.type === 'script');
    return JSON.parse(script!.props.dangerouslySetInnerHTML.__html) as Record<string, unknown>;
  }

  it('passa al client gli argomenti, con chi interviene solo se presentato', async () => {
    mockedEvent.mockResolvedValue(conProgramma());
    const props = await clientProps();
    const programma = (props.event as { programme: unknown[] }).programme;
    expect(programma).toEqual([
      { id: 'a1', label: 'Apertura', plannedMinutes: 10, status: 'PENDING', speaker: { name: 'Organizzatrice', organization: 'Ente A', photoUrl: null } },
      {
        id: 'a2',
        label: 'Intervento',
        plannedMinutes: 30,
        status: 'PENDING',
        speaker: { name: 'Relatrice 1', organization: 'Ente', photoUrl: `/api/avatar/person/${FOTO}` },
      },
      { id: 'a3', label: 'Un caso', plannedMinutes: null, status: 'PENDING', speaker: null },
    ]);
    expect(JSON.stringify(props)).not.toContain('Persona nascosta');
    expect(JSON.stringify(props)).not.toContain('g-nascosta');
  });

  it('nei dati strutturati un sotto-evento per argomento, con gli orari che si conoscono', async () => {
    mockedEvent.mockResolvedValue(conProgramma());
    const ld = await jsonLd();
    const sotto = ld.subEvent as Array<Record<string, unknown>>;
    expect(sotto.map((s) => [s.name, s.startDate ?? null, s.endDate ?? null])).toEqual([
      ['Apertura', '2030-03-05T09:00:00.000Z', '2030-03-05T09:10:00.000Z'],
      ['Intervento', '2030-03-05T09:10:00.000Z', '2030-03-05T09:40:00.000Z'],
      // Senza durata: si sa quando comincia, non quando finisce.
      ['Un caso', '2030-03-05T09:40:00.000Z', null],
    ]);
    expect(sotto[1]?.performer).toEqual({
      '@type': 'Person',
      name: 'Relatrice 1',
      affiliation: { '@type': 'Organization', name: 'Ente' },
    });
    expect(sotto[2]).not.toHaveProperty('performer');
    expect(JSON.stringify(ld)).not.toContain('Persona nascosta');
  });

  it('una persona revocata, o l’organizzatore principale non presentato, non escono', async () => {
    mockedEvent.mockResolvedValue(
      conProgramma({
        moderatorPublicListed: false,
        agendaItems: [{ ...agenda[1], speaker: { ...agenda[1]!.speaker!, revokedAt: new Date() } }, agenda[0]],
      }),
    );
    const props = await clientProps();
    const programma = (props.event as { programme: Array<{ speaker: unknown }> }).programme;
    expect(programma.map((v) => v.speaker)).toEqual([null, null]);
  });

  it('ad agenda spenta nessun programma, ne’ nei dati strutturati', async () => {
    mockedEvent.mockResolvedValue(conProgramma({ agendaEnabled: false }));
    const props = await clientProps();
    expect((props.event as { programme: unknown[] }).programme).toEqual([]);
    expect(await jsonLd()).not.toHaveProperty('subEvent');
  });
});

describe('scheda dell’evento — le domande dopo l’evento', () => {
  const NOME = 'Anna Rossi';
  const RIGA_DOMANDA = {
    id: 'q-1',
    eventId: EVENT_ID,
    registrationId: 'reg-1',
    authorName: NOME,
    text: 'Testo della domanda?',
    answerText: 'Testo della risposta',
    upvoteCount: 4,
    status: 'ANSWERED',
    answeredAt: new Date('2026-09-22T10:10:00.000Z'),
    highlightedAt: null,
    createdAt: new Date('2026-09-22T10:00:00.000Z'),
  };
  const SALVATO: EventRecap = {
    version: 2,
    generatedAt: '2026-09-22T12:00:00.000Z',
    headcount: 10,
    registrations: 20,
    topQuestions: [{ text: 'Domanda più votata', upvotes: 4 }],
    chatQuestions: [{ text: 'Domanda scritta in chat', reactions: 1, answered: false }],
    polls: [],
    topWords: [{ word: 'digitale', count: 3 }],
    feedback: { average: null, count: 0 },
  };
  const concluso = (over: Record<string, unknown> = {}) =>
    eventRow({
      status: 'ENDED',
      startsAt: new Date(Date.now() - 4 * HOUR),
      endsAt: new Date(Date.now() - 2 * HOUR),
      postEventShowQA: true,
      postEventShowRecap: true,
      ...over,
    });

  beforeEach(() => {
    mockedQuestions.mockResolvedValue([RIGA_DOMANDA]);
    mockedRecap.mockResolvedValue(SALVATO);
  });

  it('non chiede il nome di chi ha fatto la domanda, e tiene le date dei momenti del video', async () => {
    mockedEvent.mockResolvedValue(concluso());
    await clientProps();
    const { select } = mockedQuestions.mock.calls[0]?.[0] as { select: Record<string, boolean> };
    expect(select).toEqual({
      id: true,
      text: true,
      answerText: true,
      upvoteCount: true,
      status: true,
      answeredAt: true,
      highlightedAt: true,
    });
  });

  it('nel payload il testo sì, il nome mai', async () => {
    mockedEvent.mockResolvedValue(concluso());
    const props = await clientProps();
    expect(props.answeredQuestions).toEqual([
      {
        id: 'q-1',
        text: 'Testo della domanda?',
        answerText: 'Testo della risposta',
        upvotes: 4,
        status: 'ANSWERED',
      },
    ]);
    const payload = JSON.stringify(props);
    expect(payload).not.toContain('authorName');
    expect(payload).not.toContain(NOME);
  });

  it('nemmeno i dati strutturati nominano chi ha chiesto', async () => {
    mockedEvent.mockResolvedValue(concluso());
    const tree = await pagina();
    const blocchi = ([] as ReactNode[]).concat(tree.props.children);
    const script = blocchi.find(
      (c): c is ReactElement<{ dangerouslySetInnerHTML: { __html: string } }> =>
        isValidElement(c) && c.type === 'script',
    );
    const jsonLd = script!.props.dangerouslySetInnerHTML.__html;
    expect(jsonLd).not.toContain(NOME);
    expect(jsonLd).not.toContain('Testo della domanda');
  });

  it('i momenti del video ricevono le domande con le date', async () => {
    mockedEvent.mockResolvedValue(
      concluso({ recordingPublished: true, recordingUrl: 'https://s.example/v.mp4' }),
    );
    mockedQuestions.mockResolvedValue([
      {
        id: 'q-1',
        text: 'Testo della domanda?',
        answerText: null,
        upvoteCount: 4,
        status: 'ANSWERED',
        answeredAt: RIGA_DOMANDA.answeredAt,
        highlightedAt: null,
      },
    ]);
    await clientProps();
    const fonti = (replayMoments as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      questions: Array<Record<string, unknown>>;
    };
    expect(fonti.questions[0]).toMatchObject({ answeredAt: RIGA_DOMANDA.answeredAt });
  });

  it.each([
    ['su destinazione pubblica', 'PUBLIC'],
    ['senza destinazione', null],
  ])('con il video reso riservato dal pubblico %s nessuna domanda esce', async (_n, recordingDestination) => {
    mockedEvent.mockResolvedValue(
      concluso({ recordingAudience: 'REGISTRANTS', recordingDestination }),
    );
    const props = await clientProps();
    expect(mockedQuestions).not.toHaveBeenCalled();
    expect(props.answeredQuestions).toEqual([]);
    expect(JSON.stringify(props)).not.toContain(SALVATO.topQuestions[0]!.text);
    expect((props.event as { postEventShowQA: boolean }).postEventShowQA).toBe(false);
  });

  it('le domande in chat non arrivano al client, anche da uno snapshot salvato', async () => {
    mockedEvent.mockResolvedValue(concluso());
    const props = await clientProps();
    expect(props.recap).not.toHaveProperty('chatQuestions');
    expect(JSON.stringify(props)).not.toContain('Domanda scritta in chat');
    expect((props.recap as EventRecap).topQuestions).toEqual(SALVATO.topQuestions);
  });

  it.each([
    ['domande spente', { postEventShowQA: false }],
    ['Q&A mai acceso in sala', { qaEnabled: false }],
    ['riepilogo spento', { postEventShowRecap: false }],
    ['registrazione riservata', { recordingDestination: 'REGISTRANTS', recordingAudience: 'REGISTRANTS' }],
  ])('con %s nessun testo di domanda dal riepilogo', async (_caso, over) => {
    mockedEvent.mockResolvedValue(concluso(over));
    const props = await clientProps();
    expect((props.recap as EventRecap).topQuestions).toEqual([]);
    expect(JSON.stringify(props)).not.toContain('Domanda più votata');
  });

  it.each([
    ['domande spente', { postEventShowQA: false }],
    ['Q&A mai acceso in sala', { qaEnabled: false }],
    ['registrazione riservata', { recordingDestination: 'REGISTRANTS', recordingAudience: 'REGISTRANTS' }],
  ])('con %s la scheda delle domande non si legge nemmeno', async (_caso, over) => {
    mockedEvent.mockResolvedValue(concluso(over));
    const props = await clientProps();
    expect(mockedQuestions).not.toHaveBeenCalled();
    expect(props.answeredQuestions).toEqual([]);
    expect((props.event as { postEventShowQA: boolean }).postEventShowQA).toBe(false);
  });

  it('a riepilogo spento le parole restano: le usa la loro sezione', async () => {
    mockedEvent.mockResolvedValue(concluso({ postEventShowRecap: false }));
    const props = await clientProps();
    expect((props.recap as EventRecap).topWords).toEqual(SALVATO.topWords);
  });
});

describe('scheda dell’evento — registrazione riservata con la pagina privata', () => {
  const REG_ID = 'reg-1';
  const VIDEO = 'https://storage.example.net/recordings/sala.mp4';
  const YOUTUBE = 'https://www.youtube.com/watch?v=abc';
  const riservata = (over: Record<string, unknown> = {}) =>
    eventRow({
      status: 'ENDED',
      startsAt: new Date(Date.now() - 4 * HOUR),
      endsAt: new Date(Date.now() - 2 * HOUR),
      postEventPublic: false,
      recordingAudience: 'REGISTRANTS',
      recordingDestination: 'REGISTRANTS',
      recordingPublished: true,
      recordingUrl: VIDEO,
      ...over,
    });
  /** Il browser di chi ha aperto il link personale. */
  const iscritto = () => {
    biscotti.set(viewingCookieName(EVENT_ID), issueViewingToken(EVENT_ID, REG_ID)!);
    mockedRegCount.mockResolvedValue(1);
  };
  const eventoDi = (props: Record<string, unknown>) =>
    props.event as { recordingUrl: string | null; youtubeUrl: string | null; transcriptPublished: boolean };

  it('l’iscritto trova la pagina con il video', async () => {
    mockedEvent.mockResolvedValue(riservata());
    iscritto();
    const props = await clientProps();
    expect(eventoDi(props).recordingUrl).toBe(VIDEO);
    expect(props.recordingForRegistrants).toBe(false);
    expect(props.previewForStaff).toBe(false);
    expect(publicRecordingSlides).toHaveBeenCalled();
  });

  it('il link personale arriva a una pagina resa', async () => {
    mockedEvent.mockResolvedValue(riservata());
    mockedRegFirst.mockResolvedValue({ locale: 'it' });
    mockedRegCount.mockResolvedValue(1);
    const token = issueViewingToken(EVENT_ID, REG_ID)!;
    const risposta = await arrivoDalLink(
      new Request(
        `https://webinar.example.gov.it/api/events/${SLUG}/recording/access?t=${encodeURIComponent(token)}`,
      ) as unknown as NextRequest,
      { params: Promise.resolve({ param: SLUG }) },
    );
    expect(risposta.status).toBe(303);
    expect(risposta.headers.get('Location')).toContain(`/it/eventi/${SLUG}`);

    // Cio' che il browser fa dopo il rimando: torna con il cookie appena posato.
    const [nome, valore] = (risposta.headers.get('Set-Cookie') ?? '').split(';')[0]!.split('=');
    biscotti.set(nome!, valore!);
    expect(eventoDi(await clientProps()).recordingUrl).toBe(VIDEO);
  });

  it('con la sola trascrizione la pagina si apre: il link porta anche lì', async () => {
    mockedEvent.mockResolvedValue(
      riservata({ recordingPublished: false, transcriptPublished: true }),
    );
    iscritto();
    const props = await clientProps();
    expect(eventoDi(props).transcriptPublished).toBe(true);
    expect(eventoDi(props).recordingUrl).toBeNull();
  });

  it('chi non prova l’iscrizione trova 404', async () => {
    mockedEvent.mockResolvedValue(riservata());
    await expect(pagina()).rejects.toThrow('NOT_FOUND');
  });

  it('un’iscrizione cancellata, anche dalla pulizia dei dati, non apre più', async () => {
    mockedEvent.mockResolvedValue(riservata());
    iscritto();
    mockedRegCount.mockResolvedValue(0);
    await expect(pagina()).rejects.toThrow('NOT_FOUND');
  });

  it('non pubblicata, o oltre la finestra: 404 anche all’iscritto', async () => {
    iscritto();
    mockedEvent.mockResolvedValue(riservata({ recordingPublished: false }));
    await expect(pagina()).rejects.toThrow('NOT_FOUND');
    mockedEvent.mockResolvedValue(riservata({ postEventPublicUntil: new Date(Date.now() - HOUR) }));
    await expect(pagina()).rejects.toThrow('NOT_FOUND');
  });

  it('un evento senza destinazione resta com’era: pagina privata, 404 anche all’iscritto', async () => {
    mockedEvent.mockResolvedValue(riservata({ recordingDestination: null }));
    iscritto();
    await expect(pagina()).rejects.toThrow('NOT_FOUND');
  });

  it('un evento archiviato non ha una pagina, nemmeno per l’iscritto', async () => {
    mockedEvent.mockResolvedValue(riservata({ status: 'ARCHIVED' }));
    iscritto();
    await expect(pagina()).rejects.toThrow('NOT_FOUND');
  });

  it('lo staff entra solo chiedendo l’anteprima, come prima', async () => {
    mockedEvent.mockResolvedValue(riservata());
    mockedManager.mockResolvedValue(true);
    await expect(pagina()).rejects.toThrow('NOT_FOUND');
    const props = await clientProps({ anteprima: '1' });
    expect(props.previewForStaff).toBe(true);
    expect(eventoDi(props).recordingUrl).toBe(VIDEO);
  });

  it('iscritto e staff insieme: il link personale apre la pagina in anteprima', async () => {
    mockedEvent.mockResolvedValue(riservata());
    mockedManager.mockResolvedValue(true);
    mockedRegFirst.mockResolvedValue({ locale: 'it' });
    mockedRegCount.mockResolvedValue(1);
    const token = issueViewingToken(EVENT_ID, REG_ID)!;
    const risposta = await arrivoDalLink(
      new Request(
        `https://webinar.example.gov.it/api/events/${SLUG}/recording/access?t=${encodeURIComponent(token)}`,
      ) as unknown as NextRequest,
      { params: Promise.resolve({ param: SLUG }) },
    );
    const dove = new URL(risposta.headers.get('Location')!);
    const [nome, valore] = (risposta.headers.get('Set-Cookie') ?? '').split(';')[0]!.split('=');
    biscotti.set(nome!, valore!);
    const props = await clientProps({ anteprima: dove.searchParams.get('anteprima') ?? '' });
    expect(eventoDi(props).recordingUrl).toBe(VIDEO);
  });

  it('con la pagina visibile chi non è iscritto legge che è riservata, senza il video', async () => {
    mockedEvent.mockResolvedValue(riservata({ postEventPublic: true }));
    const props = await clientProps();
    expect(props.recordingForRegistrants).toBe(true);
    expect(eventoDi(props).recordingUrl).toBeNull();
  });

  describe('resoconto', () => {
    const RESOCONTO = {
      postEventReportPublished: true,
      postEventReport: {
        version: 1,
        generatedAt: '2026-10-20T10:00:00.000Z',
        sourceLanguage: 'it',
        model: { id: 'm', version: null },
        metrics: null,
        narratives: {
          it: {
            title: 'Resoconto di prova',
            abstract: 'Sintesi di prova',
            summary: '',
            highlights: [],
            topics: [],
            conceptMap: { nodes: [], edges: [] },
            consensus: { summary: '', agreements: [], disagreements: [] },
            engagement: { summary: '', observations: [] },
            benefits: { summary: '', items: [] },
            feedback: { summary: '', strengths: [], improvements: [], quotes: [] },
            openQuestions: [],
            nextSteps: [],
          },
        },
      },
    };

    it('riservata con la pagina visibile: solo chi vede la registrazione', async () => {
      mockedEvent.mockResolvedValue(riservata({ postEventPublic: true, ...RESOCONTO }));
      expect((await clientProps()).report).toBeNull();
      iscritto();
      expect((await clientProps()).report).toMatchObject({ language: 'it' });
    });

    it('riservata senza nulla di pubblicato: resta chiuso, salvo l’anteprima dello staff', async () => {
      mockedEvent.mockResolvedValue(
        riservata({ postEventPublic: true, recordingPublished: false, ...RESOCONTO }),
      );
      iscritto();
      expect((await clientProps()).report).toBeNull();
      mockedManager.mockResolvedValue(true);
      expect((await clientProps()).report).toBeNull();
      expect((await clientProps({ anteprima: '1' })).report).toMatchObject({ language: 'it' });
    });

    it('per tutti, anche senza video pubblicato: lo vede chiunque', async () => {
      mockedEvent.mockResolvedValue(
        riservata({
          postEventPublic: true,
          recordingAudience: 'PUBLIC',
          recordingDestination: 'PUBLIC',
          recordingPublished: false,
          ...RESOCONTO,
        }),
      );
      expect((await clientProps()).report).toMatchObject({ language: 'it' });
    });

    it('un evento senza destinazione resta com’era', async () => {
      mockedEvent.mockResolvedValue(
        riservata({ postEventPublic: true, recordingDestination: null, ...RESOCONTO }),
      );
      expect((await clientProps()).report).toMatchObject({ language: 'it' });
    });
  });

  describe('link su YouTube', () => {
    it('riservata: lo vede solo chi vede il video', async () => {
      mockedEvent.mockResolvedValue(riservata({ postEventPublic: true, youtubeUrl: YOUTUBE }));
      expect(eventoDi(await clientProps()).youtubeUrl).toBeNull();
      iscritto();
      expect(eventoDi(await clientProps()).youtubeUrl).toBe(YOUTUBE);
    });

    it('riservata: con il solo link, senza video pubblicato, non esce', async () => {
      mockedEvent.mockResolvedValue(
        riservata({ postEventPublic: true, recordingPublished: false, youtubeUrl: YOUTUBE }),
      );
      iscritto();
      expect(eventoDi(await clientProps()).youtubeUrl).toBeNull();
    });

    it('ristretta dallo staff su un evento nato pubblico: segue il video', async () => {
      mockedEvent.mockResolvedValue(
        riservata({ postEventPublic: true, recordingDestination: 'PUBLIC', youtubeUrl: YOUTUBE }),
      );
      expect(eventoDi(await clientProps()).youtubeUrl).toBeNull();
    });

    it('per tutti, anche con il solo link: il pubblico lo vede', async () => {
      mockedEvent.mockResolvedValue(
        riservata({
          postEventPublic: true,
          recordingAudience: 'PUBLIC',
          recordingDestination: 'PUBLIC',
          recordingPublished: false,
          recordingUrl: null,
          youtubeUrl: YOUTUBE,
        }),
      );
      expect(eventoDi(await clientProps()).youtubeUrl).toBe(YOUTUBE);
    });

    it('un evento senza destinazione resta com’era', async () => {
      for (const recordingAudience of ['PUBLIC', 'REGISTRANTS']) {
        mockedEvent.mockResolvedValue(
          riservata({
            postEventPublic: true,
            recordingAudience,
            recordingDestination: null,
            recordingPublished: false,
            recordingUrl: null,
            youtubeUrl: YOUTUBE,
          }),
        );
        expect(eventoDi(await clientProps()).youtubeUrl).toBe(YOUTUBE);
      }
    });
  });
});
