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
// A smaller world for the boxed "Mentre aspetti" embed so the camera shows
// enough context inside the ~440px-tall card instead of a tiny crop.
const EMBED_WORLD = { w: 1400, h: 1000 };

interface PhaserLobbyProps {
  eventSlug: string;
  displayName: string;
  status: AppEventStatus;
  startsAtMs: number;
  isHost: boolean;
  onEnterLive: (name: string, prefs: JoinPrefs) => void;
  /** "Versione classica" pressed inside the lobby → switch back to the SVG UI. */
  onExitClassic: () => void;
  /** Render boxed inside the waiting-room shell (no full-screen chrome /
   *  takeover; the host owns the name + "Entra" CTA). Default false. */
  embed?: boolean;
}

export default function PhaserLobby({
  eventSlug,
  displayName,
  status,
  startsAtMs,
  isHost,
  onEnterLive,
  onExitClassic,
  embed = false,
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

    // Sizing. Embed: fill the host box exactly (its `.wr-stage` sets the
    // height) and follow the box on resize. Full-screen: fill from just under
    // the app header to the bottom of the viewport. The Phaser canvas (RESIZE
    // scale mode) refits on the synthetic resize either way.
    const applyHeight = (): void => {
      if (embed) {
        el.style.height = '100%';
        return;
      }
      const top = el.getBoundingClientRect().top;
      el.style.height = `${Math.max(480, Math.round(window.innerHeight - top))}px`;
    };
    applyHeight();

    const world = embed ? EMBED_WORLD : WORLD;
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
        embed,
        initialProfile: { name: displayName.trim() },
        onExitToClassic: () => onExitRef.current(),
      },
      { presence, conference, schedule, media },
    );
    handleRef.current = handle;

    // The canvas was created at the fitted size; keep it fitted on resize.
    window.dispatchEvent(new Event('resize'));
    const onResize = (): void => applyHeight();
    // Embed follows the host box (it can resize independently of the window);
    // full-screen just tracks the window.
    let boxObserver: ResizeObserver | null = null;
    if (embed) {
      boxObserver = new ResizeObserver(() => {
        applyHeight();
        window.dispatchEvent(new Event('resize'));
      });
      boxObserver.observe(el);
    } else {
      window.addEventListener('resize', onResize);
    }
    const settle = window.setTimeout(() => {
      applyHeight();
      window.dispatchEvent(new Event('resize'));
    }, 150);

    return () => {
      if (boxObserver) boxObserver.disconnect();
      else window.removeEventListener('resize', onResize);
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

  // Embed: fill the host box (its `.wr-stage` sets the height). Full-screen:
  // the mount effect sizes this to fill the space between header and footer.
  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: embed ? '100%' : undefined,
        overflow: 'hidden',
        background: embed ? '#eaf3fb' : '#26344a',
      }}
    />
  );
}
