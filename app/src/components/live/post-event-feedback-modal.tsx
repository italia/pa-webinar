'use client';

/**
 * Post-event feedback modal shown when the event ends (or the user leaves
 * after it has ended). Converged feedback entry point:
 *
 *   - If the event has a POST_EVENT questionnaire configured, render it as
 *     a star/scale form (the "Feedback generico" template by default, or a
 *     custom one). Responses land in QuestionnaireResponse.
 *   - Otherwise fall back to the legacy single-star EventFeedback modal so
 *     events without a questionnaire still collect a rating.
 *
 * Detection is a lightweight GET against the public questionnaire endpoint
 * (404 → no questionnaire). The questionnaire branch deliberately does NOT
 * auto-close while the user is answering; only the thank-you state does.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import QuestionnaireForm from '@/components/questionnaires/questionnaire-form';
import EventFeedback from '@/components/live/event-feedback';

interface PostEventFeedbackModalProps {
  eventSlug: string;
  accessToken?: string;
  guestId?: string;
  onClose: () => void;
}

type Detect = 'loading' | 'present' | 'absent';

export default function PostEventFeedbackModal({
  eventSlug,
  accessToken,
  guestId,
  onClose,
}: PostEventFeedbackModalProps) {
  const t = useTranslations('feedback');
  const [detect, setDetect] = useState<Detect>('loading');
  const [submitted, setSubmitted] = useState(false);

  // Detect a configured POST_EVENT questionnaire once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(eventSlug)}/questionnaires/POST_EVENT`,
          { cache: 'no-store' }
        );
        if (!cancelled) setDetect(res.ok ? 'present' : 'absent');
      } catch {
        if (!cancelled) setDetect('absent');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventSlug]);

  // Auto-close shortly after a successful submission.
  useEffect(() => {
    if (!submitted) return;
    const id = setTimeout(onClose, 2500);
    return () => clearTimeout(id);
  }, [submitted, onClose]);

  // No questionnaire → legacy single-star modal (owns its own chrome).
  if (detect === 'absent') {
    return (
      <EventFeedback
        eventSlug={eventSlug}
        accessToken={accessToken}
        guestId={guestId}
        onClose={onClose}
      />
    );
  }

  return (
    <div
      className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
      style={{
        backgroundColor: 'rgba(0,0,0,0.7)',
        zIndex: 9999,
        overflowY: 'auto',
        padding: '1rem',
      }}
    >
      <div
        className="bg-white rounded-3 shadow-lg p-4"
        style={{ maxWidth: '480px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}
      >
        {submitted ? (
          <div className="text-center">
            <CheckIcon />
            <h3 className="h5 mb-2 mt-2">{t('thankYou')}</h3>
          </div>
        ) : detect === 'loading' ? (
          <div className="text-center text-muted py-4">…</div>
        ) : (
          <>
            <h3 className="h5 mb-3 text-center">{t('title')}</h3>
            <QuestionnaireForm
              eventSlug={eventSlug}
              placement="POST_EVENT"
              accessToken={accessToken}
              guestId={guestId}
              variant="feedback"
              hideHeader
              submitLabel={t('submit')}
              submittingLabel={t('submitting')}
              onSubmitted={() => setSubmitted(true)}
            />
            <div className="text-center mt-3">
              <button
                type="button"
                className="btn btn-link text-muted small"
                onClick={onClose}
              >
                {t('skip')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#008758"
      strokeWidth="2"
      aria-hidden="true"
      className="mx-auto d-block"
    >
      <circle cx="12" cy="12" r="10" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12.5l2.5 2.5L16 9" />
    </svg>
  );
}
