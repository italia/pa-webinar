/**
 * Waiting-room garden avatars — 6 flat-illustration presets aligned
 * with the .italia design system palette (primary #0066CC, success
 * #008758, coral #D9364F, accent orange #F7A11A, ink #17324D).
 *
 * Deliberately genderless geometry: round head + trapezoidal body +
 * rectangular legs. Differentiation is colour + hair silhouette only,
 * so the 6 presets feel like a small but inclusive "character
 * selector" without encoding gender or ethnicity in any strong way.
 * No preset is flagged as "maschio" / "femmina" — the user picks on
 * vibe.
 *
 * Each avatar renders inside its own 48×64 viewBox; the caller passes
 * absolute x,y on the outer SVG stage and this component positions the
 * group with a transform.
 */

export interface AvatarPreset {
  id: string;
  label: string;
  // Palette
  skin: string;
  hair: string;
  shirt: string;
  trousers: string;
  accent: string;
  // Silhouette variant: 'short' (close-cropped), 'curly', 'long'
  hairStyle: 'short' | 'curly' | 'long' | 'hat';
}

// NOTE: these colours are consumed as SVG *presentation attributes*
// (`fill={preset.shirt}`), NOT CSS properties. CSS custom properties
// (`var(--app-*)`) are only resolved inside CSS declarations — a browser
// treats `fill="var(--app-primary)"` as an invalid attribute value and
// falls back to the default fill (black), so the avatars rendered as
// black blobs. Keep literal hex here. The values mirror the design
// tokens: --app-primary #0066CC, --app-text #17324D, --app-muted #5A768A.
export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'a1', label: 'Azzurro', skin: '#F4C89B', hair: '#2E2219', hairStyle: 'short',
    shirt: '#0066CC', trousers: '#17324D', accent: '#F7A11A' },
  { id: 'a2', label: 'Corallo', skin: '#D4A373', hair: '#3A2419', hairStyle: 'curly',
    shirt: '#D9364F', trousers: '#17324D', accent: '#F4E4D1' },
  { id: 'a3', label: 'Verde',   skin: '#E8C199', hair: '#4A2E1A', hairStyle: 'long',
    shirt: '#008758', trousers: '#3A5472', accent: '#F7A11A' },
  { id: 'a4', label: 'Arancio', skin: '#A67B5B', hair: '#1A0E07', hairStyle: 'short',
    shirt: '#F7A11A', trousers: '#17324D', accent: '#0066CC' },
  { id: 'a5', label: 'Viola',   skin: '#F4C89B', hair: '#6B4423', hairStyle: 'hat',
    shirt: '#7B5AAE', trousers: '#3A5472', accent: '#F4E4D1' },
  { id: 'a6', label: 'Notte',   skin: '#6F4E37', hair: '#0F0804', hairStyle: 'curly',
    shirt: '#17324D', trousers: '#5A768A', accent: '#F7A11A' },
];

export function getAvatar(id: string | undefined | null): AvatarPreset {
  return AVATAR_PRESETS.find((p) => p.id === id) ?? AVATAR_PRESETS[0]!;
}

interface AvatarProps {
  preset: AvatarPreset;
  /** Facing direction changes the eye position + arm slightly. */
  facing?: 'down' | 'up' | 'left' | 'right';
  /** Walk cycle phase 0..1; caller animates. Idle = 0. */
  walkPhase?: number;
  /** Optional display-name label under the feet. */
  label?: string;
  /** Dim when the avatar is the local one (optional styling hint). */
  isSelf?: boolean;
}

/**
 * Single avatar, rendered inside its own viewBox. Width 48 / height 64
 * gives enough room for a label under the feet. The owning scene
 * wraps this in a `<g transform="translate(x y)">` to position it on
 * the garden stage.
 */
