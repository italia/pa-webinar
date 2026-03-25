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
}

export default function QAPanel({
  eventSlug,
  token,
  isModerator,
}: QAPanelProps) {
  const t = useTranslations('qa');
  const [showOnMobile, setShowOnMobile] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSubmitted = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <>
      <div className="d-lg-none p-2 border-top">
        <Button
          color="primary"
          outline
          size="sm"
          className="w-100"
          onClick={() => setShowOnMobile(!showOnMobile)}
        >
          <Icon icon="it-comment" size="sm" className="me-2" />
          {showOnMobile ? t('hidePanel') : t('showPanel')}
        </Button>
      </div>

      <div
        className={`qa-sidebar d-flex flex-column ${showOnMobile ? '' : 'd-none d-lg-flex'}`}
        style={{ width: '100%', maxWidth: '360px', overflowY: 'auto' }}
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
            <QuestionForm
              eventSlug={eventSlug}
              token={token}
              onSubmitted={handleSubmitted}
            />
          )}

          <QuestionList
            key={refreshKey}
            eventSlug={eventSlug}
            token={token}
            isModerator={isModerator}
          />
        </div>
      </div>
    </>
  );
}
