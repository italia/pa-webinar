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
const conferenza = vi.hoisted(() => ({ perdiConnessione: () => {}, jwt: '' }));

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
      jwt,
    }: {
      onReady: () => void;
      onConnectionLost: () => void;
      jwt: string;
    }) {
      const entra = useRef(onReady);
      useEffect(() => entra.current(), []);
      conferenza.perdiConnessione = onConnectionLost;
      conferenza.jwt = jwt;
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
  // Lo stesso oggetto a ogni render, come il router vero: un riferimento nuovo
  // rifarebbe ogni callback che lo usa e nasconderebbe le chiusure vecchie.
  const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
  const { createElement } = await import('react');
  return {
    Link: ({ href, children }: { href: unknown; children?: unknown }) =>
      createElement('a', { href: String(href) }, children as never),
    percorso: (p: string) => p,
    useRouter: () => router,
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
const comandoRec = vi.hoisted(() => ({ attivo: null as boolean | null }));
vi.mock('@/hooks/use-recording-control', () => ({
  useRecordingControl: ({ attivo }: { attivo: boolean }) => {
    comandoRec.attivo = attivo;
    return { fase: 'ferma' };
  },
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
const pannelloDomande = vi.hoisted(() => ({ props: null as { domandePubblicate: boolean } | null }));
vi.mock('@/components/qa/qa-panel', () => ({
  default: (props: { domandePubblicate: boolean }) => {
    pannelloDomande.props = props;
    return null;
  },
}));
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
  role?: 'moderator';
  consentsRecorded?: { recording: boolean; multitrack: boolean };
  consentsInForce?: { recording: boolean; transcription: boolean };
  /** Lo stato della risposta, se non e' un 200. */
  stato?: number;
}

let container: HTMLDivElement;
let root: Root;
let chiamate: { url: string; method: string; body: Record<string, unknown> }[];
let risposte: Risposta[];
/** Le risposte alla rilettura dei consensi, una per richiesta. */
let letture: (Record<string, unknown> | Promise<Response>)[];
/** Gli stati dell'evento che /lifecycle risponde, uno per richiesta. */
let statiEvento: string[];

const rispondi = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const richiesteToken = () => chiamate.filter((c) => c.url.endsWith('/jitsi/token'));
const riletture = () => chiamate.filter((c) => c.url.endsWith('/consents/in-force'));
const ultimoToken = () => richiesteToken().at(-1)?.body;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  attesa.props = null;
  chiamate = [];
  risposte = [];
  letture = [];
  statiEvento = [];
  flagsDellaSala.dati = undefined;
  pannelloDomande.props = null;
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
      if (url.endsWith('/consents/in-force')) {
        const lettura = letture.shift() ?? {};
        return lettura instanceof Promise ? lettura : rispondi(lettura);
      }
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
        tracceConservate: true,
      },
    });
    const a = leggiAttesa();
    expect(a.recordingDestination).toBe('REGISTRANTS');
    expect(a.voce).toBe('rimovibile');
    expect(a.event).toMatchObject({
      videoDisponibile: true,
      trascrizioneVideo: true,
      tracceConservate: true,
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
      trascrizione: { chiesta: true, sottotitoli: true, tracce: null, dalVideo: false },
      sottotitoli: { attivi: true, testoConservato: true },
      ia: null,
      chat: { attiva: true, domandeAttive: true, esitoDomande: 'soloTesto' },
      elencoVisibile: true,
      pseudonimi: false,
      conservazione: { giorniDati: 30, registrazione: null },
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

    it.each([true, false])('una chiamata rapida apre il Q&A dal vivo: domande pubblicabili %s', async (valore) => {
      flagsDellaSala.dati = { qaEnabled: true };
      await monta({
        event: {
          ...evento,
          eventType: 'INSTANT',
          qaEnabled: false,
          schedaPrivacy: null,
          postEventShow: {
            recap: false,
            qa: false,
            polls: false,
            wordCloud: false,
            materials: false,
            feedback: false,
          },
          domandePubblicabili: valore,
        },
      });
      await entra();
      const scheda = [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === l.sidebarTabQa,
      );
      await act(async () => scheda?.click());
      expect(pannelloDomande.props?.domandePubblicate).toBe(valore);
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
          trascrizione: { chiesta: false, sottotitoli: false, tracce: null, dalVideo: false },
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

  it('un consenso salvato torna a ogni rientro come replica, mai come clic', async () => {
    await monta({ event: { ...evento, recordingDestination: 'REGISTRANTS' } });
    risposte.push({
      recordingDestination: 'REGISTRANTS',
      consentsRecorded: { recording: true, multitrack: false },
    });
    await entra({ recordingConsent: true, recordingConsentDestination: 'REGISTRANTS' });
    expect(ultimoToken()).toMatchObject({ recordingConsent: true });
    expect(ultimoToken()).not.toHaveProperty('consentReplay');
    risposte.push({ recordingDestination: 'REGISTRANTS' });
    await caduta();
    expect(richiesteToken()).toHaveLength(2);
    expect(ultimoToken()).toMatchObject({
      consentReplay: { recording: true, multitrack: false, roomTokens: ['jwt-1'] },
    });
    expect(ultimoToken()).not.toHaveProperty('recordingConsent');
    expect(ultimoToken()).not.toHaveProperty('multitrackConsent');
  });

  it('il server decide se un consenso copre il testo in vigore', async () => {
    await monta({
      event: { ...evento, recordingDestination: 'REGISTRANTS' },
      isModerator: true,
      hasRecordingConsent: true,
    });
    risposte.push({
      recordingDestination: 'PUBLIC',
      consentsInForce: { recording: true, transcription: false },
    });
    await entra();
    expect(testo()).not.toContain(l.consents.textChanged);
    await premi(pulsante(l.consents.button));
    expect(testo()).toContain(l.consents.given);
  });

  it('un clic non salvato resta un clic al rientro', async () => {
    await monta({ event: { ...evento, recordingDestination: 'REGISTRANTS' } });
    await entra({ recordingConsent: true, recordingConsentDestination: 'REGISTRANTS' });
    risposte.push({ recordingDestination: 'REGISTRANTS' });
    await caduta();
    expect(ultimoToken()).toMatchObject({ recordingConsent: true });
    expect(ultimoToken()).not.toHaveProperty('consentReplay');
  });

  it('un consenso ritirato altrove non torna: la replica rifiutata non diventa un clic', async () => {
    await monta({ event: { ...evento, multitrackRecordingEnabled: true } });
    risposte.push({ consentsInForce: { recording: true, transcription: true } });
    await entra({
      recordingConsent: true,
      recordingConsentDestination: null,
      multitrackConsent: true,
    });
    await premi(pulsante(l.consents.button));
    expect(testo()).toContain(l.consents.given);

    risposte.push({
      voiceExcluded: true,
      consentsInForce: { recording: false, transcription: false },
    });
    await caduta();
    expect(ultimoToken()).toMatchObject({ consentReplay: { recording: true, multitrack: true } });
    expect(ultimoToken()).not.toHaveProperty('recordingConsent');
    expect(testo()).toContain(l.consents.notGiven);
    expect(testo()).not.toContain(l.consents.given);

    risposte.push({
      voiceExcluded: true,
      consentsInForce: { recording: false, transcription: false },
    });
    await caduta();
    expect(ultimoToken()).not.toHaveProperty('recordingConsent');
    expect(ultimoToken()).not.toHaveProperty('multitrackConsent');
    expect(ultimoToken()).not.toHaveProperty('consentReplay');

    // Solo un nuovo clic lo ridà.
    risposte.push({ consentsInForce: { recording: true, transcription: false } });
    await premi(pulsante(l.consents.recording.give));
    expect(ultimoToken()).toMatchObject({ recordingConsent: true });
  });

  it('il token aggiorna lo stato letto all apertura', async () => {
    await monta({
      event: { ...evento, multitrackRecordingEnabled: true },
      hasRecordingConsent: true,
      hasMultitrackConsent: true,
    });
    risposte.push({ consentsInForce: { recording: true, transcription: false } });
    await entra();
    await premi(pulsante(l.consents.button));
    expect(pulsante(l.consents.transcription.give).disabled).toBe(false);
    expect(ultimoToken()).not.toHaveProperty('multitrackConsent');
  });

  it('il token dice anche un consenso che la pagina non aveva letto', async () => {
    await monta({
      event: { ...evento, multitrackRecordingEnabled: true },
      hasRecordingConsent: true,
    });
    risposte.push({ consentsInForce: { recording: true, transcription: true } });
    await entra();
    await premi(pulsante(l.consents.button));
    expect(testo()).toContain(l.consents.transcription.withdrawEffect);
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
      consentReplay: { recording: true },
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
    expect(ultimoToken()).toMatchObject({ consentReplay: { recording: true, roomTokens: [] } });
    expect(ultimoToken()).not.toHaveProperty('recordingConsent');
    // Non copre piu': al prossimo ingresso non riparte, e si richiede.
    await premi(pulsante(l.consents.button));
    expect(testo()).toContain(l.consents.notGiven);
    expect(testo()).toContain(g.recordingPublic);
    expect(testo()).toContain(l.consents.textChanged);
  });

  it('chi conduce porta la trascrizione trovata dalla pagina, come la registrazione', async () => {
    await monta({
      event: { ...evento, multitrackRecordingEnabled: true },
      isModerator: true,
      hasMultitrackConsent: true,
    });
    await entra();
    expect(ultimoToken()).toMatchObject({ consentReplay: { multitrack: true, roomTokens: [] } });
    expect(ultimoToken()).not.toHaveProperty('multitrackConsent');
  });

  it('chi conduce non riporta la trascrizione che la rilettura ha trovato decaduta', async () => {
    await monta({
      event: { ...evento, multitrackRecordingEnabled: true },
      isModerator: true,
      hasMultitrackConsent: true,
    });
    risposte.push({ consentsRecorded: { recording: true, multitrack: false } });
    await entra();
    // Cambia solo la trascrizione: registrazione e testo in vigore restano com'erano.
    letture.push({ recording: true, transcription: false });
    await premi(pulsante(l.consents.button));
    await act(async () => {
      await new Promise((fatto) => setTimeout(fatto, 0));
    });
    await caduta();
    expect(ultimoToken()?.consentReplay).toMatchObject({ recording: true, multitrack: false });
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
    risposte.push({
      recordingDestination: 'REGISTRANTS',
      consentsRecorded: { recording: false, multitrack: true },
    });
    await premi(pulsante(l.consents.transcription.give));
    expect(ultimoToken()).toMatchObject({ multitrackConsent: true });
    expect(ultimoToken()).not.toHaveProperty('recordingConsent');
    expect(testo()).not.toContain(l.consents.textChanged);
    expect(testo()).not.toContain(l.consents.error);
  });

  it('un consenso alla trascrizione che il server non applica si dice', async () => {
    await monta({
      event: { ...evento, recordingEnabled: false, captionsTranscript: true },
    });
    await entra();
    await premi(pulsante(l.consents.button));
    await premi(pulsante(l.consents.transcription.give));
    expect(testo()).toContain(l.consents.error);
  });
});

describe('sala — la finestra dei consensi', () => {
  const soloAvviso = {
    ...evento,
    participantsCanUnmute: false,
    participantsCanStartVideo: false,
    participantsCanShareScreen: false,
  };
  const TESTO_ENTE = 'Testo scelto per evento';

  it("il consenso valido si ritira anche dove l'evento non lo chiede", async () => {
    await monta({ event: soloAvviso, hasRecordingConsent: true });
    risposte.push({ consentsInForce: { recording: true, transcription: false } });
    await entra();
    await premi(pulsante(l.consents.button));
    expect(testo()).toContain(l.consents.recording.title);
    expect(testo()).toContain(l.consents.given);
    expect(pulsante(l.consents.withdraw).disabled).toBe(false);
  });

  it("dove l'evento avvisa soltanto, il ritiro dice cosa cambia, prima di agire", async () => {
    await monta({
      event: { ...soloAvviso, voceNelVideo: 'fissa' },
      hasRecordingConsent: true,
    });
    risposte.push({ consentsInForce: { recording: true, transcription: false } });
    await entra();
    await premi(pulsante(l.consents.button));
    expect(document.getElementById('live-consents-rec-effetto')?.textContent).toBe(
      l.consents.recording.withdraw.avvertenza
    );
  });

  it("senza un video il ritiro dice cosa cambia", async () => {
    await monta({
      event: { ...soloAvviso, voceNelVideo: 'assente' },
      hasRecordingConsent: true,
    });
    risposte.push({ consentsInForce: { recording: true, transcription: false } });
    await entra();
    await premi(pulsante(l.consents.button));
    expect(document.getElementById('live-consents-rec-effetto')?.textContent).toBe(
      l.consents.recording.withdraw.assente
    );
  });

  it('senza consenso alla registrazione la trascrizione non si offre per nulla', async () => {
    await monta({ event: { ...soloAvviso, multitrackRecordingEnabled: true } });
    risposte.push({ voiceExcluded: true });
    await entra();
    await premi(pulsante(l.consents.button));
    expect(pulsante(l.consents.transcription.give).disabled).toBe(true);
    expect(testo()).toContain(l.consents.transcription.needsRecording);
    expect(pulsante(l.consents.recording.give).disabled).toBe(false);
  });

  it("il testo dell'ente compare dove si da' il consenso", async () => {
    await monta({ event: { ...evento, recordingConsentText: TESTO_ENTE } });
    risposte.push({ voiceExcluded: true });
    await entra();
    await premi(pulsante(l.consents.button));
    expect(document.getElementById('live-consents-rec-nota')?.textContent).toContain(TESTO_ENTE);
  });

  it("in solo ascolto il testo dell'ente sta sopra il pulsante", async () => {
    await monta({
      event: { ...evento, voceNelVideo: 'fissa', recordingConsentText: TESTO_ENTE },
    });
    risposte.push({ listenOnly: true });
    await entra();
    expect(document.querySelector('.live-listen-only')?.textContent).toContain(TESTO_ENTE);
  });

  it('il testo della casella della trascrizione arriva alla finestra', async () => {
    await monta({
      event: { ...evento, multitrackRecordingEnabled: true, tracceConservate: true },
      hasRecordingConsent: true,
    });
    risposte.push({ consentsInForce: { recording: true, transcription: false } });
    await entra();
    await premi(pulsante(l.consents.button));
    expect(document.getElementById('live-consents-tr-nota')?.textContent).toContain(
      g.multitrackRetained
    );
  });
});

describe('sala — i consensi riletti a sala aperta', () => {
  const conTrascrizione = { ...evento, multitrackRecordingEnabled: true };
  const accesiEDati = { recording: true, transcription: true };
  const conConsensi = { hasRecordingConsent: true, hasMultitrackConsent: true };
  const tutti = async () => {
    await act(async () => {
      await new Promise((fatto) => setTimeout(fatto, 0));
    });
  };

  async function inSalaConIConsensi() {
    await monta({ event: conTrascrizione, ...conConsensi });
    risposte.push({ consentsInForce: accesiEDati });
    await entra();
  }

  it('aprendo la finestra chiede lo stato con i token della visita, senza un token nuovo', async () => {
    await inSalaConIConsensi();
    letture.push({ ...accesiEDati, recordingDestination: null });
    const token = richiesteToken().length;
    await premi(pulsante(l.consents.button));
    await tutti();
    expect(riletture().map((c) => c.body)).toEqual([{ roomTokens: ['jwt-1'] }]);
    expect(richiesteToken()).toHaveLength(token);
    expect(riletture()[0]?.method).toBe('POST');
  });

  it('un consenso che non vale piu si vede e si puo ridare', async () => {
    await inSalaConIConsensi();
    letture.push({ recording: true, transcription: false, recordingDestination: null });
    await premi(pulsante(l.consents.button));
    await tutti();
    expect(pulsante(l.consents.transcription.give).disabled).toBe(false);
    expect(testo()).toContain(l.consents.notGiven);
  });

  it('un ritiro altrove lo vede anche la registrazione, con il testo in vigore', async () => {
    await inSalaConIConsensi();
    letture.push({ recording: false, transcription: false, recordingDestination: 'PUBLIC' });
    await premi(pulsante(l.consents.button));
    await tutti();
    expect(pulsante(l.consents.recording.give).disabled).toBe(false);
    expect(document.getElementById('live-consents-rec-nota')?.textContent).toContain(
      g.recordingPublic
    );
  });

  it('il rientro dopo la rilettura non riporta il consenso che non vale piu', async () => {
    await inSalaConIConsensi();
    letture.push({ recording: true, transcription: false, recordingDestination: null });
    await premi(pulsante(l.consents.button));
    await tutti();
    risposte.push({ consentsInForce: { recording: true, transcription: false } });
    await caduta();
    expect(ultimoToken()?.consentReplay).toMatchObject({ recording: true, multitrack: false });
  });

  it('una risposta che non dice lo stato lascia tutto com era', async () => {
    await inSalaConIConsensi();
    letture.push({});
    await premi(pulsante(l.consents.button));
    await tutti();
    expect(pulsante(l.consents.withdraw).disabled).toBe(false);
    expect(testo()).not.toContain(l.consents.notGiven);
  });

  it('una lettura partita prima di un token nuovo non vale', async () => {
    await inSalaConIConsensi();
    let rispondiTardi = (_: Response) => {};
    letture.push(new Promise<Response>((r) => (rispondiTardi = r)));
    await premi(pulsante(l.consents.button));
    risposte.push({ consentsInForce: accesiEDati });
    await caduta();
    await act(async () => {
      rispondiTardi(
        rispondi({ recording: false, transcription: false, recordingDestination: null })
      );
    });
    await tutti();
    expect(testo()).not.toContain(l.consents.notGiven);
  });

  describe('quando cambiano i sottotitoli', () => {
    const sottotitoli = {
      ...conTrascrizione,
      liveCaptionsAvailable: true,
      captionsTranscript: true,
    };

    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
    });
    afterEach(() => vi.restoreAllMocks());

    it('chi ha il consenso lo rilegge', async () => {
      flagsDellaSala.dati = { liveCaptionsEnabled: false };
      await monta({ event: sottotitoli, ...conConsensi });
      risposte.push({ consentsInForce: accesiEDati });
      await entra();
      await tutti();
      expect(riletture()).toHaveLength(0);

      flagsDellaSala.dati = { liveCaptionsEnabled: true };
      await monta({ event: sottotitoli, ...conConsensi });
      await tutti();
      expect(riletture()).toHaveLength(1);
    });

    it('chi non ha il consenso non chiede niente', async () => {
      flagsDellaSala.dati = { liveCaptionsEnabled: false };
      await monta({ event: sottotitoli, hasRecordingConsent: true });
      risposte.push({ consentsInForce: { recording: true, transcription: false } });
      await entra();

      flagsDellaSala.dati = { liveCaptionsEnabled: true };
      await monta({ event: sottotitoli, hasRecordingConsent: true });
      await tutti();
      expect(riletture()).toHaveLength(0);
    });
  });
});

describe('sala — un ritiro e un token insieme', () => {
  const CON_CONSENSO = {
    recordingDestination: 'REGISTRANTS' as const,
    consentsRecorded: { recording: true, multitrack: false },
    consentsInForce: { recording: true, transcription: false },
  };
  const SENZA_CONSENSO = {
    recordingDestination: 'REGISTRANTS' as const,
    voiceExcluded: true,
    consentsRecorded: { recording: false, multitrack: false },
    consentsInForce: { recording: false, transcription: false },
  };
  const ritiri = () => chiamate.filter((c) => c.url.endsWith('/consents/withdraw'));
  const pausa = (ms: number) => act(async () => { await new Promise((fatto) => setTimeout(fatto, ms)); });

  async function dentroConConsenso() {
    await monta({ event: { ...evento, recordingDestination: 'REGISTRANTS' }, isGuest: true });
    risposte.push(CON_CONSENSO);
    await entra({ recordingConsent: true, recordingConsentDestination: 'REGISTRANTS' });
    expect(conferenza.jwt).toBe('jwt-1');
  }

  /** La prima richiesta che finisce per `fine` resta appesa finche' non la si sblocca. */
  function trattieni(fine: string) {
    const base = vi.mocked(fetch).getMockImplementation()!;
    let sblocca: (r: Response) => void = () => {};
    let attiva = true;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith(fine) && attiva) {
        attiva = false;
        chiamate.push({ url: String(input), method: 'POST', body: JSON.parse(String(init?.body)) });
        return new Promise<Response>((fatto) => {
          sblocca = fatto;
        });
      }
      return base(input, init);
    });
    return (corpo: unknown, stato = 200) => sblocca(rispondi(corpo, stato));
  }

  async function confermaRitiro() {
    await premi(pulsante(l.consents.button));
    await premi(pulsante(l.consents.withdraw));
    await premi(pulsante(l.consents.confirm));
  }

  it('il ritiro aspetta il token in volo e ritira anche il suo posto', async () => {
    await dentroConConsenso();
    const sblocca = trattieni('/jitsi/token');
    await act(async () => conferenza.perdiConnessione());
    await vi.waitFor(() => expect(richiesteToken()).toHaveLength(2));
    expect(ultimoToken()).toMatchObject({ consentReplay: { recording: true } });

    risposte.push(SENZA_CONSENSO);
    await confermaRitiro();
    await pausa(20);
    expect(ritiri()).toHaveLength(0);

    await act(async () => {
      sblocca({ jwt: 'jwt-B', roomName: 'stanza', displayName: 'Relatore 1', role: 'participant', ...CON_CONSENSO });
    });
    await vi.waitFor(() => expect(ritiri()).toHaveLength(1));
    expect(ritiri()[0]!.body).toEqual({ roomTokens: ['jwt-1', 'jwt-B'], recording: true });

    await vi.waitFor(() => expect(richiesteToken()).toHaveLength(3));
    expect(ultimoToken()).not.toHaveProperty('consentReplay');
    await pausa(10);
    expect(conferenza.jwt).toBe('jwt-3');
    expect(testo()).not.toContain(l.consents.given);
  });

  it('un token chiesto a ritiro partito aspetta, e riparte senza il consenso', async () => {
    await dentroConConsenso();
    const sblocca = trattieni('/consents/withdraw');
    await confermaRitiro();
    await vi.waitFor(() => expect(ritiri()).toHaveLength(1));

    await act(async () => conferenza.perdiConnessione());
    await pausa(20);
    expect(richiesteToken()).toHaveLength(1);

    risposte.push(SENZA_CONSENSO, SENZA_CONSENSO);
    await act(async () => sblocca({}));
    await vi.waitFor(() => expect(richiesteToken().length).toBeGreaterThan(1));
    await pausa(20);
    for (const richiesta of richiesteToken().slice(1)) {
      expect(richiesta.body).not.toHaveProperty('consentReplay');
    }
  });

  it('un ritiro fallito lascia libero il token dopo', async () => {
    await dentroConConsenso();
    const sblocca = trattieni('/consents/withdraw');
    await confermaRitiro();
    await vi.waitFor(() => expect(ritiri()).toHaveLength(1));
    await act(async () => {
      sblocca({ error: 'no' }, 500);
    });
    risposte.push(CON_CONSENSO);
    await act(async () => conferenza.perdiConnessione());
    await vi.waitFor(() => expect(richiesteToken()).toHaveLength(2));
    expect(ultimoToken()).toMatchObject({ consentReplay: { recording: true } });
  });
});

