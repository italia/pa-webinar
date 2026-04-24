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
        {/* Morning sky — caffettino is an 8:45 event */}
        <linearGradient id="gsSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#BCE0FF" />
          <stop offset="0.55" stopColor="#FFE9CF" />
          <stop offset="1" stopColor="#FFD8B8" />
        </linearGradient>
        <radialGradient id="gsSun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFF4B0" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#FFE185" stopOpacity="0.35" />
          <stop offset="1" stopColor="#FFE185" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gsGrassFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9FC98A" />
          <stop offset="1" stopColor="#7FB06A" />
        </linearGradient>
        <linearGradient id="gsGrassNear" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7CAE66" />
          <stop offset="1" stopColor="#578C45" />
        </linearGradient>
        <radialGradient id="gsFountainWater" cx="0.5" cy="1" r="0.9">
          <stop offset="0" stopColor="#A6DCF7" />
          <stop offset="1" stopColor="#6BB1DD" />
        </radialGradient>
        <filter id="gsSoft" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>

      {/* Sky + sun */}
      <rect x="0" y="0" width="1920" height="1080" fill="url(#gsSky)" />
      <circle cx="1580" cy="220" r="160" fill="url(#gsSun)" className="garden-sun" />

      {/* Distant hill silhouettes */}
      <path
        d="M0 620 Q 300 520 600 580 T 1200 560 T 1920 600 V 720 H 0 Z"
        fill="#88B78D"
        opacity="0.75"
      />
      <path
        d="M0 680 Q 400 590 820 640 T 1500 620 T 1920 660 V 780 H 0 Z"
        fill="#7AA97F"
        opacity="0.9"
      />

      {/* Far grass band */}
      <rect x="0" y="720" width="1920" height="140" fill="url(#gsGrassFar)" />

      {/* Stone path meandering into the distance */}
      <path
        d="M860 1080 Q 900 940 1020 870 Q 1180 800 1240 760 Q 1300 730 1360 720"
        stroke="#E9DDC5"
        strokeWidth="90"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M860 1080 Q 900 940 1020 870 Q 1180 800 1240 760 Q 1300 730 1360 720"
        stroke="#D2C3A1"
        strokeWidth="4"
        fill="none"
        strokeDasharray="14 18"
      />

      {/* Near grass band */}
      <rect x="0" y="820" width="1920" height="260" fill="url(#gsGrassNear)" />

      {/* ── Trees in the background ── */}
      <g className="garden-tree garden-tree--1">
        <rect x="240" y="640" width="22" height="110" fill="#6B4423" />
        <circle cx="251" cy="620" r="70" fill="#4E8D48" />
        <circle cx="210" cy="640" r="54" fill="#55A052" />
        <circle cx="290" cy="640" r="54" fill="#55A052" />
        <circle cx="251" cy="600" r="52" fill="#65B35F" />
      </g>
      <g className="garden-tree garden-tree--2">
        <rect x="1660" y="640" width="22" height="110" fill="#6B4423" />
        <circle cx="1671" cy="620" r="70" fill="#4E8D48" />
        <circle cx="1630" cy="640" r="54" fill="#55A052" />
        <circle cx="1710" cy="640" r="54" fill="#55A052" />
      </g>
      <g className="garden-tree garden-tree--3">
        <rect x="460" y="680" width="18" height="90" fill="#6B4423" />
        <circle cx="469" cy="660" r="54" fill="#5BA255" />
        <circle cx="440" cy="680" r="42" fill="#64B15E" />
        <circle cx="498" cy="680" r="42" fill="#64B15E" />
      </g>

      {/* ── Bushes ── */}
      <g>
        <ellipse cx="80" cy="910" rx="110" ry="40" fill="#4E8D48" />
        <ellipse cx="1830" cy="920" rx="120" ry="44" fill="#4E8D48" />
        <ellipse cx="700" cy="900" rx="80" ry="30" fill="#5BA255" />
        <ellipse cx="1200" cy="900" rx="90" ry="32" fill="#5BA255" />
      </g>

      {/* ── Fountain, centre ── */}
      <g transform="translate(960 860)">
        {/* Base */}
        <ellipse cx="0" cy="60" rx="160" ry="40" fill="#B3A088" />
        <ellipse cx="0" cy="48" rx="150" ry="32" fill="#C9B7A1" />
        {/* Water basin */}
        <ellipse cx="0" cy="40" rx="140" ry="26" fill="url(#gsFountainWater)" />
        <ellipse cx="0" cy="38" rx="140" ry="22" fill="#EAF6FE" opacity="0.5" />
        {/* Centre column */}
        <rect x="-14" y="-80" width="28" height="120" fill="#B3A088" />
        <ellipse cx="0" cy="-84" rx="32" ry="10" fill="#D2C3A1" />
        {/* Water jet — animated */}
        <g className="garden-fountain-jet" filter="url(#gsSoft)">
          <ellipse cx="0" cy="-130" rx="10" ry="34" fill="#CFEAFA" opacity="0.75" />
          <ellipse cx="0" cy="-160" rx="14" ry="18" fill="#CFEAFA" opacity="0.55" />
          <ellipse cx="0" cy="-180" rx="18" ry="10" fill="#CFEAFA" opacity="0.35" />
        </g>
        {/* Side water drops */}
        <g className="garden-fountain-drops">
          <circle cx="-22" cy="-40" r="3" fill="#A6DCF7" />
          <circle cx="-44" cy="-20" r="3" fill="#A6DCF7" />
          <circle cx="22" cy="-40" r="3" fill="#A6DCF7" />
          <circle cx="44" cy="-20" r="3" fill="#A6DCF7" />
        </g>
      </g>

      {/* ── Coffee kiosk, right ── */}
      <g transform="translate(1440 780)">
        {/* Awning */}
        <polygon points="-140,30 140,30 120,0 -120,0" fill="#C8392E" />
        <polygon points="-140,30 140,30 120,0 -120,0" fill="url(#gsSky)" opacity="0.08" />
        {/* Stripe */}
        <rect x="-140" y="28" width="280" height="6" fill="#F4E4D1" />
        {/* Counter */}
        <rect x="-120" y="36" width="240" height="170" rx="8" fill="#E9DDC5" />
        <rect x="-120" y="36" width="240" height="28" fill="#D2C3A1" />
        {/* Coffee cup icon on counter */}
        <g transform="translate(0 108)">
          <rect x="-36" y="-18" width="72" height="40" rx="6" fill="#fff" stroke="#5A4029" strokeWidth="3" />
          <path d="M36 -8 Q 56 -4 56 10 Q 56 20 42 20" fill="none" stroke="#5A4029" strokeWidth="3" />
          <rect x="-28" y="-12" width="56" height="8" fill="#6B4423" />
        </g>
        {/* Espresso label */}
        <text
          x="0"
          y="180"
          textAnchor="middle"
          fontFamily="Titillium Web, Helvetica Neue, Arial, sans-serif"
          fontSize="22"
          fontWeight="700"
          fill="#5A4029"
          letterSpacing="2"
        >
          CAFFÈ
        </text>
        {/* Steam wisps from cup */}
        <g className="garden-steam" opacity="0.7">
          <path d="M-14 80 Q -6 60 -14 40 Q -20 22 -10 6" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M0 80 Q 6 60 -2 40 Q -8 22 2 6" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M14 80 Q 20 60 12 40 Q 6 22 14 6" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      </g>

      {/* ── DJ booth, left ── */}
      <g transform="translate(360 880)">
        {/* Booth */}
        <rect x="-90" y="0" width="180" height="110" rx="8" fill="#355D7A" />
        <rect x="-90" y="0" width="180" height="20" fill="#2A4A61" />
        {/* Turntable */}
        <circle cx="-40" cy="60" r="26" fill="#1F2A33" />
        <circle cx="-40" cy="60" r="8" fill="#F4E4D1" />
        <circle cx="40" cy="60" r="26" fill="#1F2A33" />
        <circle cx="40" cy="60" r="8" fill="#F4E4D1" />
        {/* Speaker left + right */}
        <rect x="-170" y="20" width="50" height="90" fill="#2A4A61" />
        <circle cx="-145" cy="50" r="16" fill="#1F2A33" />
        <circle cx="-145" cy="90" r="10" fill="#1F2A33" />
        <rect x="120" y="20" width="50" height="90" fill="#2A4A61" />
        <circle cx="145" cy="50" r="16" fill="#1F2A33" />
        <circle cx="145" cy="90" r="10" fill="#1F2A33" />
        {/* Music notes rising — animated */}
        <g className="garden-music-notes" fill="#355D7A">
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
        {/* Back rest */}
        <rect x="-120" y="-28" width="240" height="8" rx="2" fill="#7A5434" />
        <rect x="-110" y="-28" width="4" height="22" fill="#5A4029" />
        <rect x="106" y="-28" width="4" height="22" fill="#5A4029" />
      </g>
    </svg>
  );
}
