'use client';

import { useState, useCallback, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Card,
  CardBody,
  FormGroup,
  Icon,
  Input,
  Spinner,
} from 'design-react-kit';

interface GuestJoinFormProps {
  eventTitle: string;
  eventSlug: string;
  onJoined: (credentials: {
    jwt: string;
    roomName: string;
    displayName: string;
    role: string;
  }) => void;
}

export default function GuestJoinForm({
  eventTitle,
  eventSlug,
  onJoined,
}: GuestJoinFormProps) {
  const t = useTranslations('live');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) return;

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch(`/api/events/${eventSlug}/jitsi/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestName: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? t('connectionError'));
        return;
      }

      const data = await res.json();
      onJoined(data);
    } catch {
      setError(t('connectionError'));
    } finally {
      setSubmitting(false);
    }
  }, [name, eventSlug, onJoined, t]);

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-6 col-xl-5">
          <Card className="shadow-sm border-0" style={{ borderRadius: 12 }}>
            <CardBody className="p-4 p-md-5">
              <div className="text-center mb-4">
                <div
                  className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle"
                  style={{
                    width: 56,
                    height: 56,
                    background: 'linear-gradient(135deg, #008758, #004D2F)',
                  }}
                >
                  <Icon icon="it-video" size="sm" color="white" />
                </div>
                <h1 className="h4 fw-bold mb-1" style={{ color: '#17324D' }}>
                  {eventTitle}
                </h1>
                <p className="text-muted mb-0">{t('guestJoinSubtitle')}</p>
              </div>

              {error && (
                <Alert color="danger" className="mb-3">
                  {error}
                </Alert>
              )}

              <form onSubmit={handleSubmit}>
                <FormGroup className="mb-4">
                  <Input
                    id="guest-name"
                    label={t('preJoinNameLabel')}
                    type="text"
                    value={name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setName(e.target.value)
                    }
                    required
                    minLength={2}
                    maxLength={100}
                  />
                </FormGroup>

                <Button
                  color="success"
                  type="submit"
                  size="lg"
                  className="w-100 fw-semibold"
                  disabled={name.trim().length < 2 || submitting}
                >
                  {submitting ? (
                    <Spinner active small className="me-2" />
                  ) : (
                    <Icon icon="it-video" size="sm" color="white" className="me-2" />
                  )}
                  {t('guestJoinButton')}
                </Button>
              </form>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
