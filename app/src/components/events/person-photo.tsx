'use client';

/**
 * La foto di una persona dell'evento in un cerchio, o le sue iniziali: senza
 * foto, e anche quando l'indirizzo della foto non la serve. Una foto è
 * pubblica solo finché una persona che la usa è presentata in una pagina
 * visibile, e fuori da lì la vede solo lo staff che gestisce l'evento
 * (api/avatar/person/[id]): chi non può vederla trova le iniziali, mai
 * un'immagine rotta. La usano la pagina pubblica, il programma e il wizard.
 */

import { useCallback, useState, type CSSProperties } from 'react';

import { initials } from '@/lib/utils/speaker-palette';

export default function PersonPhoto({
  src,
  name,
  size,
  className,
  initialsClassName,
  alt = '',
  loading,
  style,
}: {
  /** Il percorso della foto, o niente se la persona non ne ha. */
  src: string | null | undefined;
  /** Il nome della persona: le iniziali. */
  name: string;
  size: number;
  className: string;
  initialsClassName: string;
  /** Accanto al nome la foto è decorativa: testo alternativo vuoto. */
  alt?: string;
  loading?: 'lazy' | 'eager';
  style?: CSSProperties;
}) {
  // L'indirizzo che non si è caricato: uno nuovo si prova di nuovo.
  const [rotta, setRotta] = useState<string | null>(null);
  // Un errore arrivato prima dell'idratazione (la pagina viene dal server con
  // l'immagine già nel documento) non passa da onError: rimettere lo stesso
  // indirizzo lo fa ripetere ora che c'è chi lo ascolta. Solo per
  // un'immagine finita senza pixel: una caricata, o ancora in arrivo, non si
  // tocca. Stabile, così parte solo quando l'immagine entra nel documento.
  const riprovaSeRotta = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
      img.src = img.src;
    }
  }, []);

  if (!src || rotta === src) {
    return (
      <span className={initialsClassName} style={style} aria-hidden="true">
        {initials(name)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={riprovaSeRotta}
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading={loading}
      className={className}
      style={style}
      onError={() => setRotta(src)}
    />
  );
}
