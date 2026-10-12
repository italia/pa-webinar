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
import { EMOTE_BARRA, EMOTE_GLYPH, EMOTE_KEY, mountLobby, type LobbyHandle } from '@pa-webinar/lobby';
import { lookCasuale, normalizzaLook, type AvatarLook } from '@pa-webinar/lobby/avatar';
import type { Umore } from '@pa-webinar/lobby/umori';

import { EnterLiveConference, type JoinPrefs } from '@/lib/lobby/conference-adapter';
import { BrowserMediaDevices } from '@/lib/lobby/media-adapter';
import { GardenPresenceClient } from '@/lib/lobby/presence-adapter';
import { EventStatusSchedule, type AppEventStatus } from '@/lib/lobby/schedule-adapter';
import type { PonteChatPiazza } from '@/lib/lobby/chat-bridge';
import type { LobbyLocalState } from '@/lib/lobby/shared';

import CharacterEditor from './character-editor';
import {
  BachecaPiazza,
  GalleriaPiazza,
  LaboratorioPiazza,
  LegendaPiazza,
  type DatiBacheca,
  type MostraGalleria,
  type Presente,
} from './piazza-luoghi';

const WORLD = { w: 2400, h: 1600 };

/** I suoni della piazza: spenti finché non li si accende, e la scelta resta. */
const CHIAVE_SUONI = 'pawebinar.piazza.suoni';

/** Il personaggio scelto, solo in questo browser. */
const CHIAVE_ASPETTO = 'pawebinar.piazza.aspetto';
/** La corona si sblocca con un segreto della piazza. */
const CHIAVE_CORONA = 'pawebinar.piazza.corona';

/** L'aspetto salvato; la prima volta un personaggio a caso (salvato), così in
 *  piazza non sono tutti uguali. */
function leggiAspetto(): AvatarLook {
  try {
    const salvato = window.localStorage.getItem(CHIAVE_ASPETTO);
    if (salvato) return normalizzaLook(JSON.parse(salvato) as Partial<AvatarLook>);
  } catch {
    /* illeggibile: se ne sceglie uno nuovo */
  }
  const nuovo = lookCasuale();
  salvaAspetto(nuovo);
  return nuovo;
}

function salvaAspetto(look: AvatarLook): void {
  try {
    window.localStorage.setItem(CHIAVE_ASPETTO, JSON.stringify(look));
  } catch {
    /* vale per questa visita */
  }
}

function leggiCorona(): boolean {
  try {
    return window.localStorage.getItem(CHIAVE_CORONA) === '1';
  } catch {
    return false;
  }
}

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
  /** Quello che dice la bacheca della piazza (già tradotto). */
  bacheca?: DatiBacheca;
  /** Quello che la galleria espone: immagini dell'evento e loghi. */
  mostra?: MostraGalleria;
}

/** I luoghi della piazza e la loro azione. */
const LUOGHI = ['caffe', 'bacheca', 'galleria', 'laboratorio', 'fontana', 'pozzo'] as const;
type IdLuogo = (typeof LUOGHI)[number];
function eLuogo(id: string | null): id is IdLuogo {
  return id !== null && (LUOGHI as readonly string[]).includes(id);
}

/** Quante monete nel pozzo per trovare il segreto. */
const MONETE_SEGRETO = 3;
const CHIAVE_POZZO = 'pawebinar.piazza.pozzo';

function leggiNumero(chiave: string): number {
  try {
    return Number(window.localStorage.getItem(chiave)) || 0;
  } catch {
    return 0;
  }
}

