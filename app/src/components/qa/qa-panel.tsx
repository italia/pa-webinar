'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Icon } from 'design-react-kit';

import QuestionForm from './question-form';
import QuestionList from './question-list';

interface QAPanelProps {
  eventSlug: string;
  token: string;
  isModerator: boolean;
  /** Guest display name, forwarded to QuestionForm when token is empty
   *  so anonymous attendees can post questions. */
  guestName?: string;
}

export default function QAPanel({
  eventSlug,
  token,
  isModerator,
  guestName,
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
        <div className="p-3 border-bottom">
          <h3 className="h5 mb-0 d-flex align-items-center">
            <Icon icon="it-comment" className="me-2" />
            {t('title')}
          </h3>
          <p className="text-muted mb-0 mt-1" style={{ fontSize: '0.78rem' }}>
            {t('qaPersistenceNote')}
          </p>
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
          />
        </div>
    </div>
  );
}
