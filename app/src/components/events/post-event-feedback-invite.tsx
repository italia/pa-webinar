'use client';

/**
 * Invitation to leave POST_EVENT feedback, shown on the public post-event
 * page for attendees who did not submit at call exit. Self-hides when the
 * event has no POST_EVENT questionnaire configured (QuestionnaireForm
 * reports a 404 via onNotFound). Uses the same stable guest id as the live
 * client so a participant who already answered is de-duplicated.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardBody } from 'design-react-kit';

import QuestionnaireForm from '@/components/questionnaires/questionnaire-form';

function readGuestId(): string {
  const fresh = () => `guest_${Math.random().toString(36).slice(2, 10)}`;
  if (typeof window === 'undefined') return fresh();
  try {
    const k = 'paw_guest_id';
    let v = window.localStorage.getItem(k);
    if (!v) {
      v = fresh();
      window.localStorage.setItem(k, v);
    }
    return v;
  } catch {
    return fresh();
  }
}

export default function PostEventFeedbackInvite({
  eventSlug,
  accessToken,
}: {
  eventSlug: string;
  accessToken?: string;
}) {
  const t = useTranslations('feedback');
  const [available, setAvailable] = useState(true);
  const [guestId] = useState(readGuestId);
  const handleNotFound = useCallback(() => setAvailable(false), []);

  if (!available) return null;

  return (
    <Card className="shadow-sm border-0 mt-4" style={{ borderRadius: '0.5rem' }}>
      <CardBody className="p-3">
        <h3 className="h6 fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h3>
        <QuestionnaireForm
          eventSlug={eventSlug}
          placement="POST_EVENT"
          accessToken={accessToken}
          guestId={accessToken ? undefined : guestId}
          variant="feedback"
          hideHeader
          submitLabel={t('submit')}
          submittingLabel={t('submitting')}
          submittedMessage={t('thankYou')}
          onNotFound={handleNotFound}
        />
      </CardBody>
    </Card>
  );
}
