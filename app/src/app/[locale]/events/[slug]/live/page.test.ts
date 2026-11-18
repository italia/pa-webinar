// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cio' che la pagina della sala passa al client, nei suoi due rami: chi arriva
 * senza token e chi ha un token. Il client gira nel browser, quindi quello che
 * la pagina gli passa e' gia' pubblico: qui si fissa che il video non ci arrivi
 * mai come indirizzo, che le domande seguano la regola della pagina pubblica, e
 * che la sala chieda il consenso a chi il token escluderebbe dal video.
 */
const stato = vi.hoisted(() => ({
  biscotti: new Map<string, string>(),
  impostazioni: {} as Record<string, unknown>,
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn(), count: vi.fn(async () => 0) },
    recordingConsent: {
      findFirst: vi.fn(async (): Promise<unknown> => null),
      findMany: vi.fn(async (): Promise<unknown[]> => []),
    },
    multitrackConsent: { count: vi.fn(async (): Promise<number> => 0) },
  },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = stato.biscotti.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'it' }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn(async () => stato.impostazioni) }));
vi.mock('@/lib/event-session', () => ({
  eventAccessCookieName: (id: string) => `event_access_${id}`,
  verifyEventAccess: vi.fn(async (_id: string, valore?: string) => valore ?? null),
}));
vi.mock('@/lib/auth/moderator', () => ({
  resolveGrantForEvent: vi.fn(async () => null),
}));
vi.mock('@/lib/auth/staff-seat', () => ({
  staffDietroIlPrimario: vi.fn(async () => null),
}));
vi.mock('@/lib/auth/staff-session', () => ({ isEventManager: vi.fn(async () => false) }));
// Lo staff che gestisce l'evento, qui, lo organizza (test/contenuto-come-gestore).
vi.mock('@/lib/recording/content-access', () => import('@/test/contenuto-come-gestore'));
vi.mock('@/lib/events/meta-title', () => ({
  anteprimaEventoPubblico: vi.fn(async () => null),
}));
vi.mock('@/lib/events/privacy-notice', () => ({
  informativaEvento: () => ({ url: '/privacy' }),
}));
vi.mock('@/lib/events/public-people', () => ({
  PERSONE_PUBBLICHE_INCLUDE: {},
  entiEPersonePubblici: () => ({ enti: [], persone: [] }),
}));
// Il client e' pesante: qui conta solo con quali props lo chiama la pagina.
vi.mock('@/components/live/live-event-client', () => ({
  default: function LiveEventClientStub() {
    return null;
  },
}));
vi.mock('@/components/admin/admin-session-keepalive', () => ({
  default: function KeepAliveStub() {
    return null;
  },
}));

import { prisma } from '@/lib/db';
import { resolveGrantForEvent } from '@/lib/auth/moderator';
import { staffDietroIlPrimario } from '@/lib/auth/staff-seat';
import { isEventManager } from '@/lib/auth/staff-session';
import LiveEventClient from '@/components/live/live-event-client';
import type { SchedaPrivacy } from '@/lib/events/privacy-sheet';

import LivePage from './page';

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const REGISTRATION_ID = '44444444-4444-4444-8444-444444444444';
const SLUG = 'evento-di-prova';
const TOKEN = 'token-dell-iscrizione';
const VIDEO = 'https://storage.example.org/recordings/video-riservato.mp4';
const RECUPERO = 'https://storage.example.org/recordings/recupero.mp4';
const HOUR = 60 * 60 * 1000;

function eventRow(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: EVENT_ID,
    slug: SLUG,
    title: { it: 'Evento di prova' },
    description: { it: 'Descrizione' },
    status: 'LIVE',
    eventType: 'SCHEDULED',
    accessMode: null,
    startsAt: new Date(now - HOUR),
    endsAt: new Date(now + HOUR),
    timezone: 'Europe/Rome',
    maxParticipants: 100,
    _count: { registrations: 0 },
    joinPasswordHash: null,
    audienceAnonymous: false,
    participantListVisible: true,
    hostsAlwaysRecorded: false,
    retainParticipantTracks: false,
    recordingDestination: null,
    recordingEnabled: true,
    autoStartRecording: false,
    multitrackRecordingEnabled: false,
    captionsTranscriptEnabled: false,
    liveCaptionsEnabled: true,
    aiTranscriptEnabled: false,
    aiSummaryEnabled: false,
    aiTranslationEnabled: false,
    aiDubbingEnabled: false,
    recordingUrl: null,
    tempRecordingUrl: null,
    recordingPublished: false,
    transcriptPublished: false,
    recordingAudience: 'PUBLIC',
    postEventPublic: true,
    postEventPublicUntil: null,
    postEventShowRecap: false,
    postEventShowQA: true,
    postEventShowPolls: false,
    postEventShowWordCloud: false,
    postEventShowMaterials: false,
    postEventShowFeedback: false,
    libraryListed: false,
    qaEnabled: true,
    chatEnabled: true,
    agendaEnabled: false,
    whiteboardEnabled: false,
    participantsCanUnmute: true,
    participantsCanStartVideo: false,
    participantsCanShareScreen: false,
    ...over,
  };
}

