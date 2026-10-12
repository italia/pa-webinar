'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';

interface PollData {
  id: string;
  question: string;
  options: string[];
  status: string;
  totalVotes: number;
  optionCounts: number[] | null;
  hasVoted: boolean;
  votedOptionIndex: number | null;
  createdAt: string;
  closedAt: string | null;
}

interface PollCardProps {
  poll: PollData;
  isModerator: boolean;
  /** Persone in sala adesso (bot di registrazione escluso), se note: la
   *  partecipazione si misura su di loro. */
  presentCount?: number;
  onVote: (pollId: string, optionIndex: number) => void;
  onStatusChange: (pollId: string, status: string) => void;
  onDelete: (pollId: string) => void;
}

export default function PollCard({
  poll,
  isModerator,
  presentCount,
  onVote,
  onStatusChange,
  onDelete,
}: PollCardProps) {
  const t = useTranslations('polls');
  const tc = useTranslations('common');

  const isOpen = poll.status === 'OPEN';
  const isClosed = poll.status === 'CLOSED';
  const isPublished = poll.status === 'PUBLISHED';
  // Anche chi conduce vota: in una riunione il moderatore è una delle persone
  // in sala, e un sondaggio in cui non può esprimersi era la stessa cosa che
  // agli ospiti appariva come «sondaggio rotto».
  const canVote = isOpen && !poll.hasVoted;
  const showResults = poll.optionCounts !== null;

  // Eliminare non si annulla: il primo clic chiede conferma.
  const [confermaElimina, setConfermaElimina] = useState(false);
  useEffect(() => {
    if (!confermaElimina) return;
    const timer = setTimeout(() => setConfermaElimina(false), 4000);
    return () => clearTimeout(timer);
  }, [confermaElimina]);

  // La risposta in testa si distingue (stesso blu, pieno); le altre nella
  // tinta chiara dello stesso blu. A parità restano in testa tutte.
  const counts = poll.optionCounts ?? [];
  const massimo = counts.length > 0 ? Math.max(...counts) : 0;

  // Partecipazione: chi ha votato rispetto a chi c'e'. Senza il numero dei
  // presenti, o quando i voti li superano (ha votato anche chi poi e' uscito),
  // si dice solo quanti voti: «11 voti su 2 presenti» non vorrebbe dire niente.
  const presenti =
    presentCount && presentCount > 0 && poll.totalVotes <= presentCount ? presentCount : null;
  const quota = presenti ? Math.round((poll.totalVotes / presenti) * 100) : null;

  return (
    <article className={`poll-card${isOpen ? ' poll-card--open' : ''}`}>
      <header className="poll-card__head">
        <span className={`poll-status poll-status--${poll.status.toLowerCase()}`}>
          {isOpen && <span className="poll-status__dot" aria-hidden="true" />}
          {t(`status.${poll.status}`)}
        </span>
        {poll.hasVoted && (
          <span className="poll-card__voted">
            <Icon icon="it-check" size="xs" />
            {t('voted')}
          </span>
        )}
      </header>

      <h4 className="poll-card__question">{poll.question}</h4>

      {canVote && !showResults ? (
        // Chi deve ancora votare vede le risposte da scegliere, non i numeri.
        <div className="poll-choices" role="group" aria-label={poll.question}>
          {poll.options.map((option, idx) => (
            <button
              key={idx}
              type="button"
              className="poll-choice"
              onClick={() => onVote(poll.id, idx)}
            >
              <span className="poll-choice__radio" aria-hidden="true" />
              <span className="poll-choice__text">{option}</span>
            </button>
          ))}
        </div>
      ) : showResults ? (
        <ul className="poll-results">
          {poll.options.map((option, idx) => {
            const count = counts[idx] ?? 0;
            const pct = poll.totalVotes > 0 ? Math.round((count / poll.totalVotes) * 100) : 0;
            const inTesta = count > 0 && count === massimo;
            const mio = poll.votedOptionIndex === idx;
            // Chi vede i risultati mentre il voto è aperto — il moderatore —
            // vota SULLA riga dei risultati: sostituirla con un pulsante nudo
            // gli toglierebbe il conteggio dal vivo, che è il motivo per cui
            // sta guardando il pannello.
            const riga = (
              <>
                <span className="poll-result__label">
                  <span className="poll-result__text">{option}</span>
                  {mio && (
                    <span className="poll-result__mine">
                      <Icon icon="it-check" size="xs" />
                      {t('yourVote')}
                    </span>
                  )}
                  <span className="poll-result__value">
                    <strong>{pct}%</strong> · {count}
                  </span>
                </span>
                <span className="poll-result__track" aria-hidden="true">
                  <span
                    className={`poll-result__bar${inTesta ? ' is-leading' : ''}`}
                    style={{ width: `${pct}%` }}
                  />
                </span>
              </>
            );
            return (
              <li key={idx} className="poll-result">
                {canVote ? (
                  <button
                    type="button"
                    className="poll-result__vote"
                    onClick={() => onVote(poll.id, idx)}
                  >
                    {riga}
                  </button>
                ) : (
                  riga
                )}
              </li>
            );
          })}
        </ul>
      ) : poll.hasVoted ? (
        // Ha votato e i risultati non sono ancora pubblici.
        <p className="poll-card__waiting">{t('resultsHidden')}</p>
      ) : (
        // Non ha votato e non puo' piu' farlo (voto chiuso, risultati non
        // pubblicati): le risposte restano leggibili, senza dire «registrato».
        <>
          <ul className="poll-choices poll-choices--static" aria-label={poll.question}>
            {poll.options.map((option, idx) => (
              <li key={idx} className="poll-choice">
                <span className="poll-choice__radio" aria-hidden="true" />
                <span className="poll-choice__text">{option}</span>
              </li>
            ))}
          </ul>
          <p className="poll-card__waiting">{t('closedNoVote')}</p>
        </>
      )}

      {showResults && (
        <div className="poll-participation">
          <span className="poll-participation__label">
            {presenti
              ? t('participation', { votes: poll.totalVotes, present: presenti })
              : t('totalVotes', { count: poll.totalVotes })}
            {quota !== null && <strong> · {quota}%</strong>}
          </span>
          {quota !== null && (
            <span
              className="poll-participation__meter"
              role="meter"
              aria-label={t('participationLabel')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={quota}
            >
              <span style={{ width: `${quota}%` }} />
            </span>
          )}
        </div>
      )}

      {isModerator && (
        <footer className="poll-card__actions">
          {isOpen && (
            <button
              type="button"
              className="poll-action"
              onClick={() => onStatusChange(poll.id, 'CLOSED')}
            >
              <Icon icon="it-locked" size="xs" />
              {t('closePoll')}
            </button>
          )}
          {isClosed && (
            <button
              type="button"
              className="poll-action poll-action--primary"
              onClick={() => onStatusChange(poll.id, 'PUBLISHED')}
            >
              <Icon icon="it-chart-line" size="xs" />
              {t('publishResults')}
            </button>
          )}
          {(isClosed || isPublished) && (
            <button
              type="button"
              className="poll-action"
              onClick={() => onStatusChange(poll.id, 'OPEN')}
            >
              <Icon icon="it-unlocked" size="xs" />
              {t('reopenPoll')}
            </button>
          )}
          <button
            type="button"
            className={`poll-action poll-action--delete${confermaElimina ? ' is-armed' : ''}`}
            aria-label={confermaElimina ? `${t('deletePoll')}: ${tc('confirm')}` : t('deletePoll')}
            title={t('deletePoll')}
            onClick={() => {
              if (!confermaElimina) {
                setConfermaElimina(true);
                return;
              }
              setConfermaElimina(false);
              onDelete(poll.id);
            }}
          >
            <Icon icon="it-delete" size="xs" />
            {confermaElimina && tc('confirm')}
          </button>
        </footer>
      )}
    </article>
  );
}
