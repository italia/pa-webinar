// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import type { WaitingRoomJoinPrefs } from '@/components/live/waiting-room';
import type { SchedaPrivacy } from '@/lib/events/privacy-sheet';
import type * as Riconnessione from '@/lib/jitsi/riconnessione';

import LiveEventClient from './live-event-client';

/**
 * La sala tiene due cose separate: la destinazione del video in vigore, che le
 * riporta ogni risposta del token, e il testo su cui la persona ha acconsentito.
 * Mostra sempre la prima, manda sempre il secondo, e se il secondo non copre la
 * prima dimentica il consenso. La chiusura dell'evento non deve fermarsi sulla
 * destinazione.
 */

// La sala d'attesa ha i suoi test: qui conta cosa riceve e cosa restituisce.
type PropsAttesa = {
  event: Record<string, unknown>;
  recordingConsentRequired?: boolean;
  recordingDestination?: unknown;
  voce?: unknown;
  schedaPrivacy?: SchedaPrivacy | null;
  onEnterLive: (nome: string, prefs: WaitingRoomJoinPrefs) => void;
};
const attesa = vi.hoisted(() => ({ props: null as unknown }));
const leggiAttesa = () => attesa.props as PropsAttesa;
const conferenza = vi.hoisted(() => ({ perdiConnessione: () => {} }));

vi.mock('@/components/live/waiting-room', () => ({
  default: (props: unknown) => {
    attesa.props = props;
    return null;
  },
}));
// La conferenza: entra appena montata, come fa Jitsi a chiamata riuscita.
vi.mock('@/components/jitsi/jitsi-room', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    default: function ConferenzaFinta({
      onReady,
      onConnectionLost,
    }: {
      onReady: () => void;
      onConnectionLost: () => void;
    }) {
      const entra = useRef(onReady);
      useEffect(() => entra.current(), []);
      conferenza.perdiConnessione = onConnectionLost;
      return null;
    },
  };
});

// Il rientro dopo una caduta riparte subito: qui conta cosa chiede.
vi.mock('@/lib/jitsi/riconnessione', async (originale) => ({
  ...(await originale<typeof Riconnessione>()),
  attesaTentativo: () => 0,
}));

// I flag della sala sono l'unica lettura che qui conta: la sala d'attesa li segue.
const flagsDellaSala = vi.hoisted(() => ({ dati: undefined as unknown }));
vi.mock('swr', () => ({
  default: (chiave: unknown) => ({
    data: String(chiave).endsWith('/flags') ? flagsDellaSala.dati : undefined,
    mutate: vi.fn(),
  }),
}));
vi.mock('@/i18n/navigation', async () => {
  const { createElement } = await import('react');
  return {
    Link: ({ href, children }: { href: unknown; children?: unknown }) =>
      createElement('a', { href: String(href) }, children as never),
    percorso: (p: string) => p,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  };
});
vi.mock('@/lib/settings-context', () => ({ useSettings: () => ({}) }));
vi.mock('@/hooks/use-live-state', async () => {
  const { createContext } = await import('react');
  return {
    LivePushContext: createContext(false),
    useLivePush: () => false,
    useLiveState: () => ({ pushLive: false, presentation: undefined }),
  };
});
vi.mock('@/hooks/use-qa-alerts', () => ({ useQaAlerts: () => ({ hasNews: false }) }));
vi.mock('@/hooks/use-presence', () => ({ usePresenze: () => null }));
vi.mock('@/hooks/use-captions-control', () => ({ useCaptionsControl: () => vi.fn() }));
vi.mock('@/hooks/use-recording-control', () => ({
  useRecordingControl: () => ({ fase: 'ferma' }),
}));
vi.mock('@/hooks/use-presentation-timer', () => ({
  TimerInterventiSync: () => null,
  useScartoOrologio: () => 0,
}));
vi.mock('@/components/presentation/use-presentation', async () => {
  const { createContext } = await import('react');
  return {
    PresentationContext: createContext(null),
    usePresentation: () => ({ view: { materialId: null } }),
  };
});