function registrationRow(over: Record<string, unknown> = {}) {
  return {
    id: REGISTRATION_ID,
    eventId: EVENT_ID,
    displayName: 'Persona Iscritta',
    consentRecording: null,
    consentRecordingDestination: null,
    consentMultitrack: null,
    consentMultitrackVersion: null,
    consentRecordingWithdrawnAt: null,
    consentMultitrackWithdrawnAt: null,
    joinedAt: null,
    ...over,
  };
}

const conEvento = (over: Record<string, unknown> = {}) =>
  vi.mocked(prisma.event.findUnique).mockResolvedValue(eventRow(over) as never);

/** Chi apre il proprio link dal browser con cui si e' iscritto. */
function iscritto(over: Record<string, unknown> = {}) {
  stato.biscotti.set(`event_access_${EVENT_ID}`, TOKEN);
  vi.mocked(prisma.registration.findUnique).mockResolvedValue(
    registrationRow(over) as never
  );
  vi.mocked(prisma.registration.count).mockResolvedValue(1);
}

/** Chi apre un link personale da un altro browser. */
function linkInoltrato() {
  vi.mocked(prisma.registration.findUnique).mockResolvedValue(registrationRow() as never);
}

function conduce(primario: boolean) {
  vi.mocked(resolveGrantForEvent).mockResolvedValue({
    isPrimaryShared: primario,
    role: 'MODERATOR',
    displayName: primario ? null : 'Persona che conduce',
  } as never);
}

interface PropsClient {
  event: Record<string, unknown> & {
    postEventShow: { qa: boolean };
    domandePubblicabili: boolean;
  };
  hasRecordingConsent?: boolean;
  hasMultitrackConsent?: boolean;
  recordingAvailable?: boolean;
}

/** Le props con cui la pagina ha chiamato il client, in uno dei due rami. */
async function clientProps(token?: string): Promise<PropsClient> {
  const tree = (await LivePage({
    params: Promise.resolve({ slug: SLUG }),
    searchParams: Promise.resolve(token ? { token } : {}),
  })) as ReactElement<{ children?: ReactNode }>;
  const nodi =
    tree.type === LiveEventClient
      ? [tree]
      : ([] as ReactNode[]).concat(tree.props.children);
  const client = nodi.find(
    (c): c is ReactElement<PropsClient> => isValidElement(c) && c.type === LiveEventClient
  );
  expect(client, 'la pagina non ha reso il client').toBeDefined();
  return client!.props;
}

beforeEach(() => {
  vi.clearAllMocks();
  stato.biscotti.clear();
  stato.impostazioni = {
    guestAccessEnabled: true,
    parseTitleKicker: false,
    aiPipelineEnabled: true,
    liveCaptionsEnabled: true,
    defaultLocale: 'it',
    waitingRoomEngine: 'CLASSIC',
    reactionsMode: 'NATIVE',
  };
  vi.stubEnv('JITSI_WEB_INTERNAL_URL', '');
  vi.stubEnv('RECORDING_VOICE_EXCLUSION', 'true');
  vi.mocked(prisma.registration.count).mockResolvedValue(0);
  vi.mocked(prisma.recordingConsent.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.recordingConsent.findMany).mockResolvedValue([]);
  vi.mocked(prisma.multitrackConsent.count).mockResolvedValue(0);
  vi.mocked(resolveGrantForEvent).mockResolvedValue(null);
  vi.mocked(staffDietroIlPrimario).mockResolvedValue(null);
  vi.mocked(isEventManager).mockResolvedValue(false);
});

afterEach(() => vi.unstubAllEnvs());

