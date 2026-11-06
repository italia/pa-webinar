// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';

/**
 * Chiude la fascia di chi e' fuori dalla registrazione: sul telefono ruba un terzo
 * dello schermo, e la sala d'attesa ha gia' spiegato tutto. Consensi e testi
 * restano nel pulsante «I tuoi consensi», in alto.
 */
export default function ChiudiFascia({ onChiudi }: { onChiudi: () => void }) {
  const t = useTranslations('live.consents');
  return (
    <button
      type="button"
      className="btn live-listen-only__chiudi"
      onClick={onChiudi}
      aria-label={t('closeNotice')}
      title={t('closeNotice')}
    >
      <Icon icon="it-close" size="sm" />
    </button>
  );
}
