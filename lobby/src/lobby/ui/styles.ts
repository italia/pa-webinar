/**
 * All lobby UI CSS, injected once by LobbyGame and scoped under `.pawl`.
 * Kept as a string so the module ships no external stylesheet and the host
 * can't accidentally clash with it.
 */
export const LOBBY_CSS = `
.pawl, .pawl * { box-sizing: border-box; }
.pawl {
  position: absolute; inset: 0; pointer-events: none;
  font-family: 'Titillium Web', system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  color: #17324d;
  --accent: #0066CC;
  --accent-2: #008758;
  /* Light .italia glass — white panels with a soft navy hairline, to sit on
     the pastel piazza (was a dark glassmorphism for the old dark map). */
  --panel: rgba(255, 255, 255, 0.92);
  --panel-border: rgba(23, 50, 77, 0.12);
  --soft: #f4f7fb;
  --muted: #5b6f82;
  --shadow: 0 8px 26px rgba(0, 64, 128, 0.16);
}
.pawl button { font-family: inherit; cursor: pointer; }
.pawl ::selection { background: rgba(0,102,204,0.18); }

/* ── top status badge ── */
.pawl-badge {
  position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px;
  padding: 8px 16px; border-radius: 999px;
  background: var(--panel); border: 1px solid var(--panel-border);
  backdrop-filter: blur(8px); pointer-events: auto;
  box-shadow: var(--shadow);
}
.pawl-badge__dot { width: 10px; height: 10px; border-radius: 50%; background: #aebfce; }
.pawl-badge--scheduled .pawl-badge__dot { background: var(--accent); }
.pawl-badge--live .pawl-badge__dot { background: #D9364F; box-shadow: 0 0 0 0 rgba(217,54,79,0.7); animation: pawl-pulse 1.6s infinite; }
.pawl-badge--ended .pawl-badge__dot { background: #9aa6b4; }
.pawl-badge__text { font-weight: 700; letter-spacing: .3px; font-size: 14px; }
.pawl-badge__count { font-size: 12px; color: var(--muted); padding-left: 8px; border-left: 1px solid rgba(23,50,77,.15); }
@keyframes pawl-pulse { 0%{box-shadow:0 0 0 0 rgba(217,54,79,.6)} 70%{box-shadow:0 0 0 9px rgba(217,54,79,0)} 100%{box-shadow:0 0 0 0 rgba(217,54,79,0)} }

/* ── personalization dock (bottom-left) ── */
.pawl-dock {
  position: absolute; left: 14px; bottom: 14px;
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px; width: 264px; max-width: calc(100vw - 28px);
  background: var(--panel); border: 1px solid var(--panel-border);
  border-radius: 14px; backdrop-filter: blur(8px); pointer-events: auto;
  box-shadow: var(--shadow);
}
.pawl-dock__row { display: flex; align-items: center; gap: 8px; }
.pawl-dock__label { font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); }
.pawl-input {
  flex: 1; min-width: 0; padding: 8px 10px; border-radius: 9px;
  background: var(--soft); border: 1px solid var(--panel-border);
  color: #17324d; font-size: 14px; outline: none;
}
.pawl-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(0,102,204,.14); }
.pawl-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
.pawl-swatch { width: 24px; height: 24px; border-radius: 7px; border: 2px solid transparent; padding: 0; }
.pawl-swatch--active { border-color: #fff; box-shadow: 0 0 0 2px var(--accent); }
.pawl-toggle {
  display: flex; align-items: center; gap: 6px; font-size: 13px;
  padding: 6px 10px; border-radius: 8px; border: 1px solid var(--panel-border);
  background: var(--soft); color: #17324d;
}
.pawl-toggle--on { background: rgba(0,102,204,0.1); border-color: var(--accent); color: #0066cc; }

/* ── config-at-the-gate panel (right) ── */
.pawl-config {
  position: absolute; top: 50%; right: 14px; transform: translateY(-50%);
  width: 320px; max-width: calc(100vw - 28px);
  padding: 16px; background: var(--panel); border: 1px solid var(--panel-border);
  border-radius: 16px; backdrop-filter: blur(10px); pointer-events: auto;
  box-shadow: var(--shadow);
  opacity: 0; transform: translateY(-50%) translateX(16px); transition: opacity .22s, transform .22s;
}
.pawl-config--open { opacity: 1; transform: translateY(-50%) translateX(0); }
.pawl-config__title { font-weight: 700; font-size: 15px; margin: 0 0 10px; display:flex; align-items:center; gap:8px; }
.pawl-config__preview {
  position: relative; width: 100%; aspect-ratio: 16/10; border-radius: 10px; overflow: hidden;
  background: #0a0f1a; border: 1px solid var(--panel-border); margin-bottom: 10px;
  display: flex; align-items: center; justify-content: center;
}
.pawl-config__preview video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
.pawl-config__novideo { font-size: 12px; opacity: .6; text-align:center; padding: 0 12px; }
.pawl-vu { position: absolute; left: 8px; right: 8px; bottom: 8px; height: 6px; border-radius: 4px; background: rgba(255,255,255,.15); overflow: hidden; }
.pawl-vu__fill { height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent-2), var(--accent)); transition: width .08s linear; }
.pawl-config__field { margin-bottom: 8px; }
.pawl-config__field label { font-size: 11px; opacity: .7; display:block; margin-bottom: 3px; }
.pawl-select {
  width: 100%; padding: 7px 9px; border-radius: 8px; font-size: 13px;
  background: var(--soft); border: 1px solid var(--panel-border); color: #17324d;
}
.pawl-config__toggles { display: flex; gap: 8px; margin: 6px 0 12px; }
.pawl-btn {
  width: 100%; padding: 11px; border-radius: 10px; border: 0; font-weight: 700; font-size: 15px;
  background: linear-gradient(180deg, #1a7fe0, #0059b3); color: #ffffff;
  transition: filter .15s, opacity .15s;
}
.pawl-btn:hover { filter: brightness(1.06); }
.pawl-btn:disabled { background: #aebfce; color: #ffffff; cursor: not-allowed; }
.pawl-config__note { font-size: 11px; color: var(--muted); text-align: center; margin-top: 8px; }

/* ── onboarding overlay ── */
.pawl-onb {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(6, 12, 22, 0.62); backdrop-filter: blur(3px);
  /* Closed = click-through (pointer-events none) so the invisible overlay never
     blocks the dock / config / personalization underneath. Only the OPEN modal
     captures clicks. */
  pointer-events: none; opacity: 0; transition: opacity .2s; z-index: 10;
}
.pawl-onb--open { opacity: 1; pointer-events: auto; }
.pawl-onb__card {
  width: min(440px, calc(100vw - 32px)); padding: 22px;
  background: var(--panel); border: 1px solid var(--panel-border);
  border-radius: 18px; box-shadow: var(--shadow); text-align: center;
}
.pawl-onb__title { font-size: 20px; font-weight: 800; margin: 4px 0 6px; }
.pawl-onb__sub { font-size: 14px; opacity: .8; margin: 0 0 16px; }
.pawl-keys { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; text-align: left; }
.pawl-key { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.pawl-key kbd {
  font-family: ui-monospace, monospace; font-size: 12px; min-width: 22px; text-align:center;
  padding: 3px 6px; border-radius: 6px; background: #e8f1fb; color: #17324d;
  border: 1px solid #c3d4e6; box-shadow: 0 2px 0 rgba(23,50,77,.12);
}
.pawl-onb__btn {
  padding: 10px 22px; border-radius: 10px; border: 0; font-weight: 700; font-size: 15px;
  background: linear-gradient(180deg, #1a7fe0, #0059b3); color: #ffffff;
}
.pawl-info {
  position: absolute; right: 14px; top: 14px; width: 38px; height: 38px; border-radius: 50%;
  background: var(--panel); border: 1px solid var(--panel-border); color: #0066cc;
  font-weight: 800; font-size: 17px; pointer-events: auto; backdrop-filter: blur(8px);
  box-shadow: var(--shadow);
}
.pawl-info:hover { border-color: var(--accent); }

/* ── mobile joystick ── */
.pawl-joy {
  position: absolute; left: 18px; bottom: 150px; width: 116px; height: 116px;
  border-radius: 50%; pointer-events: auto; touch-action: none;
  background: rgba(16,24,38,0.5); border: 1px solid var(--panel-border);
}
.pawl-joy__thumb {
  position: absolute; left: 50%; top: 50%; width: 48px; height: 48px; border-radius: 50%;
  background: rgba(0,102,204,0.55); border: 2px solid #cdeffb; transform: translate(-50%,-50%);
}
@media (hover: hover) and (pointer: fine) { .pawl-joy { display: none; } }

/* ── top bar (Entra / classica / audio / help) ── */
.pawl-topbar {
  position: absolute; top: 12px; right: 14px; display: flex; gap: 8px; align-items: center;
  flex-wrap: wrap; justify-content: flex-end; max-width: calc(100vw - 28px); pointer-events: none;
}
.pawl-top-btn {
  pointer-events: auto; font-family: inherit; font-size: 13px; font-weight: 700; color: #17324d;
  padding: 9px 14px; border-radius: 999px; border: 1px solid var(--panel-border);
  background: var(--panel); backdrop-filter: blur(8px); box-shadow: var(--shadow);
  transition: filter .15s, border-color .15s; cursor: pointer;
}
.pawl-top-btn:hover { filter: brightness(1.1); border-color: var(--accent); }
.pawl-top-btn--primary {
  background: linear-gradient(180deg, #1a7fe0, #0059b3); color: #ffffff; border: 0;
  box-shadow: 0 6px 20px rgba(0,102,204,.35);
}
.pawl-top-btn--icon { width: 40px; height: 40px; padding: 0; font-size: 17px; }
.pawl-top-btn--muted { opacity: .65; }

/* ── onboarding name field ── */
.pawl-onb__label { display: block; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; opacity: .7; margin: 4px 2px 4px; }
.pawl-onb__name {
  width: 100%; padding: 12px 14px; border-radius: 11px; border: 1px solid var(--panel-border);
  background: var(--soft); color: #17324d; font-size: 16px; outline: none; margin-bottom: 14px;
}
.pawl-onb__name:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(0,102,204,.2); }
.pawl-onb__hint { font-size: 11px; opacity: .6; margin: 12px 0 0; }
`;