describe('sala — la scheda privacy', () => {
  const scheda = (props: PropsClient) => props.event.schedaPrivacy as SchedaPrivacy | null;

  it('arriva a chi entra senza token e a chi ha il token, uguale', async () => {
    conEvento();
    const ospite = scheda(await clientProps());
    iscritto();
    const conToken = scheda(await clientProps(TOKEN));
    expect(ospite).not.toBeNull();
    expect(conToken).toEqual(ospite);
  });

  it('sulle chiamate rapide non c\'e\', in nessuno dei due rami', async () => {
    conEvento({ eventType: 'INSTANT' });
    expect(scheda(await clientProps())).toBeNull();
    iscritto();
    expect(scheda(await clientProps(TOKEN))).toBeNull();
  });

  it('si calcola sull\'evento com\'e\', non sui valori mascherati per chi guarda', async () => {
    conEvento({ recordingEnabled: true, autoStartRecording: true });
    expect(scheda(await clientProps())?.registrazione.modo).toBe('automatica');
  });

  it('dice dove va il video, come la casella', async () => {
    conEvento({ recordingDestination: 'REGISTRANTS' });
    const { event } = await clientProps();
    expect(event.recordingDestination).toBe('REGISTRANTS');
    expect(scheda({ event } as PropsClient)?.registrazione.destinazione).toBe('REGISTRANTS');
    expect(scheda({ event } as PropsClient)?.chat.esitoDomande).toBe('nonPubblicate');
  });

  it('senza voce nel video non parla di video', async () => {
    vi.stubEnv('JITSI_WEB_INTERNAL_URL', 'http://jitsi-web');
    vi.stubEnv('RECORDER_CONTROLLER_URL', 'http://recorder-controller');
    conEvento();
    const { event } = await clientProps();
    expect(event.voceNelVideo).toBe('assente');
    expect(scheda({ event } as PropsClient)?.registrazione.destinazione).toBeNull();
  });

  describe('dove la scheda dice che non si registra niente', () => {
    beforeEach(() => {
      vi.stubEnv('JITSI_WEB_INTERNAL_URL', 'http://jitsi-web');
      vi.stubEnv('RECORDER_CONTROLLER_URL', 'http://recorder-controller');
    });

    it('la sala non ha niente da chiedere', async () => {
      conEvento({ multitrackRecordingEnabled: true, aiTranscriptEnabled: false });
      const props = await clientProps();
      expect(scheda(props)?.registrazione.modo).toBe('nessuna');
      expect(props.recordingAvailable).toBe(false);
      expect(props.event.multitrackRecordingEnabled).toBe(false);
    });

    it('con le sole tracce si chiede', async () => {
      conEvento({ multitrackRecordingEnabled: true, aiTranscriptEnabled: true });
      const props = await clientProps();
      expect(scheda(props)?.registrazione.modo).toBe('soloTracce');
      expect(props.recordingAvailable).toBe(true);
      expect(props.event.multitrackRecordingEnabled).toBe(true);
    });
  });

  it('la disclosure dell\'amministrazione resta nella lingua della pagina', async () => {
    stato.impostazioni.aiConsentDisclosure = { it: 'Testo scritto.', fr: 'Texte écrit.' };
    conEvento();
    expect((await clientProps()).event.aiConsentDisclosure).toBe('Testo scritto.');
  });
});

describe('chiamata rapida conclusa: il link mostra la registrazione a chi c’era', () => {
  const chiusa = {
    eventType: 'INSTANT',
    status: 'ENDED',
    startsAt: new Date(Date.now() - 4 * HOUR),
    endsAt: new Date(Date.now() - 2 * HOUR),
    dataRetentionDays: 7,
    recordingUrl: VIDEO,
    recordingPublished: false,
    postEventPublic: false,
  };
  const pagina = () =>
    LivePage({ params: Promise.resolve({ slug: SLUG }), searchParams: Promise.resolve({}) });
  async function conPass() {
    vi.stubEnv('APP_SECRET', 'segreto-di-prova-della-sala-abbastanza-lungo');
    const { issuePresencePass, presencePassCookieName } = await import('@/lib/recording/presence-pass');
    stato.biscotti.set(
      presencePassCookieName(EVENT_ID),
      issuePresencePass(EVENT_ID, new Date(Date.now() + 86_400_000))!
    );
  }

  it('a chi non c’era e non la organizza: non trovato, come prima', async () => {
    conEvento(chiusa);
    await expect(pagina()).rejects.toThrow('NOT_FOUND');
  });

  it('chi era in sala mentre si registrava la vede, senza pubblicazione, e mai dall’indirizzo', async () => {
    conEvento(chiusa);
    await conPass();
    const { event } = await clientProps();
    expect(event.status).toBe('ENDED');
    expect(event.videoDisponibile).toBe(true);
    expect(JSON.stringify(event)).not.toContain(VIDEO);
  });

  it('chi la organizza la vede senza pass', async () => {
    conEvento(chiusa);
    vi.mocked(isEventManager).mockResolvedValue(true);
    expect((await clientProps()).event.videoDisponibile).toBe(true);
  });

  it('senza video, o con il pass di un’altra chiamata: non trovato', async () => {
    conEvento({ ...chiusa, recordingUrl: null });
    await conPass();
    await expect(pagina()).rejects.toThrow('NOT_FOUND');
    stato.biscotti.clear();
    conEvento(chiusa);
    vi.stubEnv('APP_SECRET', 'segreto-di-prova-della-sala-abbastanza-lungo');
    const { issuePresencePass, presencePassCookieName } = await import('@/lib/recording/presence-pass');
    stato.biscotti.set(
      presencePassCookieName(EVENT_ID),
      issuePresencePass('99999999-9999-4999-8999-999999999999', new Date(Date.now() + 86_400_000))!
    );
    await expect(pagina()).rejects.toThrow('NOT_FOUND');
  });
});

