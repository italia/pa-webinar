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
 * (`aria-current="time"`).
 */

import { useFormatter, useTranslations } from 'next-intl';

import { useDurataTesto } from '@/hooks/use-durata-testo';
import {
  durataProgramma,
  orariProgramma,
  type VoceProgramma,
} from '@/lib/agenda/programme';
import { initials } from '@/lib/utils/speaker-palette';

interface Props {
  items: VoceProgramma[];
  startsAt: Date;
  /** L'evento e' in diretta: l'argomento in corso si mostra come tale. */
  live?: boolean;
}

export default function EventProgramme({ items, startsAt, live = false }: Props) {
  const t = useTranslations('events.detail.programme');
  const format = useFormatter();
  const durata = useDurataTesto();
  if (items.length === 0) return null;

  const orari = orariProgramma(startsAt, items);
  const totale = durataProgramma(items);
  const ora = (d: Date) => format.dateTime(d, { hour: '2-digit', minute: '2-digit' });

  return (
    <section className="event-programma mb-4" aria-labelledby="event-programma-title">
      <h2
        id="event-programma-title"
        className="h4 fw-semibold mb-1"
        style={{ color: 'var(--app-text)' }}
      >
        {t('title')}
      </h2>
      <p className="event-programma__nota">
        {totale !== null
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
                {start && <time dateTime={start.toISOString()}>{ora(start)}</time>}
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
                    {v.speaker.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={v.speaker.photoUrl}
                        alt=""
                        width={32}
                        height={32}
                        loading="lazy"
                        className="event-programma__foto"
                      />
                    ) : (
                      <span
                        className="event-programma__foto event-programma__iniziali"
                        aria-hidden="true"
                      >
                        {initials(v.speaker.name)}
                      </span>
                    )}
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
              {v.plannedMinutes ? (
                <span className="event-programma__durata">
                  {t('minutes', { minutes: v.plannedMinutes })}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