// I pannelli della sala non c'entrano con i consensi.
vi.mock('@/components/qa/qa-panel', () => ({ default: () => null }));
vi.mock('@/components/polls/poll-panel', () => ({ default: () => null }));
vi.mock('@/components/live/agenda-panel', () => ({ default: () => null }));
vi.mock('@/components/materials/material-panel', () => ({ default: () => null }));
vi.mock('@/components/participants/participant-panel', () => ({ default: () => null }));
vi.mock('@/components/presentation/presentation-stage', () => ({ default: () => null }));
vi.mock('@/components/live/post-event-feedback', () => ({ default: () => null }));
vi.mock('@/components/live/presentation-timer', () => ({ default: () => null }));
vi.mock('@/components/live/live-time-strip', () => ({ default: () => null }));
vi.mock('@/components/live/closing-notice', () => ({ default: () => null }));
vi.mock('@/components/live/live-captions', () => ({ default: () => null }));
vi.mock('@/components/live/capture-notice', () => ({ default: () => null }));
vi.mock('@/components/live/stage-name', () => ({ default: () => null }));
vi.mock('@/components/live/control-room-panel', () => ({ default: () => null }));
vi.mock('@/components/live/reaction-bar', () => ({ default: () => null }));
vi.mock('@/components/live/chat-panel', () => ({ default: () => null }));
vi.mock('@/components/live/word-cloud', () => ({ default: () => null }));
vi.mock('@/components/live/agenda-ticker', () => ({ default: () => null }));
vi.mock('@/components/live/live-share-button', () => ({ default: () => null }));

type Props = ComponentProps<typeof LiveEventClient>;

const evento: Props['event'] = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'evento-di-prova',
  title: 'Evento di prova',
  startsAt: new Date(Date.now() - 60_000).toISOString(),
  endsAt: new Date(Date.now() + 3_600_000).toISOString(),
  status: 'LIVE',
  recordingAudience: 'PUBLIC',
  recordingEnabled: true,
  qaEnabled: false,
  chatEnabled: false,
  agendaEnabled: false,
  whiteboardEnabled: false,
  waitingRoomAudioUrl: null,
  participantsCanUnmute: true,
  participantsCanStartVideo: true,
  participantsCanShareScreen: true,
  voceNelVideo: 'rimovibile',
};

interface Risposta {
  recordingDestination?: 'PUBLIC' | 'REGISTRANTS' | null;
  voiceExcluded?: boolean;
  listenOnly?: boolean;
  consentsRecorded?: { recording: boolean; multitrack: boolean };
  /** Lo stato della risposta, se non e' un 200. */
  stato?: number;
}

let container: HTMLDivElement;
let root: Root;
let chiamate: { url: string; method: string; body: Record<string, unknown> }[];
let risposte: Risposta[];
/** Gli stati dell'evento che /lifecycle risponde, uno per richiesta. */
let statiEvento: string[];

const rispondi = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const richiesteToken = () => chiamate.filter((c) => c.url.endsWith('/jitsi/token'));
const ultimoToken = () => richiesteToken().at(-1)?.body;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  attesa.props = null;
  chiamate = [];
  risposte = [];
  statiEvento = [];
  flagsDellaSala.dati = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      chiamate.push({
        url,
        method,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
      });
      if (url.endsWith('/jitsi/token')) {
        const { stato = 200, ...r } = risposte.shift() ?? {};
        return rispondi(
          {
            jwt: `jwt-${richiesteToken().length}`,
            roomName: 'stanza',
            displayName: 'Relatore 1',
            role: 'participant',
            consentsRecorded: { recording: false, multitrack: false },
            ...r,
          },
          stato
        );
      }
      if (url.endsWith('/lifecycle'))
        return rispondi({ status: statiEvento.shift() ?? 'LIVE' });
      return rispondi({});
    })
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function monta(props: Partial<Props> = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <LiveEventClient
          event={evento}
          token="token-iscritto"
          isModerator={false}
          displayName="Relatore 1"
          locale="it"
          jitsiDomain="meet.example.org"
          {...props}
        />
      </NextIntlClientProvider>
    );
  });
}

/** Entra dalla sala d'attesa e aspetta le credenziali. */
async function entra(prefs: Partial<WaitingRoomJoinPrefs> = {}) {
  await act(async () => {
    leggiAttesa().onEnterLive('Relatore 1', { cameraOn: false, micOn: false, ...prefs });
  });
}

/** La conferenza cade: la sala chiede un token nuovo da sola. */
async function caduta() {
  const richieste = chiamate.length;
  await act(async () => {
    conferenza.perdiConnessione();
  });
  await vi.waitFor(() => {
    expect(chiamate.slice(richieste).some((c) => c.url.endsWith('/jitsi/token'))).toBe(
      true
    );
  });
  await act(async () => {
    await new Promise((fatto) => setTimeout(fatto, 0));
  });
}

const testo = () => document.body.textContent ?? '';
const pulsante = (etichetta: string) => {
  const b = [...document.querySelectorAll('button')].find((el) =>
    el.textContent?.includes(etichetta)
  );
  if (!b) throw new Error(`nessun pulsante «${etichetta}»`);
  return b;
};
const premi = async (el: HTMLElement) => {
  await act(async () => el.click());
};

const g = messages.gdpr.consent;
const l = messages.live;