describe('sala — il video a evento concluso', () => {
  const concluso = {
    status: 'ENDED',
    startsAt: new Date(Date.now() - 4 * HOUR),
    endsAt: new Date(Date.now() - 2 * HOUR),
    recordingUrl: VIDEO,
    recordingPublished: true,
  };
  const riservato = {
    ...concluso,
    recordingAudience: 'REGISTRANTS',
    recordingDestination: 'REGISTRANTS',
  };

  it('pubblicato per tutti: disponibile', async () => {
    conEvento(concluso);
    iscritto();
    expect((await clientProps()).event.videoDisponibile).toBe(true);
  });

  it('il client non riceve mai l indirizzo del video', async () => {
    conEvento(concluso);
    iscritto();
    const { event } = await clientProps();
    expect(event).not.toHaveProperty('recordingUrl');
    expect(JSON.stringify(event)).not.toContain(VIDEO);
  });

  it('non pubblicato: non disponibile, nemmeno a chi si e iscritto', async () => {
    conEvento({ ...concluso, recordingPublished: false });
    iscritto();
    const { event } = await clientProps();
    expect(event.videoDisponibile).toBe(false);
    expect(JSON.stringify(event)).not.toContain(VIDEO);
  });

  it('senza file: non disponibile, anche se pubblicato', async () => {
    conEvento({ ...concluso, recordingUrl: null });
    iscritto();
    expect((await clientProps()).event.videoDisponibile).toBe(false);
  });

  it('riservato: lo vede chi prova la sua iscrizione', async () => {
    conEvento(riservato);
    iscritto();
    expect((await clientProps(TOKEN)).event.videoDisponibile).toBe(true);
  });

  it('riservato con la pagina privata: chi si e iscritto lo vede lo stesso', async () => {
    conEvento({ ...riservato, postEventPublic: false });
    iscritto();
    expect((await clientProps(TOKEN)).event.videoDisponibile).toBe(true);
  });

  it('riservato: un link inoltrato non basta', async () => {
    conEvento(riservato);
    linkInoltrato();
    const { event } = await clientProps(TOKEN);
    expect(event.videoDisponibile).toBe(false);
    expect(JSON.stringify(event)).not.toContain(VIDEO);
  });

  it('riservato: chi gestisce l evento lo vede', async () => {
    conEvento(riservato);
    conduce(true);
    vi.mocked(isEventManager).mockResolvedValue(true);
    expect((await clientProps(TOKEN)).event.videoDisponibile).toBe(true);
  });

  it('riservato: il link di chi conduce, senza account, non basta', async () => {
    conEvento(riservato);
    conduce(false);
    expect((await clientProps(TOKEN)).event.videoDisponibile).toBe(false);
  });

  it('prima della pubblicazione lo staff non lo vede dalla sala: l anteprima sta sulla pagina', async () => {
    conEvento({ ...concluso, recordingPublished: false });
    conduce(true);
    vi.mocked(isEventManager).mockResolvedValue(true);
    expect((await clientProps(TOKEN)).event.videoDisponibile).toBe(false);
  });

  it('archiviato: non disponibile, come sulla pagina dell evento', async () => {
    conEvento({ ...riservato, status: 'ARCHIVED' });
    iscritto();
    const { event } = await clientProps(TOKEN);
    expect(event.videoDisponibile).toBe(false);
    expect(isEventManager).not.toHaveBeenCalled();
  });

  it('in diretta l accesso non si calcola', async () => {
    conEvento({
      recordingUrl: VIDEO,
      recordingPublished: true,
      recordingAudience: 'REGISTRANTS',
    });
    iscritto();
    const { event } = await clientProps(TOKEN);
    expect(event.videoDisponibile).toBe(false);
    expect(isEventManager).not.toHaveBeenCalled();
    expect(prisma.registration.count).not.toHaveBeenCalled();
  });

  it('ospite in diretta: non disponibile, senza indirizzo', async () => {
    conEvento({ recordingUrl: VIDEO, recordingPublished: true });
    const { event } = await clientProps();
    expect(event.videoDisponibile).toBe(false);
    expect(event).not.toHaveProperty('recordingUrl');
  });
});

