import type { CSSProperties } from 'react';

import type { IconSize } from '@/components/ui/icon';

/**
 * Le poche icone che il foglio di sprite di .italia non ha (riproduzione,
 * pausa, microfono), disegnate inline.
 *
 * Portano le stesse classi di `Icon` (`icon`, `icon-<misura>`,
 * `icon-<colore>`), quindi hanno la stessa misura e lo stesso colore di
 * un'icona dello sprite accanto. Un nome che lo sprite non contiene, passato
 * a `Icon`, disegna un riquadro vuoto: per questo lo sprite si usa solo con
 * nomi che esistono (lo verifica `sprite-icons.test.ts`) e il resto sta qui.
 */
const GLIFI = {
  play: 'M8 5v14l11-7Z',
  pause: 'M6.5 5h4v14h-4Zm7 0h4v14h-4Z',
  microphone:
    'M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 1 0-7 0v6A3.5 3.5 0 0 0 12 15Zm6-3.5a.75.75 0 0 0-1.5 0 4.5 4.5 0 0 1-9 0 .75.75 0 0 0-1.5 0 6 6 0 0 0 5.25 5.95V20H9a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5h-2.25v-2.55A6 6 0 0 0 18 11.5Z',
} as const;

export type Glifo = keyof typeof GLIFI;

export interface GlyphIconProps {
  glyph: Glifo;
  size?: IconSize | '';
  /** Colore del design system: diventa la classe `icon-<colore>`. */
  color?: string;
  className?: string;
  style?: CSSProperties;
}

/** Icona decorativa: accanto c'e' sempre un'etichetta o un `aria-label`. */
export function GlyphIcon({ glyph, size = '', color = '', className, style }: GlyphIconProps) {
  const classi = ['icon', className, color ? `icon-${color}` : '', size ? `icon-${size}` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <svg
      className={classi}
      style={style}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      <path d={GLIFI[glyph]} />
    </svg>
  );
}

export default GlyphIcon;
