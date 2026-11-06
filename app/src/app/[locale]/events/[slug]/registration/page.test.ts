// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Cosa la pagina dell'iscrizione dice al modulo sui consensi. I fatti
 * sull'installazione stanno solo sul server: se la pagina non li calcola come
 * la rotta, il modulo chiede una casella che la rotta ignora, o non la chiede.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sito } = vi.hoisted(() => ({
  sito: {
    publicRegistrationEnabled: true,
    addressBookEnabled: true,
    aiPipelineEnabled: true,
    waitingRoomLeadMinutes: 15,
    parseTitleKicker: false,
    aiConsentDisclosure: null as Record<string, string> | null,
  },
}));

vi.mock('@/lib/db', () => ({ prisma: { event: { findUnique: vi.fn() } } }));
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'it',
  getTranslations: async () => (chiave: string) => chiave,
  getFormatter: async () => ({ dateTime: () => 'data' }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/i18n/navigation', () => ({ Link: () => null, percorso: (p: string) => p }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => sito }));
vi.mock('@/lib/events/registration-access', () => ({
  registrationAccessFor: async () => 'open',
}));
vi.mock('@/lib/events/meta-title', () => ({ anteprimaEventoPubblico: async () => null }));
vi.mock('@/lib/questionnaires', () => ({
  findEventQuestionnaireByPlacement: async () => null,
}));
vi.mock('@/lib/email/invitation', () => ({ invitoDaToken: async () => null }));
vi.mock('@/components/ui/icon', () => ({ Icon: () => null }));
vi.mock('@/components/events/event-title', () => ({ default: () => null }));
// Qui conta solo con quali props la pagina chiama il modulo.
vi.mock('@/components/registration/registration-form-client', () => ({
  default: function RegistrationFormStub() {
    return null;
  },
}));

import RegistrationFormClient from '@/components/registration/registration-form-client';
import { prisma } from '@/lib/db';
import type { SchedaPrivacy } from '@/lib/events/privacy-sheet';

import RegistrationPage from './page';

const SLUG = 'evento-di-prova';
const HOUR = 60 * 60 * 1000;

function evento(over: Record<string, unknown> = {}) {
  vi.mocked(prisma.event.findUnique).mockResolvedValue({
    id: '22222222-2222-4222-8222-222222222222',
    slug: SLUG,
    title: { it: 'Evento di prova' },
    status: 'PUBLISHED',
    eventType: 'SCHEDULED',
    startsAt: new Date(Date.now() + 2 * HOUR),
    endsAt: new Date(Date.now() + 4 * HOUR),
    timezone: 'Europe/Rome',
    recordingEnabled: true,
    recordingDestination: null,
    multitrackRecordingEnabled: false,
    aiTranscriptEnabled: true,
    retainParticipantTracks: false,
    participantsCanUnmute: true,
    participantsCanStartVideo: false,
    participantsCanShareScreen: false,
    offerAddressBook: true,
    requireOrganization: false,
    requireOrganizationRole: false,
    requireOrganizationType: false,
    privacyPolicyUrl: null,
    gdprTemplate: null,
    _count: { registrations: 0 },
    ...over,
  } as never);
}

function cercaModulo(nodo: ReactNode): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(nodo)) {
    for (const figlio of nodo) {
      const trovato = cercaModulo(figlio as ReactNode);
      if (trovato) return trovato;
    }
    return null;
  }
  if (!isValidElement(nodo)) return null;
  if (nodo.type === RegistrationFormClient)
    return nodo as ReactElement<Record<string, unknown>>;
  return cercaModulo((nodo.props as { children?: ReactNode }).children);
}

async function propsDelModulo(): Promise<Record<string, unknown>> {
  const albero = await RegistrationPage({ params: Promise.resolve({ slug: SLUG }) });
  const modulo = cercaModulo(albero);
  expect(modulo, 'la pagina non ha reso il modulo').not.toBeNull();
  return modulo!.props;
}

/** Jitsi del chart, con il solo registratore per partecipante: nessun video. */
function senzaVideo() {
  vi.stubEnv('JITSI_WEB_INTERNAL_URL', 'http://jitsi-web');
  vi.stubEnv('JIBRI_HEALTH_URL', '');
  vi.stubEnv('RECORDER_CONTROLLER_URL', 'http://recorder-controller');
}

beforeEach(() => {
  vi.unstubAllEnvs();
  sito.addressBookEnabled = true;
  sito.aiPipelineEnabled = true;
  sito.aiConsentDisclosure = null;
  evento();
});