describe('sala — il recupero durante la diretta', () => {
  const conRecupero = { tempRecordingUrl: RECUPERO };

  it.each([
    ['pubblica', 'PUBLIC'],
    ['non dichiarata', null],
  ])('in diretta con destinazione %s si offre', async (_nome, recordingDestination) => {
    conEvento({ ...conRecupero, recordingDestination });
    expect((await clientProps()).event.tempRecordingUrl).toBe(RECUPERO);
    iscritto();
    expect((await clientProps(TOKEN)).event.tempRecordingUrl).toBe(RECUPERO);
  });

  it('con destinazione riservata non si offre, in nessuno dei due rami', async () => {
    conEvento({ ...conRecupero, recordingDestination: 'REGISTRANTS' });
    const ospite = await clientProps();
    expect(ospite.event.tempRecordingUrl).toBeNull();
    expect(JSON.stringify(ospite.event)).not.toContain(RECUPERO);
    iscritto();
    const conToken = await clientProps(TOKEN);
    expect(conToken.event.tempRecordingUrl).toBeNull();
    expect(JSON.stringify(conToken.event)).not.toContain(RECUPERO);
  });

  it('con il video reso riservato dal pubblico non si offre, in nessuno dei due rami', async () => {
    conEvento({
      ...conRecupero,
      recordingDestination: 'PUBLIC',
      recordingAudience: 'REGISTRANTS',
    });
    expect((await clientProps()).event.tempRecordingUrl).toBeNull();
    iscritto();
    expect((await clientProps(TOKEN)).event.tempRecordingUrl).toBeNull();
  });

  it.each(['PUBLISHED', 'IDLE', 'PROVISIONING', 'ENDED', 'ARCHIVED'])(
    'con l evento %s non si offre',
    async (status) => {
      conEvento({ ...conRecupero, status });
      iscritto();
      expect((await clientProps(TOKEN)).event.tempRecordingUrl).toBeNull();
    }
  );
});

describe('sala — le domande dopo l evento', () => {
  it('con la scelta di chi organizza restano, nei due rami', async () => {
    conEvento({ recordingDestination: 'PUBLIC' });
    expect((await clientProps()).event.postEventShow.qa).toBe(true);
    iscritto();
    expect((await clientProps(TOKEN)).event.postEventShow.qa).toBe(true);
  });

  it('con la registrazione riservata non si pubblicano, nei due rami', async () => {
    conEvento({ recordingDestination: 'REGISTRANTS' });
    expect((await clientProps()).event.postEventShow.qa).toBe(false);
    iscritto();
    expect((await clientProps(TOKEN)).event.postEventShow.qa).toBe(false);
  });

  it('con il video reso riservato dal pubblico non si pubblicano, nei due rami', async () => {
    conEvento({ recordingDestination: 'PUBLIC', recordingAudience: 'REGISTRANTS' });
    expect((await clientProps()).event.postEventShow.qa).toBe(false);
    iscritto();
    expect((await clientProps(TOKEN)).event.postEventShow.qa).toBe(false);
  });

  it('una chiamata rapida nasce senza Q&A, ma le domande si possono pubblicare, nei due rami', async () => {
    conEvento({ eventType: 'INSTANT', qaEnabled: false, recordingDestination: null });
    const ospite = (await clientProps()).event;
    expect(ospite.postEventShow.qa).toBe(false);
    expect(ospite.domandePubblicabili).toBe(true);
    iscritto();
    const conToken = (await clientProps(TOKEN)).event;
    expect(conToken.postEventShow.qa).toBe(false);
    expect(conToken.domandePubblicabili).toBe(true);
  });

  it('con la registrazione riservata non si possono pubblicare, nei due rami', async () => {
    conEvento({ recordingDestination: 'REGISTRANTS' });
    expect((await clientProps()).event.domandePubblicabili).toBe(false);
    iscritto();
    expect((await clientProps(TOKEN)).event.domandePubblicabili).toBe(false);
  });

  it('spente da chi organizza o senza Q&A non si pubblicano', async () => {
    conEvento({ postEventShowQA: false });
    expect((await clientProps()).event.postEventShow.qa).toBe(false);
    conEvento({ qaEnabled: false });
    expect((await clientProps()).event.postEventShow.qa).toBe(false);
  });
});