describe("sala — quello che arriva alla sala d'attesa", () => {
  it("la destinazione della pagina, e il video come disponibilita'", async () => {
    await monta({
      event: {
        ...evento,
        recordingDestination: 'REGISTRANTS',
        videoDisponibile: true,
        trascrizioneVideo: true,
        retainParticipantTracks: true,
      },
    });
    const a = leggiAttesa();
    expect(a.recordingDestination).toBe('REGISTRANTS');
    expect(a.voce).toBe('rimovibile');
    expect(a.event).toMatchObject({
      videoDisponibile: true,
      trascrizioneVideo: true,
      retainParticipantTracks: true,
    });
    expect(a.event).not.toHaveProperty('recordingUrl');
  });

  describe('la scheda privacy', () => {
    const SCHEDA: SchedaPrivacy = {
      registrazione: {
        modo: 'manuale',
        destinazione: 'PUBLIC',
        chiNonAcconsente: 'restaFuori',
        conduceSempre: false,
      },
      trascrizione: { sottotitoli: true, tracce: null, dalVideo: false },
      sottotitoli: { attivi: true, testoConservato: true },
      ia: null,
      chat: { attiva: true, domandeAttive: true, esitoDomande: 'soloTesto' },
      elencoVisibile: true,
      pseudonimi: false,
      conservazione: { giorniDati: 30, video: null },
      rubrica: null,
    };
    const conSottotitoli = {
      ...evento,
      schedaPrivacy: SCHEDA,
      liveCaptionsAvailable: true,
      liveCaptionsEnabled: true,
    };

    it('arriva alla sala d\'attesa, e sulle chiamate rapide non arriva', async () => {
      await monta({ event: { ...evento, schedaPrivacy: null } });
      expect(leggiAttesa().schedaPrivacy).toBeNull();
    });

    it('i sottotitoli seguono i flag della sala, non il valore dell\'apertura', async () => {
      flagsDellaSala.dati = { liveCaptionsEnabled: false };
      await monta({ event: conSottotitoli });
      expect(leggiAttesa().schedaPrivacy?.sottotitoli.attivi).toBe(false);
      expect(leggiAttesa().schedaPrivacy?.trascrizione.sottotitoli).toBe(false);
    });

    it('prima che i flag arrivino vale il valore dell\'apertura', async () => {
      await monta({ event: conSottotitoli });
      expect(leggiAttesa().schedaPrivacy?.sottotitoli.attivi).toBe(true);
      expect(leggiAttesa().schedaPrivacy?.trascrizione.sottotitoli).toBe(true);
    });

    it('sottotitoli non disponibili nell\'istanza: spenti, qualunque cosa dica l\'evento', async () => {
      await monta({ event: { ...conSottotitoli, liveCaptionsAvailable: false } });
      expect(leggiAttesa().schedaPrivacy?.sottotitoli.attivi).toBe(false);
    });

    it('chat e Q&A seguono i flag della sala, non il valore dell\'apertura', async () => {
      const chiusi: SchedaPrivacy = {
        ...SCHEDA,
        chat: { attiva: false, domandeAttive: false, esitoDomande: 'soloTesto' },
      };
      await monta({ event: { ...evento, schedaPrivacy: chiusi } });
      expect(leggiAttesa().schedaPrivacy?.chat).toEqual(chiusi.chat);

      flagsDellaSala.dati = { chatEnabled: true, qaEnabled: true };
      await monta({ event: { ...evento, schedaPrivacy: chiusi } });
      expect(leggiAttesa().schedaPrivacy?.chat).toEqual({
        attiva: true,
        domandeAttive: true,
        esitoDomande: 'soloTesto',
      });
    });

    it('prima che i flag arrivino, chat e Q&A valgono come all\'apertura', async () => {
      await monta({
        event: { ...evento, chatEnabled: true, qaEnabled: true, schedaPrivacy: SCHEDA },
      });
      expect(leggiAttesa().schedaPrivacy?.chat).toMatchObject({
        attiva: true,
        domandeAttive: true,
      });
    });

    it('la rubrica non arriva alla sala d\'attesa, che non ha quella casella', async () => {
      await monta({
        event: { ...evento, schedaPrivacy: { ...SCHEDA, rubrica: { mesi: 24 } } },
      });
      expect(leggiAttesa().schedaPrivacy?.rubrica).toBeNull();
    });

    describe('la casella della trascrizione segue i sottotitoli', () => {
      // La pagina ha calcolato l'evento con i sottotitoli spenti.
      const spentiAllApertura = {
        ...evento,
        recordingEnabled: false,
        schedaPrivacy: {
          ...SCHEDA,
          trascrizione: { sottotitoli: false, tracce: null, dalVideo: false },
          sottotitoli: { attivi: false, testoConservato: true },
        },
        liveCaptionsAvailable: true,
        liveCaptionsEnabled: false,
        captionsTranscript: false,
      };
      const accesiAllApertura = {
        ...spentiAllApertura,
        schedaPrivacy: SCHEDA,
        liveCaptionsEnabled: true,
        captionsTranscript: true,
      };
      const scrittaFinestra = l.consents.transcription.give;

      it('in sala d\'attesa compare quando chi modera li accende', async () => {
        await monta({ event: spentiAllApertura });
        expect(leggiAttesa().event.captionsTranscript).toBe(false);

        flagsDellaSala.dati = { liveCaptionsEnabled: true };
        await monta({ event: spentiAllApertura });
        expect(leggiAttesa().event.captionsTranscript).toBe(true);
        expect(leggiAttesa().schedaPrivacy?.trascrizione.sottotitoli).toBe(true);
      });

      it('in sala d\'attesa scompare quando chi modera li spegne', async () => {
        await monta({ event: accesiAllApertura });
        expect(leggiAttesa().event.captionsTranscript).toBe(true);

        flagsDellaSala.dati = { liveCaptionsEnabled: false };
        await monta({ event: accesiAllApertura });
        expect(leggiAttesa().event.captionsTranscript).toBe(false);
        expect(leggiAttesa().schedaPrivacy?.trascrizione.sottotitoli).toBe(false);
      });

      it('nella finestra dei consensi segue lo stesso valore', async () => {
        flagsDellaSala.dati = { liveCaptionsEnabled: false };
        await monta({ event: accesiAllApertura });
        await entra();
        expect(testo()).not.toContain(l.consents.button);

        flagsDellaSala.dati = { liveCaptionsEnabled: true };
        await monta({ event: accesiAllApertura });
        await premi(pulsante(l.consents.button));
        expect(testo()).toContain(scrittaFinestra);
      });

      it('chi ha gia\' acconsentito puo\' ritirare anche a sottotitoli spenti', async () => {
        flagsDellaSala.dati = { liveCaptionsEnabled: false };
        await monta({ event: accesiAllApertura, hasMultitrackConsent: true });
        await entra();
        await premi(pulsante(l.consents.button));
        expect(testo()).toContain(l.consents.given);
        expect(pulsante(l.consents.withdraw)).toBeTruthy();
      });

      it('dove il testo non si conserva la casella non compare', async () => {
        flagsDellaSala.dati = { liveCaptionsEnabled: true };
        const event = {
          ...spentiAllApertura,
          schedaPrivacy: {
            ...spentiAllApertura.schedaPrivacy,
            sottotitoli: { attivi: false, testoConservato: false },
          },
        };
        await monta({ event });
        expect(leggiAttesa().event.captionsTranscript).toBe(false);
      });

      it('sulle chiamate rapide, senza scheda, resta il valore della pagina', async () => {
        flagsDellaSala.dati = { liveCaptionsEnabled: false };
        await monta({
          event: { ...evento, captionsTranscript: true, liveCaptionsAvailable: true },
        });
        expect(leggiAttesa().event.captionsTranscript).toBe(true);
      });
    });
  });

  it('senza video il testo non dichiara una destinazione', async () => {
    await monta({
      event: { ...evento, recordingDestination: 'PUBLIC', voceNelVideo: 'assente' },
    });
    expect(leggiAttesa().recordingDestination).toBeNull();
  });
});

