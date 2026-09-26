import type { CSSProperties, SVGProps } from 'react';

/**
 * Icona del design system .italia, disegnata dal foglio di sprite servito
 * dall'applicazione stessa (`/svg/sprites.svg`, copiato da bootstrap-italia
 * all'installazione e nell'immagine).
 *
 * Sostituisce `<Icon>` di design-react-kit, che carica ogni icona in modo
 * asincrono dentro una cache di modulo: il server la trova piena, il browser
 * al primo disegno la trova vuota, e React tiene il segnaposto vuoto invece di
 * correggerlo. Il risultato erano icone che comparivano o sparivano a ogni
 * ricarica. Qui non c'e' niente da caricare: l'`<use>` e' identico sui due
 * lati e il file di sprite lo scarica il browser una volta sola.
 *
 * L'interfaccia ricalca quella di design-react-kit (`icon`, `size`, `color`,
 * `title`, `padding`) perche' il cambio resti un cambio di import.
 */
export type IconSize = 'xs' | 'sm' | 'lg' | 'xl';

export interface IconProps
  extends Omit<SVGProps<SVGSVGElement>, 'color' | 'ref' | 'children'> {
  /** Nome dello sprite (`it-video`) oppure l'indirizzo di un'immagine. */
  icon: string;
  size?: IconSize | '';
  /** Colore del design system: diventa la classe `icon-<colore>`. */
  color?: string;
  /**
   * Testo alternativo. Vuoto (il caso normale) vuol dire icona decorativa:
   * fuori dalla lettura assistita, perche' accanto c'e' sempre un'etichetta.
   */
  title?: string;
  padding?: boolean;
  className?: string;
  style?: CSSProperties;
}

const SPRITE = '/svg/sprites.svg';

export function Icon({
  icon,
  size = '',
  color = '',
  title = '',
  padding = false,
  className,
  ...resto
}: IconProps) {
  const classi = [
    'icon',
    className,
    color ? `icon-${color}` : '',
    size ? `icon-${size}` : '',
    padding ? 'icon-padded' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Un nome che non e' dello sprite e' un'immagine: stesso comportamento del
  // componente che questo sostituisce, usato dai modelli di evento.
  if (!icon.startsWith('it-')) {
    const { style } = resto;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} className={classi} alt={title} style={style} />;
  }

  const decorativa = title === '';
  return (
    <svg
      {...resto}
      className={classi}
      aria-hidden={decorativa ? true : undefined}
      role={decorativa ? undefined : 'img'}
      focusable="false"
    >
      {!decorativa && <title>{title}</title>}
      <use href={`${SPRITE}#${icon}`} />
    </svg>
  );
}

export default Icon;
