'use client';

/**
 * Card "Pipeline AI post-produzione" per la status page pubblica.
 *
 * Graceful degradation: quando l'endpoint ritorna `status: 'disabled'`
 * (kill-switch off su `SiteSetting.aiPipelineEnabled`) NON renderizza
 * NULLA — la card scompare dalla status page invece di mostrare un
 * placeholder vuoto. Coerente col pattern del nodo postprod nella
 * `InfrastructureMap` (che già appare/scompare dinamicamente).
 *
 * Polling allineato al resto della dashboard (30s — stesso intervallo
 * di `StatusDashboard.fetchStatus`) così le due viste mostrano lo
 * stesso snapshot temporale.
 *
 * Tutto live dal endpoint `/api/status/postprod` — nessun valore
 * statico o mocked.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { Badge, Card, CardBody, Icon } from 'design-react-kit';

const POLL_INTERVAL_MS = 30_000;

type PipelineStatus = 'disabled' | 'idle' | 'running' | 'degraded';

interface PostprodStatus {
  status: PipelineStatus;
  queue: {
    byStatus: Record<string, number>;
    total: number;
  };
  recordings: {
    queued: number;
    running: number;
    done: number;
    partial: number;
    failed: number;
  };
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  artifactsByType: Record<string, number>;
  config: {
    llmProvider: string;
    asrProvider: string;
    defaultTargetLocales: string[];
    maxConcurrentJobs: number;
    artifactRetentionDays: number;
  };
  events: {
    aiEnabledCount: number;
    summaryEnabledCount: number;
    translationEnabledCount: number;
  };
  lastChecked: string;
}

/** Mappatura status → coppia (colore badge, colore accent). I colori
 *  riusano la palette già definita in `infrastructure-map.tsx` per
 *  coerenza visiva con la mappa sopra. */
const STATUS_THEME: Record<
  Exclude<PipelineStatus, 'disabled'>,
  { badgeColor: 'success' | 'primary' | 'warning'; accent: string; bg: string }
> = {
  idle: { badgeColor: 'success', accent: '#008758', bg: '#e8f5e9' },
  running: { badgeColor: 'primary', accent: '#0066CC', bg: '#e3f2fd' },
  degraded: { badgeColor: 'warning', accent: '#A66300', bg: '#fff3e0' },
};

