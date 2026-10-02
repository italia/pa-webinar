'use client';

import { useTranslations } from 'next-intl';

/**
 * Link di salto, il primo elemento raggiungibile col tasto Tab su ogni pagina.
 *
 * Ancore semplici con la classe di Bootstrap Italia, non lo Skiplink di
 * design-react-kit: quel componente rende i figli solo con la prop `nav`, e
 * senza di essa i link non arrivavano mai nella pagina. I bersagli hanno
 * tabIndex -1 (layout e piè di pagina), cosi' Invio vi porta davvero il fuoco.
 */
export function Skiplink() {
  const t = useTranslations('nav');

  return (
    <div className="skiplinks">
      <a className="visually-hidden-focusable" href="#main-content">
        {t('skipToContent')}
      </a>
      <a className="visually-hidden-focusable" href="#footer">
        {t('skipToFooter')}
      </a>
    </div>
  );
}