describe('sala — il testo su cui si acconsente', () => {
  it('viaggia con il consenso, null compreso', async () => {
    await monta();
    await entra({ recordingConsent: true, recordingConsentDestination: null });
    expect(richiesteToken()).toHaveLength(1);
    expect(ultimoToken()).toMatchObject({
      recordingConsent: true,
      recordingConsentDestination: null,
    });
  });

  it('senza consenso il campo non parte', async () => {
    await monta({ event: { ...evento, recordingDestination: 'PUBLIC' } });
    await entra();
    expect(ultimoToken()).not.toHaveProperty('recordingConsentDestination');
  });

  it('una destinazione allargata mostra il testo nuovo e il consenso va ridato su quello', async () => {
    await monta({ event: { ...evento, recordingDestination: 'REGISTRANTS' } });
    risposte.push({ recordingDestination: 'PUBLIC', voiceExcluded: true });
    await entra({ recordingConsent: true, recordingConsentDestination: 'REGISTRANTS' });
    expect(testo()).toContain(g.recordingPublic);
    expect(testo()).not.toContain(g.recordingReserved);
    expect(testo()).toContain(l.consents.textChanged);

    risposte.push({
      recordingDestination: 'PUBLIC',
      consentsRecorded: { recording: true, multitrack: false },
    });
    await premi(pulsante(l.voiceExcluded.consent));
    expect(ultimoToken()).toMatchObject({
      recordingConsent: true,
      recordingConsentDestination: 'PUBLIC',
    });
    expect(testo()).not.toContain(l.voiceExcluded.title);
    expect(testo()).not.toContain(l.consents.textChanged);
  });

  it('in solo ascolto il testo cambiato si spiega anche entrando', async () => {
    await monta({
      event: { ...evento, recordingDestination: 'REGISTRANTS', voceNelVideo: 'fissa' },
    });
    risposte.push({ recordingDestination: 'PUBLIC', listenOnly: true });
    await entra({ recordingConsent: true, recordingConsentDestination: 'REGISTRANTS' });
    expect(testo()).toContain(l.listenOnly.title);
    expect(testo()).toContain(g.recordingPublic);
    expect(testo()).toContain(l.consents.textChanged);
    expect(testo()).not.toContain(l.listenOnly.error);
  });

  it('chi non aveva acconsentito non ha niente da rileggere', async () => {
    await monta({ event: { ...evento, recordingDestination: 'REGISTRANTS' } });
    risposte.push({ recordingDestination: 'PUBLIC', voiceExcluded: true });
    await entra();
    expect(testo()).toContain(l.voiceExcluded.title);
    expect(testo()).toContain(g.recordingPublic);
    expect(testo()).not.toContain(l.consents.textChanged);
  });

  it("il consenso dimenticato non riparte con l'ingresso dopo", async () => {
    await monta({
      event: {
        ...evento,
        multitrackRecordingEnabled: true,
        recordingDestination: 'REGISTRANTS',
      },
    });
    risposte.push({ recordingDestination: 'PUBLIC', voiceExcluded: true });
    await entra({ recordingConsent: true, recordingConsentDestination: 'REGISTRANTS' });
    await premi(pulsante(l.consents.button));
    expect(testo()).toContain(l.consents.notGiven);
    expect(testo()).toContain(g.recordingPublic);

    risposte.push({ recordingDestination: 'PUBLIC', voiceExcluded: true });
    await caduta();
    expect(richiesteToken()).toHaveLength(2);
    expect(ultimoToken()).not.toHaveProperty('recordingConsent');
    expect(ultimoToken()).not.toHaveProperty('recordingConsentDestination');
  });

  it('un consenso valido torna con ogni rientro, con lo stesso testo', async () => {
    await monta({ event: { ...evento, recordingDestination: 'REGISTRANTS' } });
    risposte.push({
      recordingDestination: 'REGISTRANTS',
      consentsRecorded: { recording: true, multitrack: false },
    });
    await entra({ recordingConsent: true, recordingConsentDestination: 'REGISTRANTS' });
    risposte.push({ recordingDestination: 'REGISTRANTS' });
    await caduta();
    expect(richiesteToken()).toHaveLength(2);
    expect(ultimoToken()).toMatchObject({
      recordingConsent: true,
      recordingConsentDestination: 'REGISTRANTS',
    });
  });

  it("un consenso gia' salvato che non copre piu' si dimentica al rientro", async () => {
    await monta({
      event: {
        ...evento,
        multitrackRecordingEnabled: true,
        recordingDestination: 'REGISTRANTS',
      },
    });
    risposte.push({
      recordingDestination: 'REGISTRANTS',
      consentsRecorded: { recording: true, multitrack: false },
    });
    await entra({ recordingConsent: true, recordingConsentDestination: 'REGISTRANTS' });
    risposte.push({ recordingDestination: 'PUBLIC', voiceExcluded: true });
    await caduta();
    expect(testo()).toContain(l.consents.textChanged);
    await premi(pulsante(l.consents.button));
    expect(testo()).toContain(l.consents.notGiven);

    risposte.push({ recordingDestination: 'PUBLIC', voiceExcluded: true });
    await caduta();
    expect(ultimoToken()).not.toHaveProperty('recordingConsent');
    expect(testo()).toContain(l.consents.textChanged);
  });

  it("tornando in sala d'attesa la casella si richiede sul testo nuovo", async () => {
    await monta({ event: { ...evento, recordingDestination: 'REGISTRANTS' } });
    risposte.push({ recordingDestination: 'PUBLIC', voiceExcluded: true });
    await entra({ recordingConsent: true, recordingConsentDestination: 'REGISTRANTS' });
    risposte.push({ stato: 409 });
    statiEvento.push('LIVE', 'PUBLISHED');
    await caduta();
    expect(leggiAttesa()).toMatchObject({
      recordingConsentRequired: true,
      recordingDestination: 'PUBLIC',
    });
  });

  it("il consenso ridato dalla sala d'attesa chiude il messaggio", async () => {
    await monta({
      event: {
        ...evento,
        multitrackRecordingEnabled: true,
        recordingDestination: 'REGISTRANTS',
      },
    });
    risposte.push({ recordingDestination: 'PUBLIC', voiceExcluded: true });
    await entra({ recordingConsent: true, recordingConsentDestination: 'REGISTRANTS' });
    risposte.push({ stato: 409 });
    statiEvento.push('LIVE', 'PUBLISHED');
    await caduta();

    risposte.push({
      recordingDestination: 'PUBLIC',
      consentsRecorded: { recording: true, multitrack: false },
    });
    await entra({ recordingConsent: true, recordingConsentDestination: 'PUBLIC' });
    expect(ultimoToken()).toMatchObject({ recordingConsentDestination: 'PUBLIC' });
    await premi(pulsante(l.consents.button));
    expect(testo()).toContain(l.consents.given);
    expect(testo()).not.toContain(l.consents.textChanged);
  });

  it('una restrizione non chiede niente, e il consenso resta sul testo letto', async () => {
    await monta({
      event: {
        ...evento,
        multitrackRecordingEnabled: true,
        recordingDestination: 'PUBLIC',
      },
    });
    risposte.push({
      recordingDestination: 'REGISTRANTS',
      consentsRecorded: { recording: true, multitrack: false },
    });
    await entra({ recordingConsent: true, recordingConsentDestination: 'PUBLIC' });
    await premi(pulsante(l.consents.button));
    expect(testo()).toContain(l.consents.given);

    risposte.push({ recordingDestination: 'REGISTRANTS' });
    await premi(pulsante(l.consents.transcription.give));
    expect(ultimoToken()).toMatchObject({
      recordingConsent: true,
      recordingConsentDestination: 'PUBLIC',
      multitrackConsent: true,
    });
  });

  it('una risposta senza il campo lascia la destinazione nota', async () => {
    await monta({ event: { ...evento, recordingDestination: 'PUBLIC' } });
    risposte.push({ voiceExcluded: true });
    await entra();
    expect(testo()).toContain(g.recordingPublic);
  });

  it("chi conduce porta il consenso trovato dalla pagina con il testo dell'apertura", async () => {
    await monta({
      event: {
        ...evento,
        multitrackRecordingEnabled: true,
        recordingDestination: 'REGISTRANTS',
      },
      isModerator: true,
      hasRecordingConsent: true,
    });
    risposte.push({ recordingDestination: 'PUBLIC' });
    await entra();
    expect(ultimoToken()).toMatchObject({
      recordingConsent: true,
      recordingConsentDestination: 'REGISTRANTS',
    });
    // Non copre piu': al prossimo ingresso non riparte, e si richiede.
    await premi(pulsante(l.consents.button));
    expect(testo()).toContain(l.consents.notGiven);
    expect(testo()).toContain(g.recordingPublic);
    expect(testo()).toContain(l.consents.textChanged);
  });

  it("il consenso dell'iscrizione decade solo se il server esclude la persona", async () => {
    await monta({
      event: {
        ...evento,
        multitrackRecordingEnabled: true,
        recordingDestination: 'REGISTRANTS',
      },
      hasRecordingConsent: true,
    });
    risposte.push({ recordingDestination: 'PUBLIC' });
    await entra();
    expect(ultimoToken()).not.toHaveProperty('recordingConsent');
    await premi(pulsante(l.consents.button));
    expect(testo()).toContain(l.consents.given);
    expect(testo()).not.toContain(l.consents.textChanged);
  });

  it("un consenso dell'iscrizione che non copre si richiede", async () => {
    await monta({
      event: {
        ...evento,
        multitrackRecordingEnabled: true,
        recordingDestination: 'REGISTRANTS',
      },
      hasRecordingConsent: true,
    });
    risposte.push({ recordingDestination: 'PUBLIC', voiceExcluded: true });
    await entra();
    expect(testo()).toContain(l.consents.textChanged);
    await premi(pulsante(l.consents.button));
    expect(testo()).toContain(l.consents.notGiven);
    expect(testo()).toContain(g.recordingPublic);

    risposte.push({ stato: 409 });
    statiEvento.push('LIVE', 'PUBLISHED');
    await caduta();
    expect(leggiAttesa().recordingConsentRequired).toBe(true);
  });
});

