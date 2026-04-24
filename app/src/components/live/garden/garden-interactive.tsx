'use client';

/**
 * GardenInteractive — fase 2 of ADR-012.
 *
 * Turns the static waiting-room garden backdrop into a live presence
 * layer: every attendee gets a small avatar, can walk it around with
 * WASD / arrow keys on desktop or a touch joystick on mobile, and
 * sees the other waiting attendees moving in near-real-time.
 *
 * Movement protocol: the client ticks an animation loop via rAF at
 * 60 Hz, accumulates velocity from keyboard / joystick input, clamps
 * position to [5..95]% of the stage, and POSTs a "ping" every 200 ms
 * to `/api/events/:slug/garden/ping`. The server writes the peer to
 * Redis with a 10 s TTL and publishes on a channel; the POST response
 * also returns the full current peer list so every tick gives a
 * ~200 ms-fresh view, even without SSE. Polling + pub/sub sidestep
 * the need for a dedicated WebSocket server.
 *
 * Why not a canvas game engine: scope creep. This stays SVG so it
 * degrades gracefully (screen readers see the card above, not the
 * stage) and doesn't add a heavyweight dependency. Phaser / proper
 * engine lands later if community use justifies it (see ADR-012).
 *
 * Accessibility:
 *   - The stage itself is `aria-hidden`; all informational content
 *     (name input, netiquette, countdown, device check, CTAs) stays
 *     in the waiting-room card above at z-index 1.
 *   - `prefers-reduced-motion` stops the walk-cycle animation so the
 *     avatars translate without bobbing.
 *   - A fallback "Vista classica" toggle hides the entire interactive
 *     layer for users who prefer a static page (also good for
 *     keyboard-only users who don't want to navigate a grid).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';

import Avatar, { AVATAR_PRESETS, getAvatar, type AvatarPreset } from './avatar';

const STAGE_W = 1920;
const STAGE_H = 1080;
const AVATAR_SCALE = 2.6; // avatar viewBox is 48×64 → drawn ~125×165 in stage units
const WALK_UNITS_PER_SEC = 26; // percent of stage traversed per second
const PING_MS = 200;
const LOCAL_STORAGE_USER_ID = 'eventidtd.garden.userId';
const LOCAL_STORAGE_AVATAR = 'eventidtd.garden.avatarId';
const LOCAL_STORAGE_HIDDEN = 'eventidtd.garden.hidden';

interface Peer {
  userId: string;
  displayName: string;
  avatarId: string;
  x: number;
  y: number;
  facing: 'down' | 'up' | 'left' | 'right';
  walkPhase: number;
  updatedAt: number;
}

interface GardenInteractiveProps {
  eventSlug: string;
  /** Display name the local user picked in the waiting-room form.
   *  Empty string = user hasn't typed anything yet → avatar hidden. */
  displayName: string;
  /** When true the user opted into the garden experience; false = hidden. */
  enabled: boolean;
  /** Called when the user toggles the "Vista classica" button. */
  onToggle: (enabled: boolean) => void;
}

