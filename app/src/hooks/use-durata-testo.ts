'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

type Istante = Date | string | number;

/**
 * La durata di un evento in parole, con il plurale della lingua: «45 minuti»,
 * «2 ore», «2 ore e 30 minuti». Un solo calcolo per sala d'attesa, pagina
 * pubblica e gestione, con i minuti arrotondati.
 */
export function useDurataTesto(): (inizio: Istante, fine: Istante) => string {
  const t = useTranslations('common');
  return useCallback(
    (inizio: Istante, fine: Istante) => {
      const minutiTotali = Math.max(
        0,
        Math.round((new Date(fine).getTime() - new Date(inizio).getTime()) / 60_000),
      );
      const ore = Math.floor(minutiTotali / 60);
      const minuti = minutiTotali % 60;
      if (ore === 0) return t('durationMinutes', { minutes: minuti });
      if (minuti === 0) return t('durationHours', { hours: ore });
      return t('durationHoursMinutes', { hours: ore, minutes: minuti });
    },
    [t],
  );
}
