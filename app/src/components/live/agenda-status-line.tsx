'use client';

/**
 * La riga sotto il titolo di un argomento dell'agenda: lo stato scritto e
 * i suoi tempi. La usano il pannello e l'elenco nella barra della sala.
 *
 * Da discutere: quanto e' previsto. In corso: da quanto dura; chi conduce lo
 * vede rispetto al previsto, e quando si va oltre. Discusso: quanto e' durato.
 */

import { useTranslations } from 'next-intl';

import { minutesBetween, minutesSince, type AgendaStatus } from '@/lib/agenda/status';

export interface AgendaTiming {
  status: AgendaStatus;
  startedAt: string | null;
  completedAt?: string | null;
  plannedMinutes: number | null;
}

export default function AgendaStatusLine({
  item,
  now,
  isModerator,
}: {
  item: AgendaTiming;
  now: Date;
  isModerator: boolean;
}) {
  const t = useTranslations('agenda');

  let tempo: string | null = null;
  let oltre = false;
  if (item.status === 'PENDING' && item.plannedMinutes) {
    tempo = t('plannedMinutes', { minutes: item.plannedMinutes });
  } else if (item.status === 'CURRENT') {
    const trascorsi = minutesSince(item.startedAt, now);
    if (trascorsi !== null) {
      if (isModerator && item.plannedMinutes) {
        tempo = t('elapsedOfPlanned', { minutes: trascorsi, planned: item.plannedMinutes });
        oltre = trascorsi > item.plannedMinutes;
      } else {
        tempo = t('runningFor', { minutes: trascorsi });
      }
    }
  } else if (item.status === 'DONE') {
    const durata = minutesBetween(item.startedAt, item.completedAt ?? null);
    if (durata !== null) tempo = t('tookMinutes', { minutes: durata });
  }

  return (
    <span className={`agenda-item__status${oltre ? ' is-over' : ''}`}>
      {t(`status.${item.status}`)}
      {tempo && <> · {tempo}</>}
      {oltre && <> · {t('overtime')}</>}
    </span>
  );
}
