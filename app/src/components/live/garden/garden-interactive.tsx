'use client';

/**
 * GardenInteractive — fase 2 of ADR-012, full-screen "arcade" redesign.
 *
 * The waiting room is a full-screen 2D park where the attendee's avatar
 * is the protagonist: it is present and walkable the moment the page
 * loads (no name required — a default "guest" identity is used until the
 * user types a name in the dock), can be moved with WASD / arrow keys on
 * desktop or a touch joystick on mobile, and shows the other waiting
 * attendees moving in near-real-time.
 *
 * Movement protocol: the client ticks an animation loop via rAF at
 * 60 Hz, accumulates velocity from keyboard / joystick input, clamps
 * position to the visible play area, and POSTs a "ping" every 200 ms
 * to `/api/events/:slug/garden/ping`. The server writes the peer to
 * Redis with a 10 s TTL and publishes on a channel; the POST response
 * also returns the full current peer list so every tick gives a
 * ~200 ms-fresh view, even without SSE.
 *
 * Layout integration (see waiting-room.tsx):
 *   - This component is mounted inside `.arcade-stage`, which fills the
 *     viewport. The functional UI (name, countdown, "Entra ora", chat,
 *     netiquette…) lives in `.arcade-topbar` / `.arcade-dock` / a
 *     `.arcade-drawer` that float over the stage. The avatar play area
 *     is clamped vertically so the character never disappears behind
 *     those overlays (see the bounds effect).
 *
 * Accessibility:
 *   - The stage SVG is `aria-hidden`; all informational content stays in
 *     the dock/drawer above with real semantics. A "Vista classica"
 *     toggle (owned by WaitingRoom) swaps the whole experience for a
 *     static scrollable card for users who prefer no movement.
 *   - `prefers-reduced-motion` stops the walk-cycle bobbing.
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
const LOCAL_STORAGE_USER_ID = 'pawebinar.garden.userId';
const LOCAL_STORAGE_AVATAR = 'pawebinar.garden.avatarId';
const LOCAL_STORAGE_HINT_DISMISSED = 'pawebinar.garden.hintDismissed';

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
  /** Display name the local user picked in the dock. Empty string =
   *  user hasn't typed anything yet → a localized "guest" label is used
   *  so the avatar is still present and walkable. */
  displayName: string;
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

