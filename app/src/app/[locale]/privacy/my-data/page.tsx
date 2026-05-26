'use client';

import {
  useState,
  useCallback,
  useEffect,
  type FormEvent,
} from 'react';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Button,
  Alert,
  Input,
  FormGroup,
  Card,
  CardBody,
  Icon,
} from 'design-react-kit';

import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

interface ExportEventData {
  title: Record<string, string>;
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
  const locale = useLocale();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState<ExportEntry[] | null>(null);

  // When the user lands here via the signed link emailed to them, the
  // URL carries ?t=<token>. We then fetch the data directly.
  const token = searchParams.get('t');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(
          `/api/gdpr/export?t=${encodeURIComponent(token)}`,
          { cache: 'no-store' },
        );
        if (cancelled) return;
        if (res.status === 429) {
          setError(t('rateLimited'));
          return;
        }
        if (res.status === 400 || res.status === 401) {
          setError(t('linkInvalid'));
          return;
        }
        if (!res.ok) {
          setError(t('error'));
          return;
        }
        const json = await res.json();
        setResults(json.data);
      } catch {
        if (!cancelled) setError(t('error'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError('');
      setSubmitted(false);

      if (!email.trim() || !email.includes('@')) {
        setError(t('emailInvalid'));
        return;
      }

      setLoading(true);
      try {
        const res = await fetch('/api/gdpr/export/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), locale }),
        });
        if (res.status === 429) {
          setError(t('rateLimited'));
          return;
        }
        if (!res.ok) {
          setError(t('error'));
          return;
        }
        setSubmitted(true);
      } catch {
        setError(t('error'));
      } finally {
        setLoading(false);
      }
    },
    [email, locale, t],
  );

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-8">
          <h1 className="mb-2">{t('title')}</h1>
          <p className="lead text-muted mb-4">{t('subtitle')}</p>

          {/* ── Step 1 form (only when no token in URL) ── */}
          {!token && (
            <>
            <Card className="shadow-sm border-0 mb-4" style={{ borderRadius: 8, border: '1px solid #e8e8e8' }}>
              <CardBody className="p-4">
                {submitted ? (
                  <Alert color="success" className="mb-0">
                    <h2 className="h5 mb-2">{t('requestSubmittedTitle')}</h2>
                    <p className="mb-0">{t('requestSubmittedBody')}</p>
                  </Alert>
                ) : (
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
                )}
              </CardBody>
            </Card>

            {/* GDPR Art. 17 — erasure CTA. Routes to the dedicated
                request page; the email link then lands on
                /privacy/my-data/erasure to confirm. */}
            <Card className="shadow-sm border-0 mb-4" style={{ borderRadius: 8, border: '1px solid #e8e8e8' }}>
              <CardBody className="p-4">
                <h2 className="h5 mb-2">{t('erasureCtaTitle')}</h2>
                <p className="text-muted mb-3" style={{ fontSize: '0.95rem' }}>
                  {t('erasureCtaBody')}
                </p>
                <Link
                  className="btn btn-outline-danger"
                  href={`/${locale}/privacy/my-data/erasure`}
                >
                  {t('erasureCtaButton')}
                </Link>
              </CardBody>
            </Card>
            </>
          )}

          {/* ── Step 2 results (signed link landing) ── */}
          {token && loading && (
            <Alert color="info">
              <Icon icon="it-info-circle" className="me-2" />
              {t('loading')}
            </Alert>
          )}
          {token && error && (
            <Alert color="danger">
              {error}
              <div className="mt-3">
                <Button color="primary" outline href={`/${locale}/privacy/my-data`}>
                  {t('requestNew')}
                </Button>
              </div>
            </Alert>
          )}

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
                      {getLocalized(entry.event.title as LocalizedField, locale)}
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
