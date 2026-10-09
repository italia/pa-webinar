'use client';

/**
 * Experimental Phaser lobby engine (flagged via `?engine=phaser`) — an
 * alternative to the SVG GardenInteractive. This wrapper is the ONLY place the
 * concrete adapters are wired to the isolated `@pa-webinar/lobby` game; it is
 * loaded through `next/dynamic({ ssr: false })`, so Phaser stays client-only and
 * out of the main bundle.
 *
 * Lifecycle: mounted once (mountLobby), then prop changes are pushed in —
 * `event.status` → the schedule adapter (gate opens on LIVE with no refresh),
 * the typed name → the local profile. Pressing "Entra" inside the game calls
 * `conference.join` → `onEnterLive(name, prefs)`, which unmounts this component
 * as the React waiting room hands off to the consent/Jitsi flow.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { EMOTE_GLYPH, EMOTE_KEY, EMOTE_TYPES, mountLobby, type LobbyHandle } from '@pa-webinar/lobby';

import { EnterLiveConference, type JoinPrefs } from '@/lib/lobby/conference-adapter';
import { BrowserMediaDevices } from '@/lib/lobby/media-adapter';
import { GardenPresenceClient } from '@/lib/lobby/presence-adapter';
import { EventStatusSchedule, type AppEventStatus } from '@/lib/lobby/schedule-adapter';
import type { PonteChatPiazza } from '@/lib/lobby/chat-bridge';
import type { LobbyLocalState } from '@/lib/lobby/shared';

const WORLD = { w: 2400, h: 1600 };

/** I suoni della piazza: spenti finché non li si accende, e la scelta resta. */
const CHIAVE_SUONI = 'pawebinar.piazza.suoni';

function leggiSuoni(): boolean {
  try {
    return window.localStorage.getItem(CHIAVE_SUONI) === '1';
  } catch {
    return false;
  }
}

interface PhaserLobbyProps {
  eventSlug: string;
  /** Token della sala per le presenze della piazza (vedi garden/ping). */
  accessToken?: string;
  displayName: string;
  status: AppEventStatus;
  startsAtMs: number;
  isHost: boolean;
  onEnterLive: (name: string, prefs: JoinPrefs) => void;
  /** "Versione classica" pressed inside the lobby → switch back to the SVG UI. */
  onExitClassic: () => void;
  /**
   * The REACT shell owns identity, device choice and the "Entra" CTA, so the
   * game suppresses its own chrome (onboarding modal, top bar, device panel,
   * status badge) and entry happens by walking into the gate — which the game
   * only opens once the event is LIVE.
   *
   * È il cuore di C1: un solo insieme di controlli, in una sola lingua,
   * validato una sola volta — quelli della pagina, che nella piazza diventa la
   * colonna a fianco della scena.
   */
  hostOwnsEntry?: boolean;
  /** Falso mentre il ponte video si sta accendendo: la piazza tiene le porte
   *  chiuse e ci mette davanti il cordone, invece di aprire su una stanza che
   *  non c'e'. */
  salaPronta?: boolean;
  /** La chat dell'evento: fumetti, puntini e correzioni sopra gli avatar. */
  ponteChat?: PonteChatPiazza;
}

