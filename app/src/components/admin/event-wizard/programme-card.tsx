'use client';

/**
 * Il programma nel passo «Evento», sotto la descrizione: dove la pagina
 * pubblica lo mostra. Il programma si prepara nel suo passo (servono le
 * persone e l'orario); qui si vede se c'e', si va a prepararlo e, se la
 * descrizione sembra gia' contenerne uno, lo si dice: nella pagina
 * comparirebbe due volte, e senza orari ne' persone.
 */

import { useId } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';

import {
  descrizioneConProgramma,
  haTitolo,
  istanteDalModulo,
  oraNelFuso,
  orariDelModulo,
  type AgendaDraft,
} from './programme-plan';

interface Props {
  value: {
    agenda?: AgendaDraft[];
    agendaEnabled: boolean;
    startsAt: string;
    timezone: string;
  };
  /** La descrizione nella lingua principale. */
  descrizione: string;
  /** Apre il passo «Programma». */
  onVai: () => void;
}

export default function ProgrammeCard({ value, descrizione, onVai }: Props) {
  const tp = useTranslations('admin.wizard.programme');
  const id = useId();
  const agenda = value.agenda ?? [];
  const argomenti = agenda.filter(haTitolo).length;
  const inizio = istanteDalModulo(value.startsAt, value.timezone);
  const { fine } = orariDelModulo(agenda, inizio);
  const ora = (d: Date) => oraNelFuso(d, value.timezone);
  const doppio = descrizioneConProgramma(descrizione);

  return (
    <section className="wizard-programma-scheda mb-4" aria-labelledby={`${id}-titolo`}>
      <div className="wizard-programma-scheda__riga">
        <Icon icon="it-list" size="sm" className="wizard-programma-scheda__icona" />
        <div className="wizard-programma-scheda__testo">
          <h3 id={`${id}-titolo`} className="wizard-programma-scheda__titolo">
            {tp('cardTitle')}
          </h3>
          {argomenti === 0 ? (
            <p className="mb-0">{tp('cardEmpty')}</p>
          ) : (
            <p className="mb-0">
              {inizio && fine
                ? tp('cardSummaryWithTimes', {
                    count: argomenti,
                    start: ora(inizio),
                    end: ora(fine),
                  })
                : tp('cardSummary', { count: argomenti })}
              {!value.agendaEnabled && (
                <span className="d-block text-secondary">{tp('cardOff')}</span>
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn btn-outline-primary btn-sm flex-shrink-0"
          onClick={onVai}
        >
          {argomenti === 0 ? tp('cardPrepare') : tp('cardChange')}
        </button>
      </div>
      {doppio && (
        <p className="wizard-iscrizione__avviso mb-0" role="note">
          <Icon icon="it-warning-circle" size="sm" />
          <span>
            {tp('descriptionHasProgramme')}{' '}
            <button
              type="button"
              className="btn btn-link p-0 align-baseline"
              onClick={onVai}
            >
              {tp('goToProgramme')}
            </button>
          </span>
        </p>
      )}
    </section>
  );
}