describe('sala — la fascia di chi resta fuori dalla registrazione', () => {
  const fascia = () => document.querySelector('.live-listen-only');
  const pulsanteConsensi = () => document.querySelector<HTMLElement>('.live-consents-btn');
  const chiudi = () => premi(document.querySelector<HTMLElement>('.live-listen-only__chiudi')!);
  const eventoRiservato: Props['event'] = { ...evento, recordingDestination: 'REGISTRANTS' };

  async function dentro(risposta: Risposta, e: Props['event'] = eventoRiservato) {
    await monta({ event: e });
    risposte.push({ recordingDestination: 'REGISTRANTS', ...risposta });
    await entra();
    expect(fascia()).not.toBeNull();
  }

  it.each<[string, Risposta, Props['event']]>([
    ['chi non acconsente', { voiceExcluded: true }, eventoRiservato],
    ['chi segue in solo ascolto', { listenOnly: true }, { ...eventoRiservato, voceNelVideo: 'fissa' }],
  ])('%s la chiude e tiene il pulsante dei consensi, che prende il fuoco', async (_chi, risposta, e) => {
    await dentro(risposta, e);
    await chiudi();
    expect(fascia()).toBeNull();
    expect(pulsanteConsensi()).not.toBeNull();
    expect(document.activeElement).toBe(pulsanteConsensi());

    await premi(pulsanteConsensi()!);
    expect(testo()).toContain(l.consents.intro);
    expect(testo()).toContain(l.consents.recording.give);
  });

  it('il token successivo non la riapre', async () => {
    await dentro({ voiceExcluded: true });
    await chiudi();
    risposte.push({ recordingDestination: 'REGISTRANTS', voiceExcluded: true });
    await caduta();
    await act(async () => {
      await new Promise((fatto) => setTimeout(fatto, 10));
    });
    expect(richiesteToken()).toHaveLength(2);
    expect(fascia()).toBeNull();
  });

  it('torna per dire un errore', async () => {
    await dentro({ voiceExcluded: true });
    await chiudi();
    await premi(pulsanteConsensi()!);
    vi.mocked(fetch).mockImplementationOnce(async () => rispondi({}, 503));
    await premi(pulsante(l.consents.recording.give));
    expect(fascia()?.textContent).toContain(l.listenOnly.error);

    await chiudi();
    expect(fascia()).toBeNull();
    if (!testo().includes(l.consents.intro)) await premi(pulsanteConsensi()!);
    expect(testo()).toContain(l.consents.recording.give);
    expect(testo()).toContain(l.consents.error);

    vi.mocked(fetch).mockImplementationOnce(async () => rispondi({}, 503));
    await premi(pulsante(l.consents.recording.give));
    expect(fascia()?.textContent).toContain(l.listenOnly.error);
  });

  it('torna quando cambia il testo', async () => {
    await dentro({ voiceExcluded: true });
    await chiudi();
    await premi(pulsanteConsensi()!);
    risposte.push({ recordingDestination: 'PUBLIC', voiceExcluded: true });
    await premi(pulsante(l.consents.recording.give));
    expect(fascia()?.textContent).toContain(l.consents.textChanged);

    await chiudi();
    expect(fascia()).toBeNull();
    if (!testo().includes(l.consents.intro)) await premi(pulsanteConsensi()!);
    expect(testo()).toContain(l.consents.textChanged);
  });
});

