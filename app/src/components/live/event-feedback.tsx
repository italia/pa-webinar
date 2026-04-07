'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Icon } from 'design-react-kit';

interface EventFeedbackProps {
  eventSlug: string;
  accessToken?: string;
  guestId?: string;
  onClose: () => void;
}

export default function EventFeedback({
  eventSlug,
  accessToken,
  guestId,
  onClose,
}: EventFeedbackProps) {
  const t = useTranslations('feedback');
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [autoCloseSeconds, setAutoCloseSeconds] = useState(30);

  useEffect(() => {
    if (submitted) return;
    const timer = setInterval(() => {
      setAutoCloseSeconds((prev) => {
        if (prev <= 1) {
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [submitted, onClose]);

  const handleSubmit = useCallback(async () => {
    if (rating === 0 || submitting) return;
    setSubmitting(true);

    try {
      await fetch(`/api/events/${eventSlug}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          comment: comment.trim() || undefined,
          accessToken,
          guestId,
        }),
      });
      setSubmitted(true);
      setTimeout(onClose, 2500);
    } catch {
      setSubmitting(false);
    }
  }, [rating, comment, eventSlug, accessToken, guestId, submitting, onClose]);

  const displayRating = hoverRating || rating;

  return (
    <div
      className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 9999 }}
    >
      <div
        className="bg-white rounded-3 shadow-lg p-4 text-center"
        style={{ maxWidth: '420px', width: '90%' }}
      >
        {submitted ? (
          <>
            <Icon icon="it-check-circle" size="xl" className="text-success mb-3" />
            <h3 className="h5 mb-2">{t('thankYou')}</h3>
          </>
        ) : (
          <>
            <h3 className="h5 mb-3">{t('title')}</h3>
            <p className="text-muted small mb-3">{t('ratingLabel')}</p>

            <div className="d-flex justify-content-center gap-2 mb-3">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className="btn btn-link p-0 border-0"
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(star)}
                  aria-label={`${star} ${star === 1 ? 'stella' : 'stelle'}`}
                >
                  <Icon
                    icon={star <= displayRating ? 'it-star-full' : 'it-star-outline'}
                    size="lg"
                    className={star <= displayRating ? 'text-warning' : 'text-muted'}
                  />
                </button>
              ))}
            </div>

            <div className="mb-3">
              <textarea
                className="form-control"
                rows={3}
                maxLength={500}
                placeholder={t('commentPlaceholder')}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <small className="text-muted">{comment.length}/500</small>
            </div>

            <div className="d-flex flex-column gap-2">
              <Button
                color="primary"
                className="w-100"
                onClick={handleSubmit}
                disabled={rating === 0 || submitting}
              >
                {submitting ? t('submitting') : t('submit')}
              </Button>
              <button
                type="button"
                className="btn btn-link text-muted small"
                onClick={onClose}
              >
                {t('skip')} ({autoCloseSeconds}s)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