export default function PhaserLobby({
  eventSlug,
  accessToken = '',
  displayName,
  status,
  startsAtMs,
  isHost,
  onEnterLive,
  onExitClassic,
  hostOwnsEntry = false,
  salaPronta = true,
  ponteChat,
}: PhaserLobbyProps) {
  const tGate = useTranslations('waiting.gate');
  const tPiazza = useTranslations('waiting.piazza');
  const [suoni, setSuoni] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<LobbyHandle | null>(null);
  const scheduleRef = useRef<EventStatusSchedule | null>(null);
  const onEnterRef = useRef(onEnterLive);
  onEnterRef.current = onEnterLive;
  const onExitRef = useRef(onExitClassic);
  onExitRef.current = onExitClassic;

  // Mount once. Prop changes are pushed via the effects below (no remount).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Il contenitore riempie il proprio host (inset:0 via CSS) e basta: la
    // geometria la decide il CSS, non questo componente.
    //
    // Prima si misurava la FINESTRA (`innerHeight - top`) dando per scontato
    // che sotto ci fosse solo viewport. Da quando la piazza vive accanto ai
    // controlli e, sotto i 992px, dentro una fascia da 45vh, quel calcolo
    // costruiva un canvas alto il doppio del riquadro: la metà inferiore —
    // avatar e cancello compresi — finiva tagliata via.
    const world = WORLD;
    const shared: LobbyLocalState = {
      name: displayName.trim() || 'Ospite',
      color: '#1d6fb8',
      helmet: false,
      glasses: false,
    };
    const presence = new GardenPresenceClient(eventSlug, world, shared, accessToken);
    const conference = new EnterLiveConference(shared, (name, prefs) =>
      onEnterRef.current(name, prefs),
    );
    const schedule = new EventStatusSchedule(status, startsAtMs, isHost, salaPronta);
    scheduleRef.current = schedule;
    const media = new BrowserMediaDevices();

    const handle = mountLobby(
      el,
      {
        worldSize: world,
        embed: hostOwnsEntry,
        labels: {
          gateSign: tGate('sign'),
          zoneCafe: tGate('zoneCafe'),
          zoneBoard: tGate('zoneBoard'),
          zoneGallery: tGate('zoneGallery'),
          zoneLab: tGate('zoneLab'),
          gateOpen: tGate('gateOpen'),
          stageLive: tGate('stageLive'),
          gatePreparing: tGate('gatePreparing'),
          stagePreparing: tGate('stagePreparing'),
          ended: tGate('ended'),
          // Il segnaposto lo riempie la piazza a ogni secondo.
          startsIn: tGate('startsIn', { time: '{time}' }),
          hostEarly: tGate('hostEarly'),
        },
        initialProfile: { name: displayName.trim() },
        onExitToClassic: () => onExitRef.current(),
      },
      { presence, conference, schedule, media },
    );
    handleRef.current = handle;
    // I suoni come li si era lasciati (spenti la prima volta).
    setSuoni(handle.setAudio(leggiSuoni()));

    // The canvas was created at the fitted size; keep it fitted on resize.
    // Osserviamo il CONTENITORE, non la finestra: cambia anche quando la
    // finestra non cambia (apertura/chiusura del pannello, rotazione, barra
    // URL di iOS che si ritira).
    window.dispatchEvent(new Event('resize'));
    const boxObserver = new ResizeObserver(() => {
      window.dispatchEvent(new Event('resize'));
    });
    boxObserver.observe(el);
    const settle = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 150);

    // La chat, appena la scena è partita: prima i messaggi recenti (con la
    // loro età), poi uno per uno.
    let smontato = false;
    let scollegaChat: (() => void) | undefined;
    void handle.ready.then(() => {
      if (smontato || !ponteChat) return;
      scollegaChat = ponteChat.collega({
        messaggio: (m, eta) => handle.showChatMessage(m.nome, m.testo, eta, m.id, m.mio),
        modificato: (id, testo) => handle.editChatMessage(id, testo),
        rimosso: (id) => handle.clearChatMessage(id),
        scrittura: (nomi) => handle.setTyping(nomi),
      });
    });

    return () => {
      smontato = true;
      scollegaChat?.();
      boxObserver.disconnect();
      window.clearTimeout(settle);
      handle.destroy();
      handleRef.current = null;
      scheduleRef.current?.dispose();
      scheduleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push event-status changes (gate opens on LIVE without a refresh).
  useEffect(() => {
    scheduleRef.current?.update(status, salaPronta);
  }, [status, salaPronta]);

  // Push name edits from the React side, if any.
  useEffect(() => {
    handleRef.current?.setProfile({ name: displayName.trim() });
  }, [displayName]);

  const cambiaSuoni = () => {
    const prossimo = handleRef.current?.setAudio(!suoni) ?? false;
    setSuoni(prossimo);
    try {
      window.localStorage.setItem(CHIAVE_SUONI, prossimo ? '1' : '0');
    } catch {
      /* la scelta vale per questa visita */
    }
  };

  // Riempie l'host, che deve essere posizionato (`position: relative`) e avere
  // una dimensione propria — vedi `.wr-piazza-stage`. Due strati: la lobby
  // mette `position: relative` sul contenitore che riceve, e su quello stesso
  // nodo `inset: 0` non varrebbe più (altezza zero, tela vuota). Lo strato
  // esterno riempie la scena, il contenitore ne prende la misura.
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#26344a' }}
      />
      {/* I gesti e i suoni, in basso sulla scena: gli stessi gesti hanno un
          tasto ciascuno, scritto nel suggerimento del pulsante. Col mouse i
          pulsanti non prendono il fuoco: i tasti restano alla piazza, e
          l'avatar continua a camminare. */}
      <div className="wr-piazza-azioni" role="group" aria-label={tPiazza('actionsLabel')}>
        {EMOTE_TYPES.map((tipo) => (
          <button
            key={tipo}
            type="button"
            className="wr-piazza-azioni__gesto"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleRef.current?.emote(tipo)}
            aria-label={tPiazza(`emote.${tipo}`)}
            aria-keyshortcuts={EMOTE_KEY[tipo].toUpperCase()}
            title={`${tPiazza(`emote.${tipo}`)} (${EMOTE_KEY[tipo].toUpperCase()})`}
          >
            <span aria-hidden="true">{EMOTE_GLYPH[tipo]}</span>
          </button>
        ))}
        <span className="wr-piazza-azioni__sep" aria-hidden="true" />
        {/* Etichetta fissa e stato in aria-pressed: un'etichetta che cambia
            insieme allo stato si leggerebbe come una doppia negazione. */}
        <button
          type="button"
          className={`wr-piazza-azioni__suoni${suoni ? ' is-on' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={cambiaSuoni}
          aria-pressed={suoni}
          aria-label={tPiazza('sound')}
          title={suoni ? tPiazza('soundOn') : tPiazza('soundOff')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            {suoni ? (
              <>
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M19 5a10 10 0 0 1 0 14" />
              </>
            ) : (
              <>
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </>
            )}
          </svg>
          <span aria-hidden="true">{suoni ? tPiazza('soundOn') : tPiazza('soundOff')}</span>
        </button>
      </div>
    </div>
  );
}