describe("sala — la scheda in sala d'attesa", () => {
  const scheda = {
    pseudonimi: true,
    registrazione: {
      modo: 'manuale',
      destinazione: 'PUBLIC',
      chiNonAcconsente: 'soloAscolto',
      conduceSempre: false,
    },
    trascrizione: { chiesta: false, sottotitoli: false, tracce: null, dalVideo: false },
    sottotitoli: { attivi: false, testoConservato: false },
    chat: { attiva: true, domandeAttive: false, esitoDomande: 'soloTesto' },
  } as unknown as SchedaPrivacy;

  it('dice a chi conduce cio che vale per lui', async () => {
    await monta({ event: { ...evento, schedaPrivacy: scheda }, isModerator: true });
    expect(leggiAttesa().schedaPrivacy).toMatchObject({
      pseudonimi: false,
      registrazione: { chiNonAcconsente: 'conduceRipreso' },
    });
  });

  it('al pubblico resta quella dell evento', async () => {
    await monta({ event: { ...evento, schedaPrivacy: scheda } });
    expect(leggiAttesa().schedaPrivacy).toMatchObject({
      pseudonimi: true,
      registrazione: { chiNonAcconsente: 'soloAscolto' },
    });
  });

  it('il consenso alla trascrizione gia dato fa nominare il nome che resta', async () => {
    await monta({ event: { ...evento, schedaPrivacy: scheda } });
    expect(leggiAttesa().schedaPrivacy?.trascrizione.chiesta).toBe(false);
    await monta({ event: { ...evento, schedaPrivacy: scheda }, hasMultitrackConsent: true });
    expect(leggiAttesa().schedaPrivacy?.trascrizione.chiesta).toBe(true);
  });
});

describe('sala — dove non si registra niente', () => {
  const registrato = {
    ...evento,
    recordingEnabled: true,
    participantsCanUnmute: true,
  };

  it('il comando di registrazione non si offre a chi conduce', async () => {
    await monta({ event: registrato, isModerator: true, recordingAvailable: false });
    risposte.push({ role: 'moderator' });
    await entra();
    expect(comandoRec.attivo).toBe(false);
  });

  it('dove si registra si offre', async () => {
    await monta({ event: registrato, isModerator: true, recordingAvailable: true });
    risposte.push({ role: 'moderator' });
    await entra();
    expect(comandoRec.attivo).toBe(true);
  });

  it('non si chiede il consenso e la finestra non lo mostra', async () => {
    await monta({ event: registrato, recordingAvailable: false });
    expect(leggiAttesa().recordingConsentRequired).toBe(false);
    expect(leggiAttesa().event.recordingEnabled).toBe(false);
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
