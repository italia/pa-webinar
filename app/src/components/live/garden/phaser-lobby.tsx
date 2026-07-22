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
import { useEffect, useRef } from 'react';

import { mountLobby, type LobbyHandle } from '@pa-webinar/lobby';

import { EnterLiveConference, type JoinPrefs } from '@/lib/lobby/conference-adapter';
import { BrowserMediaDevices } from '@/lib/lobby/media-adapter';
import { GardenPresenceClient } from '@/lib/lobby/presence-adapter';
import { EventStatusSchedule, type AppEventStatus } from '@/lib/lobby/schedule-adapter';
import type { LobbyLocalState } from '@/lib/lobby/shared';

const WORLD = { w: 2400, h: 1600 };

interface PhaserLobbyProps {
  eventSlug: string;
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
}

export default function PhaserLobby({
  eventSlug,
  displayName,
  status,
  startsAtMs,
  isHost,
  onEnterLive,
  onExitClassic,
  hostOwnsEntry = false,
}: PhaserLobbyProps) {
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
    const presence = new GardenPresenceClient(eventSlug, world, shared);
    const conference = new EnterLiveConference(shared, (name, prefs) =>
      onEnterRef.current(name, prefs),
    );
    const schedule = new EventStatusSchedule(status, startsAtMs, isHost);
    scheduleRef.current = schedule;
    const media = new BrowserMediaDevices();

    const handle = mountLobby(
      el,
      {
        worldSize: world,
        embed: hostOwnsEntry,
        initialProfile: { name: displayName.trim() },
        onExitToClassic: () => onExitRef.current(),
      },
      { presence, conference, schedule, media },
    );
    handleRef.current = handle;

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

    return () => {
      boxObserver.disconnect();
      window.clearTimeout(settle);
      handle.destroy();
      handleRef.current = null;
      scheduleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push event-status changes (gate opens on LIVE without a refresh).
  useEffect(() => {
    scheduleRef.current?.update(status);
  }, [status]);

  // Push name edits from the React side, if any.
  useEffect(() => {
    handleRef.current?.setProfile({ name: displayName.trim() });
  }, [displayName]);

  // Riempie l'host, che deve essere posizionato (`position: relative`) e avere
  // una dimensione propria — vedi `.wr-piazza-stage`.
  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#26344a' }}
    />
  );
}