describe('sala — la trascrizione dal video', () => {
  const conAi = { aiTranscriptEnabled: true };

  it('vale nei due rami', async () => {
    conEvento(conAi);
    expect((await clientProps()).event.trascrizioneVideo).toBe(true);
    iscritto();
    expect((await clientProps(TOKEN)).event.trascrizioneVideo).toBe(true);
  });

  it('non vale in una chiamata rapida, nei due rami', async () => {
    conEvento({ ...conAi, eventType: 'INSTANT' });
    const ospite = await clientProps();
    expect(ospite.event.trascrizioneVideo).toBe(false);
    expect(ospite.event.recordingEnabled).toBe(false);
    iscritto();
    expect((await clientProps(TOKEN)).event.trascrizioneVideo).toBe(false);
  });

  it('non vale con la pipeline spenta', async () => {
    stato.impostazioni.aiPipelineEnabled = false;
    conEvento(conAi);
    expect((await clientProps()).event.trascrizioneVideo).toBe(false);
  });

  it('non vale dove non c e un video completo', async () => {
    vi.stubEnv('JITSI_WEB_INTERNAL_URL', 'http://jitsi-web');
    vi.stubEnv('RECORDER_CONTROLLER_URL', 'http://recorder');
    conEvento(conAi);
    expect((await clientProps()).event.trascrizioneVideo).toBe(false);
  });

  it('chi l ha data con il testo che la comprende non la rivede', async () => {
    conEvento(conAi);
    iscritto();
    vi.mocked(prisma.multitrackConsent.count).mockResolvedValue(1);
    expect((await clientProps(TOKEN)).hasMultitrackConsent).toBe(true);
    expect(prisma.multitrackConsent.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ textVersion: { gte: 2 } }),
    });
  });

  it('chi l ha data all iscrizione per la sola traccia audio la rivede', async () => {
    conEvento(conAi);
    iscritto({ consentMultitrack: true, consentMultitrackVersion: 1 });
    expect((await clientProps(TOKEN)).hasMultitrackConsent).toBe(false);
  });

  it('senza niente da trascrivere la prova non si cerca', async () => {
    conEvento();
    iscritto();
    await clientProps(TOKEN);
    expect(prisma.multitrackConsent.count).not.toHaveBeenCalled();
  });

  it('con le sole tracce e la pipeline spenta vale anche il testo della sola traccia audio', async () => {
    stato.impostazioni.aiPipelineEnabled = false;
    conEvento({ multitrackRecordingEnabled: true, aiTranscriptEnabled: true });
    iscritto({ consentMultitrack: true, consentMultitrackVersion: 1 });
    expect((await clientProps(TOKEN)).hasMultitrackConsent).toBe(true);
  });

  it('con le sole tracce e l evento senza trascrizione vale anche il testo di prima', async () => {
    conEvento({ multitrackRecordingEnabled: true });
    iscritto({ consentMultitrack: true, consentMultitrackVersion: 1 });
    expect((await clientProps(TOKEN)).hasMultitrackConsent).toBe(true);
  });

  describe('tracce per persona che la pipeline trascrive, senza video completo', () => {
    const conTracce = { ...conAi, multitrackRecordingEnabled: true };

    beforeEach(() => {
      vi.stubEnv('JITSI_WEB_INTERNAL_URL', 'http://jitsi-web');
      vi.stubEnv('RECORDER_CONTROLLER_URL', 'http://recorder');
    });

    it('chi l ha data per la sola traccia audio la rivede', async () => {
      conEvento(conTracce);
      iscritto({ consentMultitrack: true, consentMultitrackVersion: 1 });
      const props = await clientProps(TOKEN);
      expect(props.event.trascrizioneVideo).toBe(false);
      expect(props.hasMultitrackConsent).toBe(false);
    });

    it('un consenso senza versione vale come il testo di prima', async () => {
      conEvento(conTracce);
      iscritto({ consentMultitrack: true, consentMultitrackVersion: null });
      expect((await clientProps(TOKEN)).hasMultitrackConsent).toBe(false);
    });

    it('una prova in sala conta solo con il testo che la comprende', async () => {
      conEvento(conTracce);
      iscritto();
      vi.mocked(prisma.multitrackConsent.count).mockResolvedValue(1);
      expect((await clientProps(TOKEN)).hasMultitrackConsent).toBe(true);
      expect(prisma.multitrackConsent.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ textVersion: { gte: 2 } }),
      });
    });

    it('chi ha dato il testo che la comprende non la rivede', async () => {
      conEvento(conTracce);
      iscritto({ consentMultitrack: true, consentMultitrackVersion: 2 });
      expect((await clientProps(TOKEN)).hasMultitrackConsent).toBe(true);
    });

    it('senza tracce per persona il testo di prima non si richiede', async () => {
      conEvento(conAi);
      iscritto({ consentMultitrack: true, consentMultitrackVersion: 1 });
      expect((await clientProps(TOKEN)).hasMultitrackConsent).toBe(true);
    });
  });
});

