'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import { readMyQuestions, rememberMyQuestion } from '@/lib/qa/alerts';

import QuestionForm from './question-form';
import QuestionList from './question-list';


interface QAPanelProps {
  eventSlug: string;
  token: string;
  isModerator: boolean;
  /** Guest display name, forwarded to QuestionForm when token is empty
   *  so anonymous attendees can post questions. */
  guestName?: string;
  /** Identificativo stabile del browser dell'ospite: il server ci lega il
   *  limite di una domanda ogni trenta secondi, a persona e non per IP. */
  guestId?: string;
  /** Identità con cui si sostiene una domanda: l'`accessToken` di una
   *  registrazione… */
  voterAccessToken?: string;
  /** …oppure l'identificativo stabile del browser, per chi una registrazione
   *  non ce l'ha (ospiti, relatori, moderatori). Esattamente uno dei due. */
  voterGuestId?: string;
}

export default function QAPanel({
  eventSlug,
  token,
  isModerator,
  guestName,
  guestId,
  voterAccessToken,
  voterGuestId,
}: QAPanelProps) {
  const t = useTranslations('qa');
  const [refreshKey, setRefreshKey] = useState(0);
  // Le domande fatte da questo browser: la lista le segna, e la sala avvisa
  // quando ricevono risposta (lib/qa/alerts).
  const [myQuestionIds, setMyQuestionIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setMyQuestionIds(readMyQuestions(eventSlug));
  }, [eventSlug]);

  const handleSubmitted = useCallback(
    (questionId?: string) => {
      if (questionId) setMyQuestionIds(rememberMyQuestion(eventSlug, questionId));
      setRefreshKey((k) => k + 1);
    },
    [eventSlug],
  );

  return (
    <div
      className="d-flex flex-column flex-grow-1"
      style={{ width: '100%', minHeight: 0 }}
    >
        <div className="live-panel-header live-panel-header--bar live-panel-header--stacked">
          <h3 className="live-panel-header__title">
            <Icon icon="it-help-circle" size="sm" aria-hidden="true" />
            {t('title')}
          </h3>
          <p className="live-panel-header__note">{t('qaPersistenceNote')}</p>
        </div>

        <div className="qa-body flex-grow-1">
          {!isModerator && (
            <QuestionForm
              eventSlug={eventSlug}
              token={token}
              guestName={guestName}
              guestId={guestId}
              onSubmitted={handleSubmitted}
            />
          )}

          {isModerator && <p className="qa-moderator-hint">{t('moderatorHint')}</p>}

          <QuestionList
            key={refreshKey}
            eventSlug={eventSlug}
            token={token}
            isModerator={isModerator}
            voterAccessToken={voterAccessToken}
            voterGuestId={voterGuestId}
            myQuestionIds={myQuestionIds}
          />
        </div>
    </div>
  );
}