function scrivi(chiave: string, valore: string): void {
  try {
    window.localStorage.setItem(chiave, valore);
  } catch {
    /* vale per questa visita */
  }
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
  bacheca,
  mostra,
}: PhaserLobbyProps) {
  const tGate = useTranslations('waiting.gate');
  const tPiazza = useTranslations('waiting.piazza');
  const [suoni, setSuoni] = useState(false);
  const [aspetto, setAspetto] = useState<AvatarLook>(() => leggiAspetto());
  const [corona, setCorona] = useState(() => leggiCorona());
  // Il luogo vicino al personaggio (il pulsante dell'azione) e l'ultimo
  // annuncio (una riga che compare sopra la barra, letta dai lettori di
  // schermo).
  const [luogo, setLuogo] = useState<IdLuogo | null>(null);
  const [annuncio, setAnnuncio] = useState<{ testo: string; n: number } | null>(null);
  const [presenti, setPresenti] = useState<Presente[]>([]);
  const apriEditor = useRef<(() => void) | null>(null);
  const apriBacheca = useRef<(() => void) | null>(null);
  const apriGalleria = useRef<(() => void) | null>(null);
  const apriLaboratorio = useRef<(() => void) | null>(null);
  const apriLegenda = useRef<(() => void) | null>(null);
  // L'umore detto al laboratorio (vive quanto la visita) e i conteggi.
  const [umore, setUmore] = useState<Umore | null>(null);
  const [conti, setConti] = useState<Record<Umore, number>>({ felice: 0, curioso: 0, assonnato: 0, carico: 0 });
  const eseguiRef = useRef<(id: IdLuogo) => void>(() => undefined);
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
        initialProfile: { name: displayName.trim(), look: aspetto },
        onExitToClassic: () => onExitRef.current(),
        onLuogo: (id) => setLuogo(eLuogo(id) ? id : null),
        onInteragisci: (id) => {
          if (eLuogo(id)) eseguiRef.current(id);
        },
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

  const annuncia = (testo: string) => setAnnuncio((a) => ({ testo, n: (a?.n ?? 0) + 1 }));
  // L'annuncio resta qualche secondo, poi sparisce.
  useEffect(() => {
    if (!annuncio) return;
    const timer = window.setTimeout(() => setAnnuncio(null), 4500);
    return () => window.clearTimeout(timer);
  }, [annuncio]);

  /** L'azione di un luogo: una finestra, o un effetto nella piazza. */
  const esegui = (id: IdLuogo) => {
    const handle = handleRef.current;
    switch (id) {
      case 'bacheca':
        apriBacheca.current?.();
        return;
      case 'galleria':
        apriGalleria.current?.();
        return;
      case 'laboratorio':
        apriLaboratorio.current?.();
        return;
      case 'caffe':
        handle?.azione('caffe');
        annuncia(tPiazza('annunci.caffe'));
        return;
      case 'fontana':
        handle?.azione('fontana');
        annuncia(tPiazza('annunci.fontana'));
        return;
      case 'pozzo': {
        handle?.azione('pozzo');
        const monete = leggiNumero(CHIAVE_POZZO) + 1;
        scrivi(CHIAVE_POZZO, String(monete));
        if (monete >= MONETE_SEGRETO && !corona) {
          // Il segreto: la corona, per il personaggio.
          scrivi(CHIAVE_CORONA, '1');
          setCorona(true);
          window.setTimeout(() => handleRef.current?.festa(), 700);
          annuncia(tPiazza('annunci.corona'));
        } else {
          annuncia(tPiazza('annunci.pozzo'));
        }
        return;
      }
    }
  };
  eseguiRef.current = esegui;

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
      {/* Vicino a un luogo: il pulsante della sua azione (anche col tasto
          Invio), e sopra gli annunci di quello che è successo. */}
      <div className="wr-piazza-luogo">
        <p className="wr-piazza-luogo__annuncio" role="status" aria-live="polite">
          {annuncio && <span key={annuncio.n}>{annuncio.testo}</span>}
        </p>
        {luogo && (
          <button
            type="button"
            className="wr-piazza-luogo__azione"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => esegui(luogo)}
            aria-keyshortcuts="Enter"
          >
            <span>{tPiazza(`luoghi.${luogo}`)}</span>
            <kbd aria-hidden="true">↵</kbd>
          </button>
        )}
      </div>
      {bacheca && <BachecaPiazza dati={bacheca} slug={eventSlug} token={accessToken || undefined} apriRef={apriBacheca} />}
      <GalleriaPiazza
        presenti={presenti}
        mostra={mostra}
        aggiorna={() => setPresenti(handleRef.current?.presenti() ?? [])}
        apriRef={apriGalleria}
      />
      <LaboratorioPiazza
        umore={umore}
        conti={conti}
        aggiorna={() => {
          const c = handleRef.current?.umori();
          if (c) setConti(c);
        }}
        onUmore={(u) => {
          setUmore(u);
          handleRef.current?.setProfile({ umore: u });
          // Il proprio voto conta subito, senza aspettare il giro dei ping.
          window.setTimeout(() => {
            const c = handleRef.current?.umori();
            if (c) setConti(c);
          }, 50);
        }}
        onPersonaggio={() => apriEditor.current?.()}
        apriRef={apriLaboratorio}
      />
      <LegendaPiazza apriRef={apriLegenda} />
      {/* I gesti e i suoni, in basso sulla scena: gli stessi gesti hanno un
          tasto ciascuno, scritto nel suggerimento del pulsante. Col mouse i
          pulsanti non prendono il fuoco: i tasti restano alla piazza, e
          l'avatar continua a camminare. */}
      <div className="wr-piazza-azioni" role="group" aria-label={tPiazza('actionsLabel')}>
        {EMOTE_BARRA.map((tipo) => (
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
        <CharacterEditor
          look={aspetto}
          coronaSbloccata={corona}
          apriRef={apriEditor}
          onChange={(look) => {
            setAspetto(look);
            salvaAspetto(look);
            handleRef.current?.setProfile({ look });
          }}
        />
        <button
          type="button"
          className="wr-piazza-azioni__personaggio"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apriLegenda.current?.()}
          aria-haspopup="dialog"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
          </svg>
          <span>{tPiazza('legenda.open')}</span>
        </button>
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