describe('pagina di iscrizione: la scheda privacy', () => {
  it("la calcola il server, con la riga delle impostazioni", async () => {
    const { schedaPrivacy } = (await propsDelModulo()) as { schedaPrivacy: SchedaPrivacy };
    expect(schedaPrivacy.registrazione.modo).toBe('manuale');
    expect(schedaPrivacy.rubrica).not.toBeNull();
  });

  it('dice lo stesso di cio che chiede il modulo', async () => {
    senzaVideo();
    const props = await propsDelModulo();
    expect(props.voce).toBe('assente');
    expect((props.schedaPrivacy as SchedaPrivacy).registrazione.modo).toBe('nessuna');
  });

  it('segue la rubrica spenta nel sito', async () => {
    sito.addressBookEnabled = false;
    expect(((await propsDelModulo()).schedaPrivacy as SchedaPrivacy).rubrica).toBeNull();
  });

  it("passa il testo dell'amministrazione nella lingua della pagina", async () => {
    sito.aiConsentDisclosure = { it: 'Testo scritto.', fr: 'Texte écrit.' };
    expect((await propsDelModulo()).testoIa).toBe('Testo scritto.');
    sito.aiConsentDisclosure = { fr: 'Texte écrit.' };
    expect((await propsDelModulo()).testoIa).toBeNull();
  });
});

describe('pagina di iscrizione: consensi passati al modulo', () => {
  it('passa la destinazione e il flag delle tracce conservate', async () => {
    evento({ recordingDestination: 'REGISTRANTS', retainParticipantTracks: true });
    expect(await propsDelModulo()).toMatchObject({
      recordingDestination: 'REGISTRANTS',
      tracceConservate: true,
    });
  });

  it("passa il testo che l'ente ha scelto per l'evento", async () => {
    evento({ recordingConsentText: 'Testo scelto per evento' });
    expect((await propsDelModulo()).recordingConsentText).toBe('Testo scelto per evento');
  });

  it('senza conservazione, a pipeline accesa, le tracce si cancellano', async () => {
    expect((await propsDelModulo()).tracceConservate).toBe(false);
  });

  it('a pipeline spenta la casella segue la scheda: le tracce restano', async () => {
    sito.aiPipelineEnabled = false;
    expect((await propsDelModulo()).tracceConservate).toBe(true);
  });

  it('senza destinazione dichiarata passa null, non un valore di partenza', async () => {
    expect((await propsDelModulo()).recordingDestination).toBeNull();
  });

  it("dove non c'e' un video passa la voce assente", async () => {
    senzaVideo();
    expect((await propsDelModulo()).voce).toBe('assente');
  });

  describe('dove la scheda dice che non si registra niente', () => {
    beforeEach(() => {
      senzaVideo();
      evento({ multitrackRecordingEnabled: false });
    });

    it('niente casella, come la scheda', async () => {
      const props = await propsDelModulo();
      expect((props.schedaPrivacy as SchedaPrivacy).registrazione.modo).toBe('nessuna');
      expect(props.recordingEnabled).toBe(false);
    });

    it('il flag delle tracce da solo non chiede niente', async () => {
      evento({ multitrackRecordingEnabled: true, aiTranscriptEnabled: false });
      const props = await propsDelModulo();
      expect((props.schedaPrivacy as SchedaPrivacy).registrazione.modo).toBe('nessuna');
      expect(props.multitrackRecordingEnabled).toBe(false);
    });

    it('con le sole tracce la casella resta', async () => {
      evento({ multitrackRecordingEnabled: true, aiTranscriptEnabled: true });
      const props = await propsDelModulo();
      expect((props.schedaPrivacy as SchedaPrivacy).registrazione.modo).toBe('soloTracce');
      expect(props.recordingEnabled).toBe(true);
      expect(props.multitrackRecordingEnabled).toBe(true);
    });
  });

  it('trascrizione dal video: evento, pipeline e video insieme', async () => {
    expect((await propsDelModulo()).trascrizioneVideo).toBe(true);
  });

  it('trascrizione dal video: falsa a pipeline spenta', async () => {
    sito.aiPipelineEnabled = false;
    expect((await propsDelModulo()).trascrizioneVideo).toBe(false);
  });

  it("trascrizione dal video: falsa senza la trascrizione nell'evento", async () => {
    evento({ aiTranscriptEnabled: false });
    expect((await propsDelModulo()).trascrizioneVideo).toBe(false);
  });

  it("trascrizione dal video: falsa dove non c'e' un video", async () => {
    senzaVideo();
    expect((await propsDelModulo()).trascrizioneVideo).toBe(false);
  });

  it('la rubrica si propone se la tengono accesa evento e installazione', async () => {
    expect((await propsDelModulo()).rubricaProposta).toBe(true);
  });

  it("la rubrica non si propone se l'evento non la offre", async () => {
    evento({ offerAddressBook: false });
    expect((await propsDelModulo()).rubricaProposta).toBe(false);
  });

  it("la rubrica non si propone se l'installazione la tiene spenta", async () => {
    sito.addressBookEnabled = false;
    expect((await propsDelModulo()).rubricaProposta).toBe(false);
  });
});
