/**
 * Icona decorativa dal foglio di sprite del design system.
 *
 * Si rende l'`<use>` inline invece del contenitore `<Icon>` di
 * design-react-kit: la home e' la pagina piu' vista del sito, e quel
 * contenitore lato client ha gia' prodotto disallineamenti fra quello che il
 * server disegna e quello che il browser si aspetta. L'`<use>` resta
 * interamente sul server ed e' la forma canonica di .italia. Tutte le icone
 * qui sono decorative, quindi restano fuori dalla lettura assistita.
 */
export default function SvgIcon({
  id,
  className,
  size,
}: {
  id: string;
  className?: string;
  size?: number;
}) {
  const dim = size ?? 24;
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={dim}
      height={dim}
      aria-hidden="true"
      focusable="false"
    >
      <use href={`/svg/sprites.svg#${id}`} />
    </svg>
  );
}
