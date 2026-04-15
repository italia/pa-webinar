'use client';

/**
 * ProvisioningScreen
 *
 * Rendered when a user lands on /events/[slug]/live and the event is either
 *   - IDLE          (JVB was scaled to zero after inactivity)
 *   - PROVISIONING  (node + bridge are starting up, either from pre-scale
 *                    or from a wake-up triggered by this user)
 *
 * Behaviour:
 *   1. On mount, POST /wake. This flips IDLE → PROVISIONING and is a no-op
 *      if already PROVISIONING/LIVE. Failures are retried silently.
 *   2. Every 5s, poll /lifecycle. When status becomes LIVE, reload the page
 *      so the server component re-renders with the Jitsi iframe.
 *   3. Show different reason text depending on the initial state (idle vs
 *      cold-start) so the user knows why they are waiting.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Card, CardBody, Icon, Progress, Spinner } from 'design-react-kit';

type EventStatus = 'DRAFT' | 'PUBLISHED' | 'PROVISIONING' | 'LIVE' | 'IDLE' | 'ENDED' | 'ARCHIVED';

interface ProvisioningScreenProps {
  slug: string;
  title: string;
  initialStatus: EventStatus;
  /** Was this event IDLE when the user hit the page? Drives messaging. */
  camefromIdle: boolean;
}

const POLL_INTERVAL_MS = 5000;
// Typical cold start on AKS: node autoscaler 2-4 min + JVB boot ~30s
const EXPECTED_PROVISIONING_MS = 3 * 60 * 1000;

export default function ProvisioningScreen({
  slug,
  title,
  initialStatus,
  camefromIdle,
}: ProvisioningScreenProps) {
  const t = useTranslations('provisioning');
  const [status, setStatus] = useState<EventStatus>(initialStatus);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const wokeOnce = useRef(false);

  // 1) Fire /wake once on mount.
  useEffect(() => {
    if (wokeOnce.current) return;
    wokeOnce.current = true;
    fetch(`/api/events/${encodeURIComponent(slug)}/wake`, { method: 'POST' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`wake ${r.status}`);
        const body = (await r.json()) as { status?: EventStatus };
        if (body.status) setStatus(body.status);
      })
      .catch(() => {
        // Transient: the poll loop below will still catch the LIVE state once
        // the scaler runs. Don't block the UI on wake errors.
      });
  }, [slug]);

  // 2) Poll lifecycle until LIVE (or ENDED/error).
  const poll = useCallback(async () => {
    try {
      const r = await fetch(`/api/events/${encodeURIComponent(slug)}/lifecycle`, {
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(`lifecycle ${r.status}`);
      const body = (await r.json()) as { status: EventStatus };
      setStatus(body.status);
      if (body.status === 'LIVE') {
        // Reload so the server renders the full Jitsi client.
        window.location.reload();
        return;
      }
      if (body.status === 'ENDED' || body.status === 'ARCHIVED') {
        setError(t('ended'));
        return;
      }
      setError(null);
    } catch {
      setError(t('tempError'));
    }
  }, [slug, t]);

  useEffect(() => {
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // 3) Elapsed ticker for the progress bar.
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - start), 1000);
    return () => clearInterval(id);
  }, []);

  const progressPct = Math.min(100, Math.round((elapsedMs / EXPECTED_PROVISIONING_MS) * 100));
  const isTerminal = status === 'ENDED' || status === 'ARCHIVED';

  return (
    <div className="container py-5">
      <Card className="shadow-sm">
        <CardBody className="text-center py-5">
          {!isTerminal && (
            <div className="mb-4">
              <Spinner active double label={t('loading')} />
            </div>
          )}

          <h1 className="h3 mb-3">{title}</h1>

          <h2 className="h5 text-muted mb-4">
            {camefromIdle ? t('titleFromIdle') : t('titleColdStart')}
          </h2>

          <p className="lead mb-4">
            {camefromIdle ? t('descriptionFromIdle') : t('descriptionColdStart')}
          </p>

          {!isTerminal && (
            <div className="mx-auto mb-4" style={{ maxWidth: 480 }}>
              <Progress
                value={progressPct}
                label={t('progressLabel', { seconds: Math.round(elapsedMs / 1000) })}
                color="primary"
                role="progressbar"
                aria-valuenow={progressPct}
              />
            </div>
          )}

          {error && (
            <Alert color={isTerminal ? 'warning' : 'info'} className="mx-auto" style={{ maxWidth: 480 }}>
              {error}
            </Alert>
          )}

          <div className="mt-4 d-flex flex-column flex-md-row justify-content-center gap-2">
            <Button color="primary" outline onClick={() => window.location.reload()}>
              <Icon icon="it-refresh" size="sm" /> {t('retry')}
            </Button>
          </div>

          <div className="mt-4 small text-muted">
            {t('scaleToZeroNote')}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