describe('sala — i dati del testo del consenso', () => {
  it('la destinazione e la conservazione delle tracce arrivano nei due rami', async () => {
    conEvento({ recordingDestination: 'REGISTRANTS', retainParticipantTracks: true });
    const ospite = await clientProps();
    expect(ospite.event.recordingDestination).toBe('REGISTRANTS');
    expect(ospite.event.tracceConservate).toBe(true);
    iscritto();
    const conToken = await clientProps(TOKEN);
    expect(conToken.event.recordingDestination).toBe('REGISTRANTS');
    expect(conToken.event.tracceConservate).toBe(true);
  });

  it('il pubblico della registrazione arriva nei due rami', async () => {
    conEvento({ recordingDestination: 'PUBLIC', recordingAudience: 'REGISTRANTS' });
    expect((await clientProps()).event.recordingAudience).toBe('REGISTRANTS');
    iscritto();
    expect((await clientProps(TOKEN)).event.recordingAudience).toBe('REGISTRANTS');
  });

  it('la conservazione spenta resta spenta', async () => {
    conEvento();
    expect((await clientProps()).event.tracceConservate).toBe(false);
    iscritto();
    expect((await clientProps(TOKEN)).event.tracceConservate).toBe(false);
  });

  it('a pipeline spenta le tracce restano, come dice la scheda', async () => {
    stato.impostazioni.aiPipelineEnabled = false;
    conEvento();
    expect((await clientProps()).event.tracceConservate).toBe(true);
    iscritto();
    expect((await clientProps(TOKEN)).event.tracceConservate).toBe(true);
  });
});

