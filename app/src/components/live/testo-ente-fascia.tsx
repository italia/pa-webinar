// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useTranslations } from 'next-intl';

/**
 * Il testo dell'ente sulla registrazione, nelle fasce sopra la conferenza. Puo'
 * essere lungo qualche migliaio di caratteri, e la fascia non si chiude e sta in
 * una pagina senza scorrimento: il testo ha un'altezza massima e scorre da se'
 * (`.live-listen-only__testo-ente`), si raggiunge anche da tastiera, e conferenza
 * e pulsante del consenso restano sullo schermo. Dentro un `<p>`, per questo e'
 * uno `span`.
 */
export default function TestoEnteFascia({ testo }: { testo: string }) {
  const t = useTranslations('live.consents');
  return (
    <span
      className="live-listen-only__testo-ente small mt-1"
      role="group"
      tabIndex={0}
      aria-label={t('recording.title')}
    >
      {testo}
    </span>
  );
}