export default function Avatar({
  preset,
  facing = 'down',
  walkPhase = 0,
  label,
  isSelf = false,
}: AvatarProps) {
  const legSwing = Math.sin(walkPhase * Math.PI * 2) * 3;
  const bodyBob = Math.abs(Math.sin(walkPhase * Math.PI * 2)) * 1.2;

  // Eye x-offset per direction (left/right peek; up/down centred).
  const eyeDx = facing === 'left' ? -1 : facing === 'right' ? 1 : 0;

  return (
    <g aria-hidden="true">
      {/* Shadow under the feet */}
      <ellipse cx="0" cy="42" rx="12" ry="3" fill="#17324D" opacity="0.22" />

      {/* Legs (swing in opposite phase) */}
      <g transform={`translate(0 ${-bodyBob})`}>
        <rect
          x="-7"
          y="26"
          width="6"
          height="14"
          rx="1"
          fill={preset.trousers}
          transform={`translate(0 0) rotate(${legSwing} -4 26)`}
        />
        <rect
          x="1"
          y="26"
          width="6"
          height="14"
          rx="1"
          fill={preset.trousers}
          transform={`rotate(${-legSwing} 4 26)`}
        />

        {/* Shirt — trapezoid-ish via path */}
        <path
          d="M -10 10 L 10 10 L 12 28 L -12 28 Z"
          fill={preset.shirt}
        />
        {/* Collar highlight */}
        <path d="M -6 10 L 6 10 L 4 13 L -4 13 Z" fill={preset.accent} opacity="0.85" />

        {/* Arms */}
        <rect x="-14" y="12" width="5" height="14" rx="2" fill={preset.shirt} />
        <rect x="9" y="12" width="5" height="14" rx="2" fill={preset.shirt} />
        {/* Hands */}
        <circle cx="-11.5" cy="26" r="2.3" fill={preset.skin} />
        <circle cx="11.5" cy="26" r="2.3" fill={preset.skin} />

        {/* Head */}
        <circle cx="0" cy="2" r="8.5" fill={preset.skin} />

        {/* Hair silhouette */}
        {preset.hairStyle === 'short' && (
          <path d="M -8.5 -1 Q 0 -11 8.5 -1 L 8 2 Q 0 -4 -8 2 Z" fill={preset.hair} />
        )}
        {preset.hairStyle === 'curly' && (
          <g fill={preset.hair}>
            <circle cx="-7" cy="-3" r="3.2" />
            <circle cx="-3" cy="-6" r="3.2" />
            <circle cx="2" cy="-7" r="3.2" />
            <circle cx="7" cy="-5" r="3" />
            <circle cx="8" cy="-1" r="2.4" />
          </g>
        )}
        {preset.hairStyle === 'long' && (
          <path
            d="M -9 -2 Q -10 -12 0 -11 Q 10 -12 9 -2 L 10 8 Q 7 12 4 10 L 4 2 Q 0 -3 -4 2 L -4 10 Q -7 12 -10 8 Z"
            fill={preset.hair}
          />
        )}
        {preset.hairStyle === 'hat' && (
          <g>
            <rect x="-10" y="-4" width="20" height="3" rx="1" fill={preset.hair} />
            <path d="M -7 -4 L 7 -4 L 5 -11 L -5 -11 Z" fill={preset.hair} />
            <rect x="-6" y="-5" width="12" height="1.5" fill={preset.accent} />
          </g>
        )}

        {/* Eyes */}
        {facing !== 'up' && (
          <>
            <circle cx={-2.5 + eyeDx} cy="2.5" r="1" fill="#17324D" />
            <circle cx={2.5 + eyeDx} cy="2.5" r="1" fill="#17324D" />
          </>
        )}

        {/* Selection ring */}
        {isSelf && (
          <circle cx="0" cy="30" r="18" fill="none" stroke="#0066CC" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.55" />
        )}
      </g>

      {/* Name label */}
      {label && (
        <g transform="translate(0 54)">
          <rect x="-32" y="-9" width="64" height="14" rx="4" fill="#17324D" opacity="0.85" />
          <text
            x="0"
            y="1"
            textAnchor="middle"
            fontFamily="Titillium Web, Helvetica Neue, Arial, sans-serif"
            fontSize="9"
            fontWeight="600"
            fill="#fff"
          >
            {label.length > 14 ? `${label.slice(0, 13)}…` : label}
          </text>
        </g>
      )}
    </g>
  );
}
