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
const LOCAL_STORAGE_HINT_DISMISSED = 'eventidtd.garden.hintDismissed';

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
  // First-time hint banner. Dismissed permanently once the user moves
  // (auto) or clicks the close button (manual). Persists across reloads
  // so returning users don't see it again.
  const [showHint, setShowHint] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem(LOCAL_STORAGE_HINT_DISMISSED) !== '1'; }
    catch { return true; }
  });
  const dismissHint = useCallback(() => {
    setShowHint(false);
    try { window.localStorage.setItem(LOCAL_STORAGE_HINT_DISMISSED, '1'); }
    catch { /* ignore */ }
  }, []);

  // Local position + facing, kept in a ref so the rAF loop doesn't
  // thrash state on every frame. React state is only touched on the
  // ping boundary (every 200 ms) to re-render peers.
  // Spawn in the foreground band (near the fountain / path) so the
  // avatar starts OUTSIDE the central card's collision rect on every
  // viewport. Spawning at y=56..62% (the previous default) put the
  // avatar inside the card on most desktop layouts → collision then
  // blocked every move because each step stayed inside the obstacle.
  const localRef = useRef({
    x: 46 + Math.random() * 8,
    y: 88 + Math.random() * 4,
    facing: 'up' as Peer['facing'],
    walkPhase: 0,
  });

  // Input state — the rAF loop reads these each frame.
  const inputRef = useRef({ dx: 0, dy: 0 });
  // Mirrored ref for showHint so the rAF loop can read it without
  // triggering a closure refresh on every state change.
  const showHintRef = useRef(false);
  useEffect(() => { showHintRef.current = showHint; }, [showHint]);
  // Obstacle rect in viewBox-percent coords (0..100). Computed from the
  // central waiting-room card via DOM measurement; null when there's no
  // card yet (e.g. SSR or transient layouts). The rAF loop uses this
  // for axis-by-axis collision so the avatar can't walk through the
  // card — it has to walk around it.
  const obstacleRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);

  const selfAvatar = useMemo<AvatarPreset>(() => getAvatar(avatarId), [avatarId]);

  // ── Card collision: measure the waiting-room card and project its
  //   bounding rect into avatar viewBox-percent coords. The garden SVG
  //   uses preserveAspectRatio="xMidYMax slice" — the same transform
  //   we apply here to stay consistent. Recomputed on resize and when
  //   the card layout shifts (image loads, content reflow). ──
  useEffect(() => {
    if (!enabled) return;
    const compute = () => {
      const stage = document.querySelector<HTMLElement>('.waiting-garden-bg');
      const card = document.querySelector<HTMLElement>('.waiting-card');
      if (!stage || !card) {
        obstacleRectRef.current = null;
        return;
      }
      const sRect = stage.getBoundingClientRect();
      const cRect = card.getBoundingClientRect();
      if (sRect.width <= 0 || sRect.height <= 0) return;
      // Replicate xMidYMax slice math: scale = max so the SVG fills the
      // container with one axis cropped; horizontal anchor = center,
      // vertical anchor = bottom.
      const scale = Math.max(sRect.width / STAGE_W, sRect.height / STAGE_H);
      const stageOffsetX = (sRect.width - STAGE_W * scale) / 2;
      const stageOffsetY = sRect.height - STAGE_H * scale;
      const localX = cRect.left - sRect.left;
      const localY = cRect.top - sRect.top;
      const vbX = (localX - stageOffsetX) / scale;
      const vbY = (localY - stageOffsetY) / scale;
      const obs = {
        x: (vbX / STAGE_W) * 100,
        y: (vbY / STAGE_H) * 100,
        w: (cRect.width / scale / STAGE_W) * 100,
        h: (cRect.height / scale / STAGE_H) * 100,
      };
      obstacleRectRef.current = obs;
      // Safety: if the avatar is currently inside the obstacle (e.g.
      // because the card grew on resize, or the layout settled
      // post-spawn so the card now covers the spawn point) push it
      // out to the nearest free edge. Without this, the per-frame
      // collision check would lock the avatar in place forever.
      const HX = 3.0;
      const HY = 7.5;
      const px = localRef.current.x;
      const py = localRef.current.y;
      const insideX = px + HX > obs.x && px - HX < obs.x + obs.w;
      const insideY = py > obs.y - HY && py - HY < obs.y + obs.h;
      if (insideX && insideY) {
        const distLeft = (px + HX) - obs.x;
        const distRight = (obs.x + obs.w) - (px - HX);
        const distUp = py - (obs.y - HY);
        const distDown = (obs.y + obs.h) - (py - HY);
        const minDist = Math.min(distLeft, distRight, distUp, distDown);
        if (minDist === distDown) {
          localRef.current.y = Math.min(95, obs.y + obs.h + HY + 0.5);
        } else if (minDist === distUp) {
          localRef.current.y = Math.max(10, obs.y - HY - 0.5);
        } else if (minDist === distLeft) {
          localRef.current.x = Math.max(5, obs.x - HX - 0.5);
        } else {
          localRef.current.x = Math.min(95, obs.x + obs.w + HX + 0.5);
        }
      }
    };
    compute();
    const ro = new ResizeObserver(compute);
    const stageEl = document.querySelector('.waiting-garden-bg');
    const cardEl = document.querySelector('.waiting-card');
    if (stageEl) ro.observe(stageEl);
    if (cardEl) ro.observe(cardEl);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [enabled]);

  // ── Keyboard handling ──
  // Movement keys behave differently depending on the focused element:
  //   - Arrow keys: ALWAYS hijacked for avatar movement. If the user is
  //     focused in a form input, we blur it so subsequent keys keep
  //     moving the avatar instead of being eaten by the input. This is
  //     the fix for the demo finding ("nessuno riusciva a muovere il
  //     personaggio") — the form auto-focuses the name input on mount
  //     and the previous handler bailed before reaching `recompute`.
  //   - WASD: only when focus is NOT on an input — otherwise W/A/S/D
  //     are letters the user is typing.
  useEffect(() => {
    if (!enabled) return;
    const down = new Set<string>();
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
        // Don't intercept WASD while the user is typing — those are letters.
        if (!isArrow) return;
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
    // Use document with capture so we receive arrow events before the
    // focused input's default cursor-navigation handling kicks in.
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
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
        // Auto-dismiss the first-time hint as soon as the user actually
        // moves — they figured it out, no need to keep nagging.
        if (showHintRef.current) {
          showHintRef.current = false;
          setShowHint(false);
          try { window.localStorage.setItem(LOCAL_STORAGE_HINT_DISMISSED, '1'); }
          catch { /* ignore */ }
        }
        const step = WALK_UNITS_PER_SEC * dt;
        const nextX = Math.max(5, Math.min(95, localRef.current.x + dx * step));
        const nextY = Math.max(10, Math.min(95, localRef.current.y + dy * step));
        // Axis-by-axis collide against the central card. Updating x and
        // y separately lets the avatar slide along the card's edges
        // instead of getting fully stopped on diagonal approaches.
        // Avatar half-extents are stage-percent approximations of the
        // rendered avatar footprint (~125×165 px in stage units → ~3%
        // of width, ~5% of height). The hit box is centred on the
        // avatar's feet (its drawn pivot), shifted up half-height so
        // the collision feels right when walking against the front
        // face of the card.
        const obs = obstacleRectRef.current;
        const HX = 3.0;
        const HY = 7.5;
        const intersects = (px: number, py: number) =>
          !!obs &&
          px + HX > obs.x &&
          px - HX < obs.x + obs.w &&
          py > obs.y - HY &&
          py - HY < obs.y + obs.h;
        let resolvedX = nextX;
        let resolvedY = nextY;
        if (intersects(nextX, localRef.current.y)) resolvedX = localRef.current.x;
        if (intersects(resolvedX, nextY)) resolvedY = localRef.current.y;
        localRef.current.x = resolvedX;
        localRef.current.y = resolvedY;
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
    // Render the re-enable affordance as a HUD chip in the same
    // top-right slot the active garden uses for "Vista classica" — so
    // toggling is symmetric and the button is always discoverable.
    // The previous implementation rendered a btn-sm in document flow
    // at the top of the page where users couldn't find it after
    // hiding the garden once.
    return (
      <div className="garden-hud garden-hud--disabled" aria-live="polite">
        <div className="garden-hud__right">
          <button
            type="button"
            className="btn btn-sm garden-hud__toggle"
            onClick={() => {
              try { window.localStorage.removeItem(LOCAL_STORAGE_HIDDEN); } catch { /* ignore */ }
              onToggle(true);
            }}
          >
            {t('enable')}
          </button>
        </div>
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
        <div className="garden-joystick__label" aria-hidden="true">{t('hintJoystick')}</div>
      </div>

      {/* First-time discovery hint. Floats above the stage, dismisses
          itself the moment the user actually moves. The whole point is
          discoverability — the demo found that even users who knew the
          controls failed to use them because the form input ate the
          keystrokes. The banner is the visible signal that something
          interactive lives here. */}
      {showHint && hasName && (
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
