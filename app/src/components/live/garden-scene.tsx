'use client';

/**
 * GardenScene
 *
 * Decorative SVG backdrop for the waiting room — an Italian-garden
 * scene with a coffee kiosk, a fountain, a little DJ booth and a
 * wooden bench. Pure SVG + CSS animations, no JS runtime, zero
 * dependencies. Scales to any viewport via
 * `preserveAspectRatio="xMidYMax slice"` so the foreground (bench,
 * kiosk) always sits at the bottom of the frame on any aspect ratio.
 *
 * Accessibility
 *   - The entire scene is decorative (`role="presentation"` +
 *     `aria-hidden`). Screen readers ignore it; the waiting room's
 *     existing card above it (cover, name, countdown, netiquette,
 *     DeviceCheck, chat preview) remains the authoritative content.
 *   - Animations respect `prefers-reduced-motion` and stop for users
 *     who opted out of motion in their OS.
 *
 * Why SVG and not Canvas / Phaser: the current scope is "a garden",
 * not a multiplayer pokemon game (that's ADR-012 fase 2). A single
 * inline SVG with keyframes is trivial to deploy, trivial to style
 * with Bootstrap Italia colours, and doesn't add an iframe or WS
 * server. If/when movement and proximity chat land, this component
 * stays as the background layer beneath the game canvas.
 */