function makeId(): string {
  return `g_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function loadOrCreateUserId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = window.localStorage.getItem(LOCAL_STORAGE_USER_ID);
    if (!id) {
      id = makeId();
      window.localStorage.setItem(LOCAL_STORAGE_USER_ID, id);
    }
    return id;
  } catch {
    return makeId();
  }
}

function loadAvatarId(): string {
  if (typeof window === 'undefined') return AVATAR_PRESETS[0]!.id;
  try {
    return window.localStorage.getItem(LOCAL_STORAGE_AVATAR) || AVATAR_PRESETS[0]!.id;
  } catch {
    return AVATAR_PRESETS[0]!.id;
  }
}

export default function GardenInteractive({
  eventSlug,
  displayName,
  enabled,
  onToggle,
}: GardenInteractiveProps) {
  const t = useTranslations('garden');

  const [userId] = useState<string>(loadOrCreateUserId);
  const [avatarId, setAvatarId] = useState<string>(loadAvatarId);
  const [showPicker, setShowPicker] = useState(false);

  // Local position + facing, kept in a ref so the rAF loop doesn't
  // thrash state on every frame. React state is only touched on the
  // ping boundary (every 200 ms) to re-render peers.
  const localRef = useRef({
    x: 46 + Math.random() * 8,
    y: 56 + Math.random() * 6,
    facing: 'down' as Peer['facing'],
    walkPhase: 0,
  });

  // Input state — the rAF loop reads these each frame.
  const inputRef = useRef({ dx: 0, dy: 0 });
  const [peers, setPeers] = useState<Peer[]>([]);

  const selfAvatar = useMemo<AvatarPreset>(() => getAvatar(avatarId), [avatarId]);

  // ── Keyboard handling ──
  useEffect(() => {
    if (!enabled) return;
    const down = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      // Skip when typing into an input / textarea (chat preview, name, etc.)
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (target && target.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
      e.preventDefault();
      down.add(k);
      recompute();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      down.delete(e.key.toLowerCase());
      recompute();
    };
    const recompute = () => {
      let dx = 0;
      let dy = 0;
      if (down.has('w') || down.has('arrowup')) dy -= 1;
      if (down.has('s') || down.has('arrowdown')) dy += 1;
      if (down.has('a') || down.has('arrowleft')) dx -= 1;
      if (down.has('d') || down.has('arrowright')) dx += 1;
      const len = Math.hypot(dx, dy);
      if (len > 0) { dx /= len; dy /= len; }
      inputRef.current = { dx, dy };
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [enabled]);

  // ── Touch joystick handling ──
  const joystickRef = useRef<HTMLDivElement | null>(null);
  const [joystickOffset, setJoystickOffset] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const el = joystickRef.current;
    if (!el) return;

    let activeId: number | null = null;
    let originX = 0;
    let originY = 0;
    const maxRadius = 40;

    const onStart = (e: PointerEvent) => {
      if (activeId !== null) return;
      activeId = e.pointerId;
      const rect = el.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== activeId) return;
      const dx = e.clientX - originX;
      const dy = e.clientY - originY;
      const len = Math.hypot(dx, dy);
      const clampedLen = Math.min(len, maxRadius);
      const nx = len > 0 ? (dx / len) * clampedLen : 0;
      const ny = len > 0 ? (dy / len) * clampedLen : 0;
      setJoystickOffset({ x: nx, y: ny });
      // Normalised direction
      const ux = len > 0 ? dx / len : 0;
      const uy = len > 0 ? dy / len : 0;
      const intensity = clampedLen / maxRadius;
      inputRef.current = { dx: ux * intensity, dy: uy * intensity };
    };
    const onEnd = (e: PointerEvent) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      setJoystickOffset(null);
      inputRef.current = { dx: 0, dy: 0 };
    };
    el.addEventListener('pointerdown', onStart);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', onEnd);
    el.addEventListener('pointerleave', onEnd);
    return () => {
      el.removeEventListener('pointerdown', onStart);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
      el.removeEventListener('pointerleave', onEnd);
    };
  }, [enabled]);

  // ── rAF animation loop ──
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { dx, dy } = inputRef.current;
      const moving = dx !== 0 || dy !== 0;
      if (moving) {
        const step = WALK_UNITS_PER_SEC * dt;
        localRef.current.x = Math.max(5, Math.min(95, localRef.current.x + dx * step));
        localRef.current.y = Math.max(10, Math.min(95, localRef.current.y + dy * step));
        // Facing — use the dominant axis
        if (Math.abs(dx) > Math.abs(dy)) {
          localRef.current.facing = dx > 0 ? 'right' : 'left';
        } else {
          localRef.current.facing = dy > 0 ? 'down' : 'up';
        }
        localRef.current.walkPhase = (localRef.current.walkPhase + dt * 2.2) % 1;
      } else {
        localRef.current.walkPhase = 0;
      }
      // Re-render every frame so the local avatar position updates.
      // Peers only update on ping boundary (cheaper).
      forceRender((n) => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  // ── Polling ping ──
  useEffect(() => {
    if (!enabled) return;
    if (!displayName || displayName.trim().length < 2) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/events/${eventSlug}/garden/ping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            displayName: displayName.trim(),
            avatarId,
            x: localRef.current.x,
            y: localRef.current.y,
            facing: localRef.current.facing,
            walkPhase: localRef.current.walkPhase,
          }),
        });
        if (!cancelled && res.ok) {
          const j = (await res.json()) as { peers?: Peer[] };
          if (Array.isArray(j.peers)) setPeers(j.peers);
        }
      } catch {
        /* next tick will retry */
      }
    };
    void tick();
    const interval = setInterval(tick, PING_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      // Best-effort leave signal so others see us disappear sooner than the 10s TTL.
      try {
        const blob = new Blob([JSON.stringify({
          userId,
          displayName: displayName.trim() || '_',
          avatarId,
          x: localRef.current.x,
          y: localRef.current.y,
          facing: localRef.current.facing,
          walkPhase: 0,
          leave: true,
        })], { type: 'application/json' });
        navigator.sendBeacon?.(`/api/events/${eventSlug}/garden/ping`, blob);
      } catch { /* ignore */ }
    };
  }, [enabled, eventSlug, displayName, userId, avatarId]);

  // ── Avatar picker ──
  const handlePickAvatar = useCallback((id: string) => {
    setAvatarId(id);
    try { window.localStorage.setItem(LOCAL_STORAGE_AVATAR, id); } catch { /* ignore */ }
    setShowPicker(false);
  }, []);

  // Derive peers excluding self (server echoes our own ping back; filter client-side).
  const otherPeers = useMemo(
    () => peers.filter((p) => p.userId !== userId),
    [peers, userId],
  );

  if (!enabled) {
    return (
      <div className="text-center mt-3">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            try { window.localStorage.removeItem(LOCAL_STORAGE_HIDDEN); } catch { /* ignore */ }
            onToggle(true);
          }}
        >
          {t('enable')}
        </button>
      </div>
    );
  }

  const hasName = displayName.trim().length >= 2;

  return (
    <>
      {/* Avatar overlay on the garden stage — absolutely positioned,
          pointer-events none so the user can still interact with the
          card above. The local avatar is rendered only if the user
          has typed a display name (so strangers can't be pinned
          anonymously). */}
      <svg
        className="garden-avatars-layer"
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        preserveAspectRatio="xMidYMax slice"
        aria-hidden="true"
      >
        {/* Peers */}
        {otherPeers.map((p) => (
          <g
            key={p.userId}
            transform={`translate(${(p.x / 100) * STAGE_W} ${(p.y / 100) * STAGE_H}) scale(${AVATAR_SCALE})`}
          >
            <Avatar
              preset={getAvatar(p.avatarId)}
              facing={p.facing}
              walkPhase={p.walkPhase}
              label={p.displayName}
            />
          </g>
        ))}
        {/* Local avatar on top */}
        {hasName && (
          <g
            transform={`translate(${(localRef.current.x / 100) * STAGE_W} ${(localRef.current.y / 100) * STAGE_H}) scale(${AVATAR_SCALE})`}
          >
            <Avatar
              preset={selfAvatar}
              facing={localRef.current.facing}
              walkPhase={localRef.current.walkPhase}
              label={displayName.trim()}
              isSelf
            />
          </g>
        )}
      </svg>

      {/* Controls HUD: avatar badge + "vista classica" fallback + joystick (mobile).
          Kept in its own layer with pointer-events:auto so we don't block the
          card above the stage. */}
      <div className="garden-hud" aria-live="polite">
        <div className="garden-hud__left">
          <button
            type="button"
            className="garden-avatar-chip"
            onClick={() => setShowPicker(true)}
            aria-label={t('changeAvatar')}
            title={t('changeAvatar')}
          >
            <svg viewBox="0 0 48 64" width="34" height="46" aria-hidden="true">
              <Avatar preset={selfAvatar} facing="down" walkPhase={0} />
            </svg>
          </button>
          <div className="garden-hud__meta">
            <div className="garden-hud__count">
              {t('peopleInGarden', { count: otherPeers.length + (hasName ? 1 : 0) })}
            </div>
            <div className="garden-hud__hint d-none d-md-block">{t('hintKeyboard')}</div>
          </div>
        </div>

        <div className="garden-hud__right">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary garden-hud__toggle"
            onClick={() => {
              try { window.localStorage.setItem(LOCAL_STORAGE_HIDDEN, '1'); } catch { /* ignore */ }
              onToggle(false);
            }}
          >
            {t('classicView')}
          </button>
        </div>
      </div>

      {/* Mobile joystick — hidden on desktop. */}
      <div className="garden-joystick d-md-none" ref={joystickRef} aria-hidden="true">
        <div className="garden-joystick__base" />
        <div
          className="garden-joystick__thumb"
          style={{
            transform: joystickOffset
              ? `translate(calc(-50% + ${joystickOffset.x}px), calc(-50% + ${joystickOffset.y}px))`
              : 'translate(-50%, -50%)',
          }}
        />
      </div>

      {/* Avatar picker modal */}
      {showPicker && (
        <div
          className="garden-picker-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t('pickerTitle')}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPicker(false);
          }}
        >
          <div className="garden-picker">
            <div className="garden-picker__header">
              <h3 className="h6 mb-0 fw-bold">{t('pickerTitle')}</h3>
              <button
                type="button"
                className="btn btn-sm btn-close"
                aria-label={t('close')}
                onClick={() => setShowPicker(false)}
              />
            </div>
            <p className="small text-muted mb-3">{t('pickerHelp')}</p>
            <div className="garden-picker__grid">
              {AVATAR_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`garden-picker__tile${p.id === avatarId ? ' garden-picker__tile--active' : ''}`}
                  onClick={() => handlePickAvatar(p.id)}
                  aria-pressed={p.id === avatarId}
                >
                  <svg viewBox="-24 -14 48 64" width="58" height="80" aria-hidden="true">
                    <Avatar preset={p} facing="down" walkPhase={0} />
                  </svg>
                  <span className="garden-picker__label">{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
