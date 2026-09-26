'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Alert } from 'design-react-kit';

/**
 * Pagina aperta da un indirizzo non protetto (http://, fuori da localhost).
 *
 * Il browser nega microfono e videocamera fuori da un contesto sicuro, e la
 * videochiamata incorporata eredita il limite: senza avviso la sala
 * resterebbe su «Connessione in corso…» e la prova dei dispositivi
 * chiederebbe un permesso che non si puo' dare. Qui lo si dice, con il link
 * all'indirizzo https della stessa pagina.
 */

const nessunAbbonamento = () => () => {};

/** Vero solo nel browser e solo fuori da un contesto sicuro; sul server e al
 *  primo disegno dopo l'idratazione e' falso, cosi' l'HTML coincide. */
export function useInsecureContext(): boolean {
  return useSyncExternalStore(
    nessunAbbonamento,
    () => window.isSecureContext === false,
    () => false,
  );
}

/** La stessa pagina su https: stesso host, porta predefinita. */
export function secureUrlFor(
  loc: Pick<Location, 'hostname' | 'pathname' | 'search' | 'hash'>,
): string {
  return `https://${loc.hostname}${loc.pathname}${loc.search}${loc.hash}`;
}

/**
 * L'avviso, oppure niente in un contesto sicuro. Il testo del link mostra solo
 * l'host: l'indirizzo completo puo' contenere un token personale, che non va
 * esposto sullo schermo.
 */
export function InsecureContextNotice({ className }: { className?: string }) {
  const t = useTranslations('live');
  const insecure = useInsecureContext();
  if (!insecure) return null;
  const { hostname } = window.location;
  return (
    // Niente <Icon> dentro <Alert>: Bootstrap Italia disegna gia' la sua.
    <Alert color="warning" className={`text-start mb-0 ${className ?? ''}`.trim()}>
      <strong className="d-block mb-1">{t('insecureContextTitle')}</strong>
      <span className="d-block mb-2">{t('insecureContextBody')}</span>
      <a href={secureUrlFor(window.location)} className="fw-semibold">
        {t('insecureContextLink', { host: hostname })}
      </a>
    </Alert>
  );
}
