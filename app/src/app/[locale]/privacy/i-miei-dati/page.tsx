'use client';

import { useState, useCallback, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Alert,
  Input,
  FormGroup,
  Card,
  CardBody,
  Icon,
} from 'design-react-kit';

interface ExportEventData {
  titleIt: string;
  titleEn: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
}

interface ExportRegistration {
  displayName: string;
  email: string | null;
  organization: string | null;
  organizationRole: string | null;
  organizationType: string | null;
  consentGiven: boolean;
  consentTimestamp: string;
  consentRecording: boolean | null;
  consentFutureCommunications: boolean;
  registeredAt: string;
  joinedAt: string | null;
}

interface ExportQuestion {
  text: string;
  status: string;
  createdAt: string;
}

interface ExportPollVote {
  question: string;
  optionIndex: number;
  createdAt: string;
}

interface ExportEntry {
  registration: ExportRegistration;
  event: ExportEventData;
  questions: ExportQuestion[];
  pollVotes: ExportPollVote[];
}

export default function MyDataPage() {
  const t = useTranslations('gdpr.export');

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<ExportEntry[] | null>(null);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError('');
      setResults(null);

      if (!email.trim() || !email.includes('@')) {
        setError(t('emailInvalid'));
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(
          `/api/gdpr/export?email=${encodeURIComponent(email.trim())}`,
        );
        if (res.status === 429) {
          setError(t('rateLimited'));
          return;
        }
        if (!res.ok) {
          setError(t('error'));
          return;
        }
        const json = await res.json();
        setResults(json.data);
      } catch {
        setError(t('error'));
      } finally {
        setLoading(false);
      }
    },
    [email, t],
  );

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-8">
          <h1 className="mb-2">{t('title')}</h1>
          <p className="lead text-muted mb-4">{t('subtitle')}</p>

          <Card className="shadow-sm border-0 mb-4" style={{ borderRadius: 8, border: '1px solid #e8e8e8' }}>
            <CardBody className="p-4">
              <form onSubmit={handleSubmit}>
                {error && (
                  <Alert color="danger" className="mb-3">
                    {error}
                  </Alert>
                )}
                <FormGroup className="mb-3">
                  <Input
                    type="email"
                    id="gdpr-email"
                    label={t('emailLabel')}
                    placeholder={t('emailPlaceholder')}
                    value={email}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setEmail(e.target.value)
                    }
                    required
                  />
                </FormGroup>
                <Button color="primary" type="submit" disabled={loading}>
                  {loading ? t('loading') : t('submit')}
                </Button>
              </form>
            </CardBody>
          </Card>

          {/* ── Results ── */}
          {results !== null && results.length === 0 && (
            <Alert color="info">
              <Icon icon="it-info-circle" className="me-2" />
              {t('noData')}
            </Alert>
          )}

          {results !== null && results.length > 0 && (
            <div>
              <h2 className="h4 mb-3">{t('results')}</h2>
              <p className="text-muted mb-4" style={{ fontSize: '0.9rem' }}>
                {t('resultsDescription', { count: results.length })}
              </p>

              {results.map((entry, idx) => (
                <Card
                  key={idx}
                  className="shadow-sm border-0 mb-3"
                  style={{ borderRadius: 8, border: '1px solid #e8e8e8' }}
                >
                  <CardBody className="p-4">
                    <h3 className="h5 mb-3">
                      {entry.event.titleIt}
                      {entry.event.titleEn && (
                        <span className="text-muted fw-normal ms-2" style={{ fontSize: '0.85rem' }}>
                          ({entry.event.titleEn})
                        </span>
                      )}
                    </h3>

                    {/* Registration data */}
                    <h4 className="h6 text-secondary mb-2">{t('registrationData')}</h4>
                    <dl className="row mb-3" style={{ fontSize: '0.9rem' }}>
                      <dt className="col-sm-4">{t('fieldName')}</dt>
                      <dd className="col-sm-8">{entry.registration.displayName}</dd>
                      <dt className="col-sm-4">{t('fieldEmail')}</dt>
                      <dd className="col-sm-8">{entry.registration.email ?? '—'}</dd>
                      {entry.registration.organization && (
                        <>
                          <dt className="col-sm-4">{t('fieldOrganization')}</dt>
                          <dd className="col-sm-8">{entry.registration.organization}</dd>
                        </>
                      )}
                      <dt className="col-sm-4">{t('fieldRegisteredAt')}</dt>
                      <dd className="col-sm-8">
                        {new Date(entry.registration.registeredAt).toLocaleString()}
                      </dd>
                      <dt className="col-sm-4">{t('fieldConsent')}</dt>
                      <dd className="col-sm-8">
                        {entry.registration.consentGiven ? '✓' : '✗'}
                        {' — '}
                        {new Date(entry.registration.consentTimestamp).toLocaleString()}
                      </dd>
                    </dl>

                    {/* Questions */}
                    {entry.questions.length > 0 && (
                      <>
                        <h4 className="h6 text-secondary mb-2">
                          {t('questionsTitle')} ({entry.questions.length})
                        </h4>
                        <ul className="list-unstyled mb-3" style={{ fontSize: '0.9rem' }}>
                          {entry.questions.map((q, qi) => (
                            <li key={qi} className="mb-1 ps-2 border-start border-2">
                              <span>{q.text}</span>
                              <span className="text-muted ms-2">({q.status})</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}

                    {/* Poll votes */}
                    {entry.pollVotes.length > 0 && (
                      <>
                        <h4 className="h6 text-secondary mb-2">
                          {t('pollVotesTitle')} ({entry.pollVotes.length})
                        </h4>
                        <ul className="list-unstyled mb-0" style={{ fontSize: '0.9rem' }}>
                          {entry.pollVotes.map((v, vi) => (
                            <li key={vi} className="mb-1 ps-2 border-start border-2">
                              <span className="fw-semibold">{v.question}</span>
                              <span className="text-muted ms-2">
                                — {t('optionLabel')} {v.optionIndex + 1}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