describe('sala — acconsentire dalla sala', () => {
  const dentroEsclusi = async (e: Props['event']) => {
    await monta({ event: e });
    risposte.push({ recordingDestination: e.recordingDestination, voiceExcluded: true });
    await entra();
  };

  it('il clic vale per il testo mostrato, e un testo cambiato intanto si rilegge', async () => {
    await dentroEsclusi({ ...evento, recordingDestination: 'REGISTRANTS' });
    risposte.push({ recordingDestination: 'PUBLIC', voiceExcluded: true });
    await premi(pulsante(l.voiceExcluded.consent));
    expect(ultimoToken()).toMatchObject({ recordingConsentDestination: 'REGISTRANTS' });
    expect(testo()).toContain(l.voiceExcluded.title);
    expect(testo()).toContain(g.recordingPublic);
    expect(testo()).toContain(l.consents.textChanged);
    expect(testo()).not.toContain(l.listenOnly.error);
    expect(pulsante(l.voiceExcluded.consent).disabled).toBe(false);

    // Riletto, il consenso vale.
    risposte.push({ recordingDestination: 'PUBLIC' });
    await premi(pulsante(l.voiceExcluded.consent));
    expect(ultimoToken()).toMatchObject({ recordingConsentDestination: 'PUBLIC' });
    expect(testo()).not.toContain(l.consents.textChanged);
    expect(testo()).not.toContain(l.voiceExcluded.title);
  });

  it('un 200 che lascia fuori dal video non passa per riuscito', async () => {
    await dentroEsclusi({ ...evento, recordingDestination: 'REGISTRANTS' });
    risposte.push({ recordingDestination: 'REGISTRANTS', voiceExcluded: true });
    await premi(pulsante(l.voiceExcluded.consent));
    expect(testo()).toContain(l.listenOnly.error);
    expect(testo()).not.toContain(l.consents.textChanged);
  });

  it('lo stesso in solo ascolto', async () => {
    const e: Props['event'] = {
      ...evento,
      recordingDestination: 'REGISTRANTS',
      voceNelVideo: 'fissa',
    };
    await monta({ event: e });
    risposte.push({ recordingDestination: 'REGISTRANTS', listenOnly: true });
    await entra();
    expect(testo()).toContain(g.recordingReserved);
    risposte.push({ recordingDestination: 'PUBLIC', listenOnly: true });
    await premi(pulsante(l.listenOnly.consent));
    expect(testo()).toContain(g.recordingPublic);
    expect(testo()).toContain(l.consents.textChanged);
  });

  it('un errore di rete resta un errore', async () => {
    await dentroEsclusi({ ...evento, recordingDestination: 'REGISTRANTS' });
    vi.mocked(fetch).mockImplementationOnce(async () => rispondi({}, 503));
    await premi(pulsante(l.voiceExcluded.consent));
    expect(testo()).toContain(l.listenOnly.error);
  });

  it('la finestra mostra la trascrizione anche quando parte dal video', async () => {
    await monta({ event: { ...evento, trascrizioneVideo: true } });
    await entra();
    await premi(pulsante(l.consents.button));
    expect(testo()).toContain(l.consents.transcription.title);
  });

  it('un ritiro chiude il messaggio, e il ricollegamento non lo riapre', async () => {
    await monta({
      event: {
        ...evento,
        multitrackRecordingEnabled: true,
        recordingDestination: 'REGISTRANTS',
      },
      hasMultitrackConsent: true,
    });
    risposte.push({ recordingDestination: 'PUBLIC', voiceExcluded: true });
    await entra({ recordingConsent: true, recordingConsentDestination: 'REGISTRANTS' });
    await premi(pulsante(l.consents.button));
    expect(testo()).toContain(l.consents.textChanged);

    risposte.push({ recordingDestination: 'PUBLIC', voiceExcluded: true });
    await premi(pulsante(l.consents.withdraw));
    await premi(pulsante(l.consents.confirm));
    await vi.waitFor(() => expect(richiesteToken()).toHaveLength(2));
    expect(ultimoToken()).not.toHaveProperty('recordingConsent');
    expect(testo()).not.toContain(l.consents.textChanged);
  });

  it('il consenso alla sola trascrizione non chiede di rileggere la registrazione', async () => {
    await monta({
      event: {
        ...evento,
        recordingEnabled: false,
        captionsTranscript: true,
        recordingDestination: 'PUBLIC',
      },
    });
    await entra();
    await premi(pulsante(l.consents.button));
    risposte.push({ recordingDestination: 'REGISTRANTS' });
    await premi(pulsante(l.consents.transcription.give));
    expect(ultimoToken()).toMatchObject({ multitrackConsent: true });
    expect(ultimoToken()).not.toHaveProperty('recordingConsent');
    expect(testo()).not.toContain(l.consents.textChanged);
    expect(testo()).not.toContain(l.consents.error);
  });
});

