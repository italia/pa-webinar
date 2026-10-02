'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';

import QuestionForm from './question-form';
import QuestionList from './question-list';

import { Icon } from '@/components/ui/icon';

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

  const handleSubmitted = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

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

        <div className="p-3 flex-grow-1" style={{ overflowY: 'auto' }}>
          {!isModerator && (
            <>
              {/* First-time-user CTA. Kept visible even after the first
                  question is sent so new arrivals still see the prompt. */}
              <div
                className="mb-3 p-3 rounded d-flex gap-2 align-items-start"
                style={{
                  backgroundColor: '#EAF4FF',
                  border: '1px solid #CCE0F5',
                }}
                role="note"
              >
                <div aria-hidden="true" style={{ flexShrink: 0 }}>
                  <Icon icon="it-comment" size="lg" color="primary" />
                </div>
                <div>
                  <h6 className="mb-1">{t('ctaTitle')}</h6>
                  <p className="mb-0 small text-secondary">
                    {t('ctaBody')}
                  </p>
                </div>
              </div>

              <QuestionForm
                eventSlug={eventSlug}
                token={token}
                guestName={guestName}
                guestId={guestId}
                onSubmitted={handleSubmitted}
              />
            </>
          )}

          {isModerator && (
            <div
              className="mb-3 p-2 rounded small text-muted"
              style={{ backgroundColor: '#F5F5F5' }}
            >
              {t('moderatorHint')}
            </div>
          )}

          <QuestionList
            key={refreshKey}
            eventSlug={eventSlug}
            token={token}
            isModerator={isModerator}
            voterAccessToken={voterAccessToken}
            voterGuestId={voterGuestId}
          />
        </div>
    </div>
  );
}
