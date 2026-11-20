// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

/**
 * Una richiesta di rimozione: chi la chiede, per quale registrazione, cosa la
 * rimozione non raggiunge, e lo stato. Mentre e' aperta l'amministrazione apre
 * l'editor (l'accesso al video e' in deroga e resta nel registro) oppure la
 * respinge con un motivo.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Badge, Button, Card, CardBody } from 'design-react-kit';

import { useConfirm } from '@/components/ui/confirm-dialog';
import { SkeletonLines } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Link, percorso } from '@/i18n/navigation';
import type { Intervallo, IntervalloProposto } from '@/lib/recording/redaction/intervals';
import { unisciIntervalli } from '@/lib/recording/redaction/intervals';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

import RedactionEditor from './redaction-editor';
import { COLORE_STATO, type StatoRichiesta } from './status';

export interface VistaRichiesta {
  id: string;
  status: StatoRichiesta;
  source: 'self-service' | 'admin';
  name: string | null;
  note: string | null;
  createdAt: string;
  startedAt: string | null;
  closedAt: string | null;
  lastError: string | null;
  proposedIntervals: IntervalloProposto[];
  intervals: Intervallo[];
  job: { status: string } | null;
  event: { id: string; title: unknown; startsAt: string };
  recording: {
    id: string;
    durationSec: number | null;
    hasVideo: boolean;
    tracks: number;
  } | null;
  externalCopy: boolean;
  publishedElsewhere: boolean;
  pipelineEnabled: boolean;
}

export default function RequestDetail({ id }: { id: string }) {
  const t = useTranslations('admin.recordingRemovals');
  const fmt = useFormatter();
  const locale = useLocale();
  const confirm = useConfirm();
  const toast = useToast();
  const idForm = useId();
  const [dati, setDati] = useState<{
    request: VistaRichiesta;
    accessAllowed: boolean;
  } | null>(null);
  const [errore, setErrore] = useState<number | null>(null);
  const [aperto, setAperto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [occupato, setOccupato] = useState(false);

  const carica = useCallback(async () => {
    const res = await fetch(`/api/admin/recording-removals/${id}`, { cache: 'no-store' });
    if (!res.ok) {
      setErrore(res.status);
      return;
    }
    setErrore(null);
    setDati((await res.json()) as { request: VistaRichiesta; accessAllowed: boolean });
  }, [id]);

  useEffect(() => {
    void carica();
  }, [carica]);

  async function apri() {
    setOccupato(true);
    try {
      const res = await fetch(`/api/admin/recording-removals/${id}/start`, {
        method: 'POST',
      });
      if (!res.ok) {
        setErrore(res.status);
        return;
      }
      setAperto(true);
      await carica();
    } finally {
      setOccupato(false);
    }
  }

  async function respingi() {
    if (!motivo.trim()) return;
    const ok = await confirm({
      title: t('rejectTitle'),
      message: t('rejectConfirm'),
      confirmLabel: t('reject'),
      danger: true,
    });
    if (!ok) return;
    setOccupato(true);
    try {
      const res = await fetch(`/api/admin/recording-removals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: motivo.trim() }),
      });
      if (!res.ok) {
        setErrore(res.status);
        return;
      }
      await carica();
    } finally {
      setOccupato(false);
    }
  }

  if (!dati) {
    return errore !== null ? (
      <div className="alert alert-danger" role="alert">
        {t('actionError', { code: errore })}
      </div>
    ) : (
      <SkeletonLines lines={6} />
    );
  }

  const r = dati.request;
  const data = (iso: string) =>
    fmt.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const lavorabile = r.status === 'OPEN' || r.status === 'IN_PROGRESS';
  const editorAperto =
    lavorabile && dati.accessAllowed && (aperto || r.status === 'IN_PROGRESS');
  const iniziali =
    r.intervals.length > 0
      ? r.intervals
      : unisciIntervalli(r.proposedIntervals, r.recording?.durationSec ?? null);

  return (
    <>
      <p className="mb-3">
        <Link href={percorso('/admin/recording-removals')}>{t('back')}</Link>
      </p>
      <Card className="border-0 shadow-sm mb-4">
        <CardBody className="p-4">
          <dl className="row mb-0">
            <dt className="col-sm-3">{t('fieldPerson')}</dt>
            <dd className="col-sm-9">{r.name ?? t('unnamed')}</dd>
            <dt className="col-sm-3">{t('fieldEvent')}</dt>
            <dd className="col-sm-9">
              <Link href={percorso(`/admin/events/${r.event.id}`)}>
                {getLocalized(r.event.title as LocalizedField, locale)}
              </Link>{' '}
              · {fmt.dateTime(new Date(r.event.startsAt), { dateStyle: 'medium' })}
            </dd>
            <dt className="col-sm-3">{t('fieldReceived')}</dt>
            <dd className="col-sm-9">{data(r.createdAt)}</dd>
            <dt className="col-sm-3">{t('fieldSource')}</dt>
            <dd className="col-sm-9">{t(`sources.${r.source}`)}</dd>
            <dt className="col-sm-3">{t('fieldStatus')}</dt>
            <dd className="col-sm-9">
              <Badge color={COLORE_STATO[r.status]}>{t(`statuses.${r.status}`)}</Badge>
            </dd>
            {r.note && (
              <>
                <dt className="col-sm-3">{t('fieldNote')}</dt>
                <dd className="col-sm-9" style={{ whiteSpace: 'pre-wrap' }}>
                  {r.note}
                </dd>
              </>
            )}
          </dl>
        </CardBody>
      </Card>

      {errore !== null && (
        <div className="alert alert-danger" role="alert">
          {t('actionError', { code: errore })}
        </div>
      )}
      {!r.recording && <div className="alert alert-info">{t('noRecording')}</div>}
      {r.externalCopy && <div className="alert alert-warning">{t('externalCopy')}</div>}
      {r.publishedElsewhere && (
        <div className="alert alert-warning">{t('publishedElsewhere')}</div>
      )}
      {lavorabile && !r.pipelineEnabled && (
        <div className="alert alert-warning">{t('pipelineOff')}</div>
      )}
      {r.recording && !r.recording.hasVideo && lavorabile && (
        <div className="alert alert-info">{t('noVideo')}</div>
      )}
      {r.lastError && lavorabile && (
        <div className="alert alert-danger" role="alert">
          {t('lastError', { error: r.lastError })}
        </div>
      )}

      {r.status === 'PROCESSING' && (
        <div className="alert alert-info" role="status">
          {t('processing', { status: r.job?.status ?? '—' })}
        </div>
      )}
      {r.status === 'CLOSED' && r.closedAt && (
        <div className="alert alert-success" role="status">
          {t('closed', { date: data(r.closedAt) })}{' '}
          {t('closedIntervals', { count: r.intervals.length })}
        </div>
      )}
      {r.status === 'REJECTED' && r.closedAt && (
        <div className="alert alert-secondary">
          {t('rejected', { date: data(r.closedAt) })}
        </div>
      )}

      {lavorabile && r.recording && (
        <Card className="border-0 shadow-sm mb-4">
          <CardBody className="p-4">
            {!dati.accessAllowed ? (
              <p className="mb-0">{t('keyOnly')}</p>
            ) : editorAperto ? (
              <RedactionEditor
                requestId={r.id}
                hasVideo={r.recording.hasVideo}
                durationSec={r.recording.durationSec}
                proposals={r.proposedIntervals}
                initial={iniziali}
                onSubmitted={(stato) => {
                  if (stato === 'CLOSED') toast.success(t('submitDone'));
                  void carica();
                }}
              />
            ) : (
              <>
                <p>{t('startIntro')}</p>
                <Button color="primary" disabled={occupato} onClick={() => void apri()}>
                  {t('start')}
                </Button>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {lavorabile && (
        <Card className="border-0 shadow-sm mb-4">
          <CardBody className="p-4">
            <h2 className="h6">{t('rejectTitle')}</h2>
            <label htmlFor={`${idForm}-motivo`} className="form-label">
              {t('rejectLabel')}
            </label>
            <textarea
              id={`${idForm}-motivo`}
              className="form-control mb-2"
              rows={2}
              maxLength={2000}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <Button
              color="secondary"
              outline
              disabled={occupato || !motivo.trim()}
              onClick={() => void respingi()}
            >
              {t('reject')}
            </Button>
          </CardBody>
        </Card>
      )}
    </>
  );
}