export default function GardenInteractive({
  eventSlug,
  displayName,
}: GardenInteractiveProps) {
  const t = useTranslations('garden');

  const [userId] = useState<string>(loadOrCreateUserId);
  // avatarId / showHint start at SSR-safe defaults and are hydrated from
  // localStorage in the mount effect below, so the server and first client
  // render agree (no hydration mismatch).
  const [avatarId, setAvatarId] = useState<string>(AVATAR_PRESETS[0]!.id);
  const [showPicker, setShowPicker] = useState(false);
  const [showHint, setShowHint] = useState(false);
  // The local avatar spawns at a random position, which would differ
  // between server and client render. Render it only after mount so SSR
  // never emits a position the client has to reconcile.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    try {
      const storedAvatar = window.localStorage.getItem(LOCAL_STORAGE_AVATAR);
      if (storedAvatar) setAvatarId(storedAvatar);
      setShowHint(window.localStorage.getItem(LOCAL_STORAGE_HINT_DISMISSED) !== '1');
    } catch {
      setShowHint(true);
    }
  }, []);
  const dismissHint = useCallback(() => {
    setShowHint(false);
    try { window.localStorage.setItem(LOCAL_STORAGE_HINT_DISMISSED, '1'); }
    catch { /* ignore */ }
  }, []);

  // Default identity shown until the user types a name in the dock.
  const guestLabel = t('guestName');
  const effectiveName = displayName.trim() || guestLabel;

  // Local position + facing, kept in a ref so the rAF loop doesn't
  // thrash state on every frame. React state is only touched on the
  // ping boundary (every 200 ms) to re-render peers. Spawn near the
  // centre of the visible stage so the character is immediately the
  // protagonist on screen.
  const localRef = useRef({
    x: 44 + Math.random() * 12,
    y: 50 + Math.random() * 8,
    facing: 'down' as Peer['facing'],
    walkPhase: 0,
  });

  // Input state — the rAF loop reads these each frame.
  const inputRef = useRef({ dx: 0, dy: 0 });
  // Mirrored ref for showHint so the rAF loop can read it without
  // triggering a closure refresh on every state change.
  const showHintRef = useRef(false);
  useEffect(() => { showHintRef.current = showHint; }, [showHint]);

  // Vertical play bounds (stage-percent). The topbar caps the top and
  // the dock caps the bottom so the avatar never walks behind the
  // floating overlays. Recomputed on resize.
  const boundsRef = useRef<{ minY: number; maxY: number }>({ minY: 8, maxY: 90 });
  const [peers, setPeers] = useState<Peer[]>([]);

  const selfAvatar = useMemo<AvatarPreset>(() => getAvatar(avatarId), [avatarId]);

  // ── Play-area bounds: project the topbar/dock screen rects into
  //   the avatars SVG viewBox-percent space (same viewBox +
  //   preserveAspectRatio="xMidYMax slice" as the stage). ──
  useEffect(() => {
    const compute = () => {
      const stage = document.querySelector<HTMLElement>('.garden-avatars-layer');
      if (!stage) return;
      const s = stage.getBoundingClientRect();
      if (s.width <= 0 || s.height <= 0) return;
      // Replicate xMidYMax slice: scale = max so the SVG fills the box
      // with one axis cropped; vertical anchor = bottom.
      const scale = Math.max(s.width / STAGE_W, s.height / STAGE_H);
      const offsetY = s.height - STAGE_H * scale;
      const projectY = (clientY: number) => {
        const localY = clientY - s.top;
        const vbY = (localY - offsetY) / scale;
        return Math.max(0, Math.min(100, (vbY / STAGE_H) * 100));
      };
      const topbar = document.querySelector<HTMLElement>('.arcade-topbar');
      const dock = document.querySelector<HTMLElement>('.arcade-dock');
      // Avatar half-height (feet pivot) is ~7% of stage height; add a
      // little breathing room so the label stays clear of the overlays.
      const MARGIN = 8;
      let minY = 6;
      let maxY = 92;
      if (topbar) minY = projectY(topbar.getBoundingClientRect().bottom) + MARGIN;
      if (dock) maxY = projectY(dock.getBoundingClientRect().top) - 2;
      if (maxY - minY < 12) maxY = Math.min(96, minY + 12); // safety
      boundsRef.current = { minY, maxY };
      // Keep the avatar inside the freshly-measured band.
      localRef.current.y = Math.max(minY, Math.min(maxY, localRef.current.y));
    };
    // Defer one frame so the dock/topbar have laid out.
    const raf = requestAnimationFrame(compute);
    const ro = new ResizeObserver(compute);
    const stageEl = document.querySelector('.arcade-stage');
    if (stageEl) ro.observe(stageEl);
    window.addEventListener('resize', compute);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, []);

  // ── Keyboard handling ──
  // Arrow keys are ALWAYS hijacked for movement; if focus is in a form
  // input we blur it so subsequent keys keep moving the avatar instead
  // of being eaten by the input. WASD only moves when focus is NOT on an
  // input (otherwise they're letters the user is typing).
  useEffect(() => {
    const down = new Set<string>();
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
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const isArrow = k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright';
      const isWasd = k === 'w' || k === 'a' || k === 's' || k === 'd';
      if (!isArrow && !isWasd) return;
      const target = e.target as HTMLElement | null;
      const isInputLike = !!target && (
        /^(input|textarea|select)$/i.test(target.tagName) ||
        target.isContentEditable
      );
      if (isInputLike) {
        if (!isArrow) return; // don't steal WASD letters while typing
        target!.blur();
      }
      e.preventDefault();
      down.add(k);
      recompute();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      down.delete(e.key.toLowerCase());
      recompute();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  // ── Touch joystick handling ──
  const joystickRef = useRef<HTMLDivElement | null>(null);
  const [joystickOffset, setJoystickOffset] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
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
  }, []);

  // ── rAF animation loop ──
  const [, forceRender] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { dx, dy } = inputRef.current;
      const moving = dx !== 0 || dy !== 0;
      if (moving) {
        // Auto-dismiss the first-time hint as soon as the user moves.
        if (showHintRef.current) {
          showHintRef.current = false;
          setShowHint(false);
          try { window.localStorage.setItem(LOCAL_STORAGE_HINT_DISMISSED, '1'); }
          catch { /* ignore */ }
        }
        const step = WALK_UNITS_PER_SEC * dt;
        const { minY, maxY } = boundsRef.current;
        localRef.current.x = Math.max(5, Math.min(95, localRef.current.x + dx * step));
        localRef.current.y = Math.max(minY, Math.min(maxY, localRef.current.y + dy * step));
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
      forceRender((n) => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Polling ping ── always pings (using the guest label until the
  //   user types a name) so presence works from the first second.
  useEffect(() => {
    let cancelled = false;
    const name = displayName.trim() || guestLabel;
    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/events/${eventSlug}/garden/ping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            displayName: name,
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
      try {
        const blob = new Blob([JSON.stringify({
          userId,
          displayName: name,
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
  }, [eventSlug, displayName, userId, avatarId, guestLabel]);

  // ── Avatar picker ──
  const handlePickAvatar = useCallback((id: string) => {
    setAvatarId(id);
    try { window.localStorage.setItem(LOCAL_STORAGE_AVATAR, id); } catch { /* ignore */ }
    setShowPicker(false);
  }, []);

  // Derive peers excluding self (server echoes our own ping back).
  const otherPeers = useMemo(
    () => peers.filter((p) => p.userId !== userId),
    [peers, userId],
  );

  return (
    <>
      {/* Avatar overlay on the garden stage — absolutely positioned,
          pointer-events none so the controls above still work. The local
          avatar is always rendered (guest identity until a name). */}
      <svg
        className="garden-avatars-layer"
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        preserveAspectRatio="xMidYMax slice"
        aria-hidden="true"
      >
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
        {/* Local avatar on top — client-only (random spawn) */}
        {mounted && (
          <g
            transform={`translate(${(localRef.current.x / 100) * STAGE_W} ${(localRef.current.y / 100) * STAGE_H}) scale(${AVATAR_SCALE})`}
          >
            <Avatar
              preset={selfAvatar}
              facing={localRef.current.facing}
              walkPhase={localRef.current.walkPhase}
              label={effectiveName}
              isSelf
            />
          </g>
        )}
      </svg>

      {/* Controls HUD: avatar badge + people count + keyboard hint. */}
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
              {t('peopleInGarden', { count: otherPeers.length + 1 })}
            </div>
            <div className="garden-hud__hint d-none d-md-block">{t('hintKeyboard')}</div>
          </div>
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
        <div className="garden-joystick__label" aria-hidden="true">{t('hintJoystick')}</div>
      </div>

      {/* First-time discovery hint. Floats above the stage, dismisses
          itself the moment the user actually moves. */}
      {showHint && (
        <div className="garden-hint" role="status" aria-live="polite">
          <div className="garden-hint__keys" aria-hidden="true">
            <span className="garden-hint__key">←</span>
            <span className="garden-hint__key">↑</span>
            <span className="garden-hint__key">↓</span>
            <span className="garden-hint__key">→</span>
          </div>
          <div className="garden-hint__text">{t('hintBanner')}</div>
          <button
            type="button"
            className="garden-hint__close"
            onClick={dismissHint}
            aria-label={t('close')}
            title={t('close')}
          >
            ×
          </button>
        </div>
      )}

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
