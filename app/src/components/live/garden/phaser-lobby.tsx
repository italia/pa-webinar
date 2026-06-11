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
}

export default function PhaserLobby({
  eventSlug,
  displayName,
  status,
  startsAtMs,
  isHost,
  onEnterLive,
  onExitClassic,
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

    // Fill the space between the app header and footer (no white gap) while
    // staying INSIDE the page chrome. The container's own height is computed
    // from the viewport minus its offset and the footer; the Phaser canvas
    // (RESIZE scale mode) follows on the synthetic resize.
    const applyHeight = (): void => {
      const top = el.getBoundingClientRect().top;
      // Fill from just under the app header to the bottom of the viewport — a
      // large game area with no white gap. The app's (tall) footer sits just
      // below the fold; scrolling reveals it. Keeps the app chrome, no takeover.
      el.style.height = `${Math.max(480, Math.round(window.innerHeight - top))}px`;
    };
    applyHeight();

    const shared: LobbyLocalState = {
      name: displayName.trim() || 'Ospite',
      color: '#1d6fb8',
      helmet: false,
      glasses: false,
    };
    const presence = new GardenPresenceClient(eventSlug, WORLD, shared);
    const conference = new EnterLiveConference(shared, (name, prefs) =>
      onEnterRef.current(name, prefs),
    );
    const schedule = new EventStatusSchedule(status, startsAtMs, isHost);
    scheduleRef.current = schedule;
    const media = new BrowserMediaDevices();

    const handle = mountLobby(
      el,
      {
        worldSize: WORLD,
        initialProfile: { name: displayName.trim() },
        onExitToClassic: () => onExitRef.current(),
      },
      { presence, conference, schedule, media },
    );
    handleRef.current = handle;

    // The canvas was created at the fitted size; keep it fitted on resize.
    window.dispatchEvent(new Event('resize'));
    const onResize = (): void => applyHeight();
    window.addEventListener('resize', onResize);
    const settle = window.setTimeout(() => {
      applyHeight();
      window.dispatchEvent(new Event('resize'));
    }, 150);

    return () => {
      window.removeEventListener('resize', onResize);
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

  // Rendered INSIDE the page (header + footer stay visible); the mount effect
  // sizes this to fill the space between them, so there's no white gap.
  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', overflow: 'hidden', background: '#26344a' }}
    />
  );
}