describe("sala — fine dell'evento", () => {
  const allaScelta = async (e: Props['event']) => {
    await monta({
      event: e,
      isModerator: true,
      isPrimaryModerator: true,
      token: 'token-moderatore',
    });
    await entra();
    await premi(pulsante(l.leaveRoom));
    await premi(pulsante(l.leaveChoice.endForAll));
  };
  const opzioni = () =>
    [...document.querySelectorAll<HTMLInputElement>('input[name="endDestino"]')].map(
      (i) => i.closest('label')?.textContent
    );
  const termina = async () => {
    await premi(pulsante(l.endDestino.confirm));
    const put = chiamate.filter((c) => c.method === 'PUT');
    expect(put).toHaveLength(1);
    return put[0]!;
  };

  it('«Termina per tutti» fa un solo PUT, senza i campi della guardia', async () => {
    await allaScelta({ ...evento, recordingDestination: 'REGISTRANTS' });
    const put = await termina();
    expect(put.url).toBe(`/api/events/${evento.id}`);
    expect(put.body).toEqual({ status: 'ENDED', postEventPublic: true });
  });

  it('su un evento pubblico la libreria si sceglie ancora', async () => {
    await allaScelta({ ...evento, recordingDestination: 'PUBLIC', libraryListed: true });
    expect(opzioni()).toHaveLength(3);
    const put = await termina();
    expect(put.body).toEqual({
      status: 'ENDED',
      postEventPublic: true,
      libraryListed: true,
    });
  });

  it('su un evento vecchio senza destinazione non cambia niente', async () => {
    await allaScelta({ ...evento, libraryListed: true });
    expect(opzioni()).toHaveLength(3);
    const put = await termina();
    expect(put.body).toMatchObject({ libraryListed: true });
  });

  it("un video riservato non offre la libreria, nemmeno se l'evento ci stava", async () => {
    await allaScelta({
      ...evento,
      recordingDestination: 'REGISTRANTS',
      libraryListed: true,
    });
    expect(opzioni()).toHaveLength(2);
    expect(testo()).not.toContain(l.endDestino.library);
    expect(
      document.querySelector<HTMLInputElement>('input[name="endDestino"]')?.checked
    ).toBe(true);
    const put = await termina();
    expect(put.body).toEqual({ status: 'ENDED', postEventPublic: true });
  });

  it('un video riservato dal pubblico scelto dopo non offre la libreria', async () => {
    await allaScelta({
      ...evento,
      recordingDestination: 'PUBLIC',
      recordingAudience: 'REGISTRANTS',
      libraryListed: true,
    });
    expect(opzioni()).toHaveLength(2);
    expect(testo()).not.toContain(l.endDestino.library);
    const put = await termina();
    expect(put.body).toEqual({ status: 'ENDED', postEventPublic: true });
  });

  it('riservato dal pubblico senza destinazione: la libreria resta fuori', async () => {
    await allaScelta({ ...evento, recordingAudience: 'REGISTRANTS' });
    expect(opzioni()).toHaveLength(2);
  });

  it("con la pagina privata la libreria nascosta non rende pubblico l'evento", async () => {
    await allaScelta({
      ...evento,
      recordingDestination: 'REGISTRANTS',
      libraryListed: true,
      postEventPublic: false,
    });
    expect(opzioni()).toHaveLength(2);
    const scelta = document.querySelector<HTMLInputElement>(
      'input[name="endDestino"]:checked'
    );
    expect(scelta?.closest('label')?.textContent).toContain(l.endDestino.archive);
    const put = await termina();
    expect(put.body).toEqual({ status: 'ENDED', postEventPublic: false });
  });

  it('la scelta di archiviare resta', async () => {
    await allaScelta({
      ...evento,
      recordingDestination: 'REGISTRANTS',
      postEventPublic: false,
    });
    const put = await termina();
    expect(put.body).toEqual({ status: 'ENDED', postEventPublic: false });
  });

  it('la trascrizione si offre solo dove parte da sola', async () => {
    await allaScelta({ ...evento, aiPostprodEnabled: true, trascrizioneVideo: true });
    expect(testo()).not.toContain(l.endDestino.genAi);
  });

  it('con le tracce per persona parte da sola, e il PUT lo dice', async () => {
    await allaScelta({
      ...evento,
      aiPostprodEnabled: true,
      multitrackRecordingEnabled: true,
    });
    expect(testo()).toContain(l.endDestino.genAi);
    await premi(
      document.querySelector<HTMLInputElement>('.modal input[type="checkbox"]')!
    );
    const put = await termina();
    expect(put.body).toMatchObject({ aiTranscriptEnabled: true, aiSummaryEnabled: true });
  });
});