export default function PostprodStatusCard() {
  const t = useTranslations('status.postprod');
  const format = useFormatter();
  const [data, setData] = useState<PostprodStatus | null>(null);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/status/postprod', {
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      const json = (await res.json()) as PostprodStatus;
      setData(json);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Graceful degradation #1: errore fetch (es. endpoint 500). Non
  // mostriamo nulla per evitare di sporcare la status page con un
  // "errore" su una feature opzionale. Gli alert reali sono coperti
  // dal nodo infrastruttura `postprod` quando appare.
  if (error || !data) return null;

  // Graceful degradation #2: pipeline disabled (kill-switch off).
  // Niente UI — l'admin che non ha attivato la feature non vede
  // nessuna card AI sulla status page pubblica.
  if (data.status === 'disabled') return null;

  const theme = STATUS_THEME[data.status];
  const queue = data.queue.byStatus;
  const pending = queue.PENDING ?? 0;
  const claimed = queue.CLAIMED ?? 0;
  const running = queue.RUNNING ?? 0;
  const done = queue.DONE ?? 0;
  const failed = queue.FAILED ?? 0;
  const inFlight = pending + claimed + running;

  // Bar segmenti queue (visualizza la composizione del backlog).
  // Mostrata solo se c'è almeno un job non-terminale; altrimenti la
  // card è "idle" e mostra un check verde + ultimo successo.
  const totalForBar = inFlight + done + failed;
  const seg = (n: number) =>
    totalForBar > 0 ? Math.max(2, (n / totalForBar) * 100) : 0;

  const artifactsTotal = Object.values(data.artifactsByType).reduce(
    (a, b) => a + b,
    0,
  );

  return (
    <Card className="h-100 border-0 shadow-sm">
      <CardBody className="p-4">
        {/* Header con titolo + status pill */}
        <div className="d-flex justify-content-between align-items-start mb-1">
          <h5 className="fw-semibold mb-0">
            <Icon icon="it-presentation" size="sm" className="me-2" />
            {t('title')}
          </h5>
          <Badge
            color={theme.badgeColor}
            pill
            style={{ fontSize: '0.72rem', padding: '4px 10px' }}
          >
            {t(`status.${data.status}`)}
          </Badge>
        </div>

        {/* Sottotitolo: enumerazione concisa delle fasi della pipeline,
            così il visitatore capisce subito a cosa serve la card. */}
        <p
          className="text-muted mb-2"
          style={{ fontSize: '0.78rem', letterSpacing: 0.2 }}
        >
          {t('subtitle')}
        </p>

        {/* Cosa fa, in una riga lunga: stack europeo, GPU on-demand,
            niente API esterne. Più informativo del solo aiBadge. */}
        <p
          className="mb-3"
          style={{ fontSize: '0.8rem', color: '#3B4A57', lineHeight: 1.5 }}
        >
          {t('whatItDoes')}
        </p>

        {/* Disclaimer AI Act Art. 50 — sempre visibile quando la card
            è renderizzata, perché significa che l'admin ha attivato la
            pipeline. Estetica nota in box laterale invece di icona-i
            inline (che duplicava quella implicita di Bootstrap Italia
            nei contesti alert; vedi feedback_bootstrap-italia-alert). */}
        <p
          className="mb-3 p-2 rounded"
          style={{
            fontSize: '0.76rem',
            color: '#5A768A',
            background: '#f5f7f9',
            borderLeft: '3px solid #0066CC',
          }}
        >
          {t('aiBadge')}
        </p>

        {/* Stato della coda: bar visiva + counter per stato. Quando
            la pipeline è idle (totale 0) mostriamo un messaggio
            "nessun lavoro in corso", altrimenti la composizione. */}
        {totalForBar > 0 ? (
          <>
            <div
              className="progress mb-2"
              style={{ height: 14, borderRadius: 7, overflow: 'hidden' }}
              role="meter"
              aria-label={t('queueAriaLabel')}
            >
              {pending > 0 && (
                <div
                  className="progress-bar"
                  style={{
                    width: `${seg(pending)}%`,
                    backgroundColor: '#5A768A',
                  }}
                  title={`${t('queuePending')}: ${pending}`}
                />
              )}
              {(claimed + running) > 0 && (
                <div
                  className="progress-bar progress-bar-striped progress-bar-animated"
                  style={{
                    width: `${seg(claimed + running)}%`,
                    backgroundColor: '#0066CC',
                  }}
                  title={`${t('queueRunning')}: ${claimed + running}`}
                />
              )}
              {done > 0 && (
                <div
                  className="progress-bar"
                  style={{ width: `${seg(done)}%`, backgroundColor: '#008758' }}
                  title={`${t('queueDone')}: ${done}`}
                />
              )}
              {failed > 0 && (
                <div
                  className="progress-bar"
                  style={{ width: `${seg(failed)}%`, backgroundColor: '#CC334D' }}
                  title={`${t('queueFailed')}: ${failed}`}
                />
              )}
            </div>

            {/* Legenda chips — solo gli stati con valore > 0, niente rumore. */}
            <div className="d-flex flex-wrap gap-2 mb-3" style={{ fontSize: '0.78rem' }}>
              {pending > 0 && (
                <QueueChip color="#5A768A" label={t('queuePending')} value={pending} />
              )}
              {(claimed + running) > 0 && (
                <QueueChip color="#0066CC" label={t('queueRunning')} value={claimed + running} />
              )}
              {done > 0 && (
                <QueueChip color="#008758" label={t('queueDone')} value={done} />
              )}
              {failed > 0 && (
                <QueueChip color="#CC334D" label={t('queueFailed')} value={failed} />
              )}
            </div>
          </>
        ) : (
          <div
            className="mb-3 p-3 rounded"
            style={{ background: theme.bg, fontSize: '0.86rem' }}
          >
            <Icon icon="it-check-circle" size="sm" className="me-2" color="success" />
            {t('idleMessage')}
          </div>
        )}

        {/* Stack info (provider + lingue) — sempre visibile. */}
        <div className="row g-2" style={{ fontSize: '0.82rem' }}>
          <div className="col-6">
            <div className="text-muted" style={{ fontSize: '0.72rem' }}>
              {t('asrProvider')}
            </div>
            <div className="fw-semibold">{data.config.asrProvider}</div>
          </div>
          <div className="col-6">
            <div className="text-muted" style={{ fontSize: '0.72rem' }}>
              {t('llmProvider')}
            </div>
            <div className="fw-semibold">{data.config.llmProvider}</div>
          </div>
          {data.config.defaultTargetLocales.length > 0 && (
            <div className="col-12 mt-2">
              <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                {t('targetLocales')}
              </div>
              <div className="d-flex flex-wrap gap-1 mt-1">
                {data.config.defaultTargetLocales.map((lang) => (
                  <Badge
                    key={lang}
                    color=""
                    style={{
                      fontSize: '0.7rem',
                      backgroundColor: '#eceff1',
                      color: '#37474F',
                      padding: '2px 8px',
                    }}
                  >
                    {lang.toUpperCase()}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Last success/failure + artifact totals — il "footer" della
            card. Stile più compatto, info di contesto operativo. */}
        <hr style={{ margin: '1rem 0', borderColor: '#eceff1' }} />
        <div style={{ fontSize: '0.78rem', color: '#5A768A' }}>
          {data.lastSuccessAt && (
            <div className="mb-1">
              <Icon icon="it-check" size="xs" className="me-1" color="success" />
              {t('lastSuccess', {
                when: format.relativeTime(new Date(data.lastSuccessAt)),
              })}
            </div>
          )}
          {data.lastFailureAt && data.status === 'degraded' && (
            <div className="mb-1">
              <Icon icon="it-warning-circle" size="xs" className="me-1" color="warning" />
              {t('lastFailure', {
                when: format.relativeTime(new Date(data.lastFailureAt)),
              })}
            </div>
          )}
          {artifactsTotal > 0 && (
            <div>
              <Icon icon="it-files" size="xs" className="me-1" />
              {t('artifactsProduced', { count: artifactsTotal })}
            </div>
          )}
          {data.events.aiEnabledCount > 0 && (
            <div>
              <Icon icon="it-calendar" size="xs" className="me-1" />
              {t('eventsEnabled', { count: data.events.aiEnabledCount })}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function QueueChip({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <span
      className="d-inline-flex align-items-center gap-1 px-2 py-1 rounded"
      style={{ background: `${color}15`, color }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: color,
          display: 'inline-block',
        }}
      />
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  );
}