describe('sala — il consenso alla registrazione gia dato', () => {
  it('quello dell iscrizione copre dopo una restrizione', async () => {
    conEvento({ recordingDestination: 'REGISTRANTS' });
    iscritto({ consentRecording: true, consentRecordingDestination: 'PUBLIC' });
    expect((await clientProps(TOKEN)).hasRecordingConsent).toBe(true);
    expect(prisma.recordingConsent.findFirst).not.toHaveBeenCalled();
  });

  it('quello dell iscrizione non copre dopo un allargamento: si richiede', async () => {
    conEvento({ recordingDestination: 'PUBLIC' });
    iscritto({ consentRecording: true, consentRecordingDestination: 'REGISTRANTS' });
    expect((await clientProps(TOKEN)).hasRecordingConsent).toBe(false);
  });

  it('quello senza destinazione non copre un evento che la dichiara', async () => {
    conEvento({ recordingDestination: 'REGISTRANTS' });
    iscritto({ consentRecording: true });
    expect((await clientProps(TOKEN)).hasRecordingConsent).toBe(false);
  });

  it('dove non c e un video un consenso senza destinazione copre', async () => {
    vi.stubEnv('JITSI_WEB_INTERNAL_URL', 'http://jitsi-web');
    vi.stubEnv('RECORDER_CONTROLLER_URL', 'http://recorder');
    conEvento({ recordingDestination: 'REGISTRANTS' });
    iscritto({ consentRecording: true });
    expect((await clientProps(TOKEN)).hasRecordingConsent).toBe(true);
  });

  it('ritirato non vale, anche se copre', async () => {
    conEvento({ recordingDestination: 'REGISTRANTS' });
    iscritto({
      consentRecording: true,
      consentRecordingDestination: 'REGISTRANTS',
      consentRecordingWithdrawnAt: new Date(),
    });
    expect((await clientProps(TOKEN)).hasRecordingConsent).toBe(false);
  });

  it('la prova data in sala vale se copre', async () => {
    conEvento({ recordingDestination: 'REGISTRANTS' });
    iscritto();
    vi.mocked(prisma.recordingConsent.findFirst).mockResolvedValue({
      destination: 'PUBLIC',
    } as never);
    expect((await clientProps(TOKEN)).hasRecordingConsent).toBe(true);
    expect(prisma.recordingConsent.findFirst).toHaveBeenCalledWith({
      where: { eventId: EVENT_ID, registrationId: REGISTRATION_ID, withdrawnAt: null },
      select: { destination: true },
    });
  });

  it('la prova data in sala non vale se non copre', async () => {
    conEvento({ recordingDestination: 'PUBLIC' });
    iscritto();
    vi.mocked(prisma.recordingConsent.findFirst).mockResolvedValue({
      destination: 'REGISTRANTS',
    } as never);
    expect((await clientProps(TOKEN)).hasRecordingConsent).toBe(false);
  });

  it('un link inoltrato non eredita niente e non legge le prove', async () => {
    conEvento({ recordingDestination: 'PUBLIC' });
    vi.mocked(prisma.registration.findUnique).mockResolvedValue(
      registrationRow({
        consentRecording: true,
        consentRecordingDestination: 'PUBLIC',
      }) as never
    );
    expect((await clientProps(TOKEN)).hasRecordingConsent).toBe(false);
    expect(prisma.recordingConsent.findFirst).not.toHaveBeenCalled();
  });

  describe('chi conduce', () => {
    const staff = { accountId: 'acc-1', nome: 'Persona dello staff' };

    it('dal link primario con l account: vale una prova che copre', async () => {
      conEvento({ recordingDestination: 'REGISTRANTS' });
      conduce(true);
      vi.mocked(staffDietroIlPrimario).mockResolvedValue(staff as never);
      vi.mocked(prisma.recordingConsent.findMany).mockResolvedValue([
        { destination: null },
        { destination: 'PUBLIC' },
      ] as never);
      expect((await clientProps(TOKEN)).hasRecordingConsent).toBe(true);
      expect(prisma.recordingConsent.findMany).toHaveBeenCalledWith({
        where: { eventId: EVENT_ID, staffAccountId: 'acc-1', withdrawnAt: null },
        select: { destination: true },
      });
    });

    const conTracce = { multitrackRecordingEnabled: true };

    it('dal link primario con l account: la trascrizione data prima resta, anche senza registrare', async () => {
      conEvento({ ...conTracce, recordingEnabled: false });
      conduce(true);
      vi.mocked(staffDietroIlPrimario).mockResolvedValue(staff as never);
      vi.mocked(prisma.multitrackConsent.count).mockResolvedValue(1);
      expect((await clientProps(TOKEN)).hasMultitrackConsent).toBe(true);
      expect(prisma.multitrackConsent.count).toHaveBeenCalledWith({
        where: {
          eventId: EVENT_ID,
          staffAccountId: 'acc-1',
          withdrawnAt: null,
          textVersion: { gte: 1 },
        },
      });
      expect(prisma.recordingConsent.findMany).not.toHaveBeenCalled();
    });

    it('senza account la trascrizione non si eredita', async () => {
      conEvento(conTracce);
      conduce(true);
      expect((await clientProps(TOKEN)).hasMultitrackConsent).toBe(false);
      expect(prisma.multitrackConsent.count).not.toHaveBeenCalled();
    });

    it('un evento che non chiede la trascrizione non la cerca', async () => {
      conEvento({ recordingDestination: 'PUBLIC' });
      conduce(true);
      vi.mocked(staffDietroIlPrimario).mockResolvedValue(staff as never);
      expect((await clientProps(TOKEN)).hasMultitrackConsent).toBe(false);
      expect(prisma.multitrackConsent.count).not.toHaveBeenCalled();
    });

    it('dal link primario con l account: dopo un allargamento si richiede', async () => {
      conEvento({ recordingDestination: 'PUBLIC' });
      conduce(true);
      vi.mocked(staffDietroIlPrimario).mockResolvedValue(staff as never);
      vi.mocked(prisma.recordingConsent.findMany).mockResolvedValue([
        { destination: 'REGISTRANTS' },
      ] as never);
      expect((await clientProps(TOKEN)).hasRecordingConsent).toBe(false);
    });

    it('senza account non si eredita: le prove non si leggono', async () => {
      conEvento({ recordingDestination: 'PUBLIC' });
      conduce(true);
      expect((await clientProps(TOKEN)).hasRecordingConsent).toBe(false);
      expect(prisma.recordingConsent.findMany).not.toHaveBeenCalled();
    });

    it('un link nominale non eredita', async () => {
      conEvento({ recordingDestination: 'PUBLIC' });
      conduce(false);
      expect((await clientProps(TOKEN)).hasRecordingConsent).toBe(false);
      expect(prisma.recordingConsent.findMany).not.toHaveBeenCalled();
    });
  });
});
