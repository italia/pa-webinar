'use client';

/**
 * Il programma dell'incontro nella pagina pubblica dell'evento: gli argomenti
 * in ordine, l'ora prevista di ciascuno, chi interviene (solo se e'
 * presentato nella pagina) e quanto dura. Lo usano la pagina dell'evento e
 * l'anteprima del wizard: l'anteprima e' la pagina.
 *
 * Gli orari partono dall'inizio dell'evento e sommano le durate; dal primo
 * argomento senza durata in poi non se ne mostrano (lib/agenda/programme).
 * Sono formattati come quelli dell'intestazione, nello stesso fuso. In
 * diretta l'argomento in corso lo dice, anche alle tecnologie assistive
 * (`aria-current="time"`). Dopo l'evento, con il video, diventa l'indice
 * della registrazione: per ogni argomento il minuto del video in cui e'
 * cominciato (un clic porta li') e quanto e' durato davvero.
 */

import type { RefObject } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import type { VideoPlayerHandle } from '@/components/events/video-player';
import type { ProgrammeVideoTime } from '@/lib/replay/moments';
import { formatVideoTime } from '@/lib/utils/video-time';

import PersonPhoto from '@/components/events/person-photo';
import { useDurataTesto } from '@/hooks/use-durata-testo';
import {
  durataProgramma,
  orariProgramma,
  type VoceProgramma,
} from '@/lib/agenda/programme';

interface Props {
  items: VoceProgramma[];
  startsAt: Date;
  /** L'evento e' in diretta: l'argomento in corso si mostra come tale. */
  live?: boolean;
  /** Dopo l'evento: il minuto del video di ogni argomento (lib/replay/moments). */
  videoTimes?: Record<string, ProgrammeVideoTime> | null;
  /** Il lettore della registrazione, per andare al minuto di un argomento. */
  playerRef?: RefObject<VideoPlayerHandle | null>;
}

export default function EventProgramme({
  items,
  startsAt,
  live = false,
  videoTimes,
  playerRef,
}: Props) {
  const t = useTranslations('events.detail.programme');
  const format = useFormatter();
  const durata = useDurataTesto();
  if (items.length === 0) return null;

  const orari = orariProgramma(startsAt, items);
  // Indice della registrazione: con il video e almeno un argomento nel video.
  const indice = !!videoTimes && !!playerRef && Object.keys(videoTimes).length > 0;
  const totale = durataProgramma(items);
  const ora = (d: Date) => format.dateTime(d, { hour: '2-digit', minute: '2-digit' });

  return (
    <section
      className={`event-programma mb-4${indice ? ' event-programma--indice' : ''}`}
      aria-labelledby="event-programma-title"
    >
      <h2
        id="event-programma-title"
        className="h4 fw-semibold mb-1"
        style={{ color: 'var(--app-text)' }}
      >
        {t('title')}
      </h2>
      <p className="event-programma__nota">
        {indice
          ? t('videoNote')
          : totale !== null
            ? t('noteWithTotal', { duration: durata(0, totale * 60_000) })
            : t('note')}
      </p>
      <ol className="event-programma__elenco" role="list">
        {items.map((v, i) => {
          const { start } = orari[i]!;
          const inCorso = live && v.status === 'CURRENT';
          const passato = live && (v.status === 'DONE' || v.status === 'SKIPPED');
          return (
            <li
              key={v.id}
              className={[
                'event-programma__voce',
                inCorso ? 'event-programma__voce--ora' : '',
                passato ? 'event-programma__voce--passata' : '',
                start ? '' : 'event-programma__voce--senza-ora',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-current={inCorso ? 'time' : undefined}
            >
              <span className="event-programma__quando">
                {indice ? (
                  videoTimes![v.id] ? (
                    <button
                      type="button"
                      className="event-programma__minuto"
                      onClick={() =>
                        playerRef!.current?.seekTo(videoTimes![v.id]!.offsetSec)
                      }
                      aria-label={t('seekTo', {
                        time: formatVideoTime(videoTimes![v.id]!.offsetSec),
                        topic: v.label,
                      })}
                    >
                      {formatVideoTime(videoTimes![v.id]!.offsetSec)}
                    </button>
                  ) : null
                ) : (
                  start && <time dateTime={start.toISOString()}>{ora(start)}</time>
                )}
              </span>
              <div className="event-programma__corpo">
                <p className="event-programma__titolo">
                  {v.label}
                  {inCorso && (
                    <>
                      {' '}
                      <span className="event-programma__adesso">{t('now')}</span>
                    </>
                  )}
                </p>
                {v.speaker && (
                  <p className="event-programma__chi">
                    {/* La foto (o le iniziali) accanto al nome, che la dice
                        gia': decorativa. */}
                    <PersonPhoto
                      src={v.speaker.photoUrl}
                      name={v.speaker.name}
                      size={32}
                      loading="lazy"
                      className="event-programma__foto"
                      initialsClassName="event-programma__foto event-programma__iniziali"
                    />
                    <span className="event-programma__persona">
                      <span className="event-programma__nome">{v.speaker.name}</span>
                      {v.speaker.organization && (
                        <span className="event-programma__ente">
                          {v.speaker.organization}
                        </span>
                      )}
                    </span>
                  </p>
                )}
              </div>
              {indice && videoTimes![v.id]?.durationSec ? (
                <span className="event-programma__durata">
                  {t('minutes', {
                    minutes: Math.max(1, Math.round(videoTimes![v.id]!.durationSec / 60)),
                  })}
                  {v.plannedMinutes ? (
                    <span className="event-programma__previsto">
                      {t('planned', { minutes: v.plannedMinutes })}
                    </span>
                  ) : null}
                </span>
              ) : v.plannedMinutes ? (
                // Nell'indice un argomento non discusso nel video mostra solo
                // la durata prevista, detta come tale.
                <span className="event-programma__durata">
                  {indice
                    ? t('planned', { minutes: v.plannedMinutes })
                    : t('minutes', { minutes: v.plannedMinutes })}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