export default function GardenScene() {
  return (
    <svg
      className="garden-scene"
      viewBox="0 0 1920 1080"
      preserveAspectRatio="xMidYMax slice"
      role="presentation"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* .italia palette: soft cool-to-warm morning, primary #0066CC
         *  as accent, success #008758 on the foliage, coral #D9364F for
         *  the coffee kiosk awning, ink #17324D for contrast. */}
        <linearGradient id="gsSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E6F0FA" />
          <stop offset="0.55" stopColor="#F5F7FB" />
          <stop offset="1" stopColor="#FDEDE0" />
        </linearGradient>
        <radialGradient id="gsSun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFE0B0" stopOpacity="0.9" />
          <stop offset="0.55" stopColor="#F7A11A" stopOpacity="0.25" />
          <stop offset="1" stopColor="#F7A11A" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gsGrassFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7DB891" />
          <stop offset="1" stopColor="#4FA377" />
        </linearGradient>
        <linearGradient id="gsGrassNear" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4FA377" />
          <stop offset="1" stopColor="#2B8F60" />
        </linearGradient>
        <radialGradient id="gsFountainWater" cx="0.5" cy="1" r="0.9">
          <stop offset="0" stopColor="#8EC5E6" />
          <stop offset="1" stopColor="#0066CC" />
        </radialGradient>
        <filter id="gsSoft" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>

      {/* Sky + sun */}
      <rect x="0" y="0" width="1920" height="1080" fill="url(#gsSky)" />
      <circle cx="1580" cy="220" r="160" fill="url(#gsSun)" className="garden-sun" />

      {/* Distant hill silhouettes — .italia success green lineage */}
      <path
        d="M0 620 Q 300 520 600 580 T 1200 560 T 1920 600 V 720 H 0 Z"
        fill="#6EB39A"
        opacity="0.8"
      />
      <path
        d="M0 680 Q 400 590 820 640 T 1500 620 T 1920 660 V 780 H 0 Z"
        fill="#4FA377"
        opacity="0.9"
      />

      {/* Far grass band */}
      <rect x="0" y="720" width="1920" height="140" fill="url(#gsGrassFar)" />

      {/* Stone path — .italia surface grey, muted dashed centre line */}
      <path
        d="M860 1080 Q 900 940 1020 870 Q 1180 800 1240 760 Q 1300 730 1360 720"
        stroke="#F5F7FB"
        strokeWidth="90"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M860 1080 Q 900 940 1020 870 Q 1180 800 1240 760 Q 1300 730 1360 720"
        stroke="#C9D4DE"
        strokeWidth="4"
        fill="none"
        strokeDasharray="14 18"
      />

      {/* Near grass band */}
      <rect x="0" y="820" width="1920" height="260" fill="url(#gsGrassNear)" />

      {/* ── Trees in the background — layered .italia greens ── */}
      <g className="garden-tree garden-tree--1">
        <rect x="240" y="640" width="22" height="110" fill="#5A4029" />
        <circle cx="251" cy="620" r="70" fill="#2B8F60" />
        <circle cx="210" cy="640" r="54" fill="#4FA377" />
        <circle cx="290" cy="640" r="54" fill="#4FA377" />
        <circle cx="251" cy="600" r="52" fill="#6EB39A" />
      </g>
      <g className="garden-tree garden-tree--2">
        <rect x="1660" y="640" width="22" height="110" fill="#5A4029" />
        <circle cx="1671" cy="620" r="70" fill="#2B8F60" />
        <circle cx="1630" cy="640" r="54" fill="#4FA377" />
        <circle cx="1710" cy="640" r="54" fill="#4FA377" />
      </g>
      <g className="garden-tree garden-tree--3">
        <rect x="460" y="680" width="18" height="90" fill="#5A4029" />
        <circle cx="469" cy="660" r="54" fill="#4FA377" />
        <circle cx="440" cy="680" r="42" fill="#6EB39A" />
        <circle cx="498" cy="680" r="42" fill="#6EB39A" />
      </g>

      {/* ── Bushes ── */}
      <g>
        <ellipse cx="80" cy="910" rx="110" ry="40" fill="#2B8F60" />
        <ellipse cx="1830" cy="920" rx="120" ry="44" fill="#2B8F60" />
        <ellipse cx="700" cy="900" rx="80" ry="30" fill="#4FA377" />
        <ellipse cx="1200" cy="900" rx="90" ry="32" fill="#4FA377" />
      </g>

      {/* ── Fountain, centre — stone basin + .italia primary blue water ── */}
      <g transform="translate(960 860)">
        <ellipse cx="0" cy="60" rx="160" ry="40" fill="#B3BCC7" />
        <ellipse cx="0" cy="48" rx="150" ry="32" fill="#C9D4DE" />
        <ellipse cx="0" cy="40" rx="140" ry="26" fill="url(#gsFountainWater)" />
        <ellipse cx="0" cy="38" rx="140" ry="22" fill="#E6F0FA" opacity="0.45" />
        <rect x="-14" y="-80" width="28" height="120" fill="#B3BCC7" />
        <ellipse cx="0" cy="-84" rx="32" ry="10" fill="#C9D4DE" />
        <g className="garden-fountain-jet" filter="url(#gsSoft)">
          <ellipse cx="0" cy="-130" rx="10" ry="34" fill="#B8D9F0" opacity="0.75" />
          <ellipse cx="0" cy="-160" rx="14" ry="18" fill="#B8D9F0" opacity="0.55" />
          <ellipse cx="0" cy="-180" rx="18" ry="10" fill="#B8D9F0" opacity="0.35" />
        </g>
        <g className="garden-fountain-drops">
          <circle cx="-22" cy="-40" r="3" fill="#0066CC" />
          <circle cx="-44" cy="-20" r="3" fill="#0066CC" />
          <circle cx="22" cy="-40" r="3" fill="#0066CC" />
          <circle cx="44" cy="-20" r="3" fill="#0066CC" />
        </g>
      </g>

      {/* ── Coffee kiosk, right — coral awning (Italia danger #D9364F) ── */}
      <g transform="translate(1440 780)">
        <polygon points="-140,30 140,30 120,0 -120,0" fill="#D9364F" />
        <polygon points="-140,30 140,30 120,0 -120,0" fill="url(#gsSky)" opacity="0.1" />
        <rect x="-140" y="28" width="280" height="6" fill="#F5F7FB" />
        <rect x="-120" y="36" width="240" height="170" rx="8" fill="#F5F7FB" />
        <rect x="-120" y="36" width="240" height="28" fill="#E1E8EF" />
        <g transform="translate(0 108)">
          <rect x="-36" y="-18" width="72" height="40" rx="6" fill="#fff" stroke="#17324D" strokeWidth="3" />
          <path d="M36 -8 Q 56 -4 56 10 Q 56 20 42 20" fill="none" stroke="#17324D" strokeWidth="3" />
          <rect x="-28" y="-12" width="56" height="8" fill="#5A4029" />
        </g>
        <text
          x="0"
          y="180"
          textAnchor="middle"
          fontFamily="Titillium Web, Helvetica Neue, Arial, sans-serif"
          fontSize="22"
          fontWeight="700"
          fill="#17324D"
          letterSpacing="2"
        >
          CAFFÈ
        </text>
        <g className="garden-steam" opacity="0.8">
          <path d="M-14 80 Q -6 60 -14 40 Q -20 22 -10 6" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M0 80 Q 6 60 -2 40 Q -8 22 2 6" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M14 80 Q 20 60 12 40 Q 6 22 14 6" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      </g>

      {/* ── DJ booth, left — ink body (.italia #17324D) + primary blue accents ── */}
      <g transform="translate(360 880)">
        <rect x="-90" y="0" width="180" height="110" rx="8" fill="#17324D" />
        <rect x="-90" y="0" width="180" height="20" fill="#0066CC" />
        <circle cx="-40" cy="60" r="26" fill="#0A1A30" />
        <circle cx="-40" cy="60" r="8" fill="#F7A11A" />
        <circle cx="40" cy="60" r="26" fill="#0A1A30" />
        <circle cx="40" cy="60" r="8" fill="#F7A11A" />
        <rect x="-170" y="20" width="50" height="90" fill="#17324D" />
        <circle cx="-145" cy="50" r="16" fill="#0A1A30" />
        <circle cx="-145" cy="90" r="10" fill="#0A1A30" />
        <rect x="120" y="20" width="50" height="90" fill="#17324D" />
        <circle cx="145" cy="50" r="16" fill="#0A1A30" />
        <circle cx="145" cy="90" r="10" fill="#0A1A30" />
        <g className="garden-music-notes" fill="#0066CC">
          <g className="garden-music-notes__1">
            <text x="-30" y="-20" fontSize="26" fontFamily="sans-serif">♪</text>
          </g>
          <g className="garden-music-notes__2">
            <text x="15" y="-10" fontSize="22" fontFamily="sans-serif">♫</text>
          </g>
          <g className="garden-music-notes__3">
            <text x="45" y="-25" fontSize="28" fontFamily="sans-serif">♩</text>
          </g>
        </g>
      </g>

      {/* ── Bench in the foreground ── */}
      <g transform="translate(780 950)">
        <rect x="-120" y="-6" width="240" height="14" rx="3" fill="#7A5434" />
        <rect x="-120" y="12" width="240" height="6" fill="#5A4029" opacity="0.5" />
        <rect x="-110" y="14" width="10" height="40" fill="#5A4029" />
        <rect x="100" y="14" width="10" height="40" fill="#5A4029" />
        <rect x="-120" y="-28" width="240" height="8" rx="2" fill="#7A5434" />
        <rect x="-110" y="-28" width="4" height="22" fill="#5A4029" />
        <rect x="106" y="-28" width="4" height="22" fill="#5A4029" />
      </g>
    </svg>
  );
}
