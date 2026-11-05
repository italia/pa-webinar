'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import { usePathname } from '@/i18n/navigation';

/** Le pagine in cui il pulsante coprirebbe i comandi: la sala live. */
const ESCLUSE = new Set<string>(['/events/[slug]/live']);

/**
 * «Torna su», il pulsante di Bootstrap Italia: compare dopo un po' di
 * scorrimento e riporta in cima. Un pulsante vero (non un link nascosto ai
 * lettori di schermo), con il suo nome; rispetta chi riduce le animazioni.
 */
export default function BackToTop() {
  const t = useTranslations('common');
  const pathname = usePathname();
  const [visibile, setVisibile] = useState(false);

  useEffect(() => {
    const aggiorna = () => setVisibile(window.scrollY > 400);
    aggiorna();
    window.addEventListener('scroll', aggiorna, { passive: true });
    return () => window.removeEventListener('scroll', aggiorna);
  }, []);

  // Nell'amministrazione la barra d'azioni del wizard sta proprio li'.
  if (ESCLUSE.has(pathname) || pathname.startsWith('/admin')) return null;

  return (
    <button
      type="button"
      className={`back-to-top shadow border-0${visibile ? ' back-to-top-show' : ''}`}
      aria-label={t('backToTop')}
      tabIndex={visibile ? 0 : -1}
      aria-hidden={!visibile}
      onClick={() => {
        const ridotto = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: ridotto ? 'auto' : 'smooth' });
        document.getElementById('main-content')?.focus({ preventScroll: true });
      }}
    >
      <Icon icon="it-arrow-up" color="white" />
    </button>
  );
}
