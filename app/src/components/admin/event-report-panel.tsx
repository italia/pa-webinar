'use client';

/**
 * Il resoconto dell'evento in amministrazione (scheda «Dopo l'evento»): i
 * requisiti, il materiale da cui si scrive, le lingue, la richiesta (a mano,
 * di solito dopo aver raccolto le valutazioni), lo stato del lavoro,
 * l'anteprima e la pubblicazione nella pagina dell'evento.
 */
import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import PostEventReport from '@/components/events/report/post-event-report';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import ToggleSwitch from '@/components/ui/toggle-switch';
import { locales } from '@/i18n/config';
import type { StoredReport } from '@/lib/report/types';
import { localeDisplayName } from '@/lib/utils/locale-display';

interface Stato {
  report: StoredReport | null;
  published: boolean;
  job: { status: string; lastError: string | null; createdAt: string; completedAt: string | null } | null;
  requirements: { ended: boolean; aiEnabled: boolean; retentionEndsAt: string; expired: boolean };
  inputs: {
    transcript: boolean;
    chatMessages: number;
    questions: number;
    polls: number;
    words: number;
    feedback: number;
    agendaReactions: number;
  };
  languages: { source: string; targets: string[] };
}

const IN_CORSO = new Set(['PENDING', 'CLAIMED', 'RUNNING']);

function Requisito({ ok, testo }: { ok: boolean; testo: string }) {
  return (
    <li className="d-flex align-items-start gap-2 small mb-1">
      <span aria-hidden="true" style={{ color: ok ? '#008758' : '#D9364F', fontWeight: 700 }}>
        {ok ? '✓' : '✕'}
      </span>
      <span>{testo}</span>
    </li>
  );
}

export default function EventReportPanel({ eventId, locale }: { eventId: string; locale: string }) {
  const t = useTranslations('admin.eventReport');
  const format = useFormatter();
  const toast = useToast();
  const confirm = useConfirm();
  const [stato, setStato] = useState<Stato | null>(null);
  const [errore, setErrore] = useState(false);
  const [lavoro, setLavoro] = useState(false);
  const [lingue, setLingue] = useState<string[] | null>(null);
  const [anteprima, setAnteprima] = useState(false);
  const [linguaAnteprima, setLinguaAnteprima] = useState<string | null>(null);

  const carica = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/events/${eventId}/report`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const s = (await r.json()) as Stato;
      setStato(s);
      setLingue((attuali) => attuali ?? s.languages.targets);
      setErrore(false);
    } catch {
      setErrore(true);
    }
  }, [eventId]);

  useEffect(() => {
    void carica();
  }, [carica]);

  // Mentre il lavoro e' in coda o in esecuzione, lo stato si rilegge.
  const inCorso = !!stato?.job && IN_CORSO.has(stato.job.status);
  useEffect(() => {
    if (!inCorso) return undefined;
    const id = setInterval(() => void carica(), 10_000);
    return () => clearInterval(id);
  }, [inCorso, carica]);

  async function genera(): Promise<void> {
    if (stato?.report) {
      const ok = await confirm({ title: t('regenerate'), message: t('confirmRegenerate'), confirmLabel: t('regenerate') });
      if (!ok) return;
    }
    setLavoro(true);
    try {
      const r = await fetch(`/api/admin/events/${eventId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetLanguages: lingue ?? [] }),
      });
      if (!r.ok) toast.error(t('failed'));
      else toast.success(t('requested'));
      await carica();
    } catch {
      toast.error(t('failed'));
    } finally {
      setLavoro(false);
    }
  }

  async function pubblica(): Promise<void> {
    if (!stato) return;
    const prossimo = !stato.published;
    setLavoro(true);
    try {
      const r = await fetch(`/api/admin/events/${eventId}/report`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published: prossimo }),
      });
      if (!r.ok) toast.error(t('failed'));
      else setStato({ ...stato, published: prossimo });
    } catch {
      toast.error(t('failed'));
    } finally {
      setLavoro(false);
    }
  }

  if (errore) return <p className="text-danger small mb-0">{t('loadFailed')}</p>;
  if (!stato) return null;

  const { requirements: req, inputs: inp, report } = stato;
  const possibile = req.ended && req.aiEnabled && !req.expired;
  const data = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'long' });
  const lingueResoconto = report ? Object.keys(report.narratives) : [];
  const mostrata = linguaAnteprima && report?.narratives[linguaAnteprima] ? linguaAnteprima : report?.sourceLanguage;

  return (
    <div className="border rounded p-3" style={{ background: '#fff' }}>
      <p className="text-secondary mb-2" style={{ fontSize: '0.9rem', maxWidth: 720 }}>
        {t('intro')}
      </p>
      <p className="small mb-3" style={{ maxWidth: 720 }}>
        {t('afterFeedback')}
      </p>

      <div className="row g-3 mb-3">
        <div className="col-md-6">
          <p className="fw-semibold small mb-1">{t('requirementsTitle')}</p>
          <ul className="list-unstyled mb-0">
            <Requisito ok={req.ended} testo={t('reqEnded')} />
            <Requisito ok={req.aiEnabled} testo={t('reqAi')} />
            <Requisito
              ok={!req.expired}
              testo={req.expired ? t('reqExpired', { date: data(req.retentionEndsAt) }) : t('reqRetention', { date: data(req.retentionEndsAt) })}
            />
          </ul>
        </div>
        <div className="col-md-6">
          <p className="fw-semibold small mb-1">{t('inputsTitle')}</p>
          <ul className="list-unstyled small mb-0">
            <li>{inp.transcript ? t('inputTranscript') : t('inputNoTranscript')}</li>
            <li>{t('inputChat', { count: inp.chatMessages })}</li>
            <li>{t('inputQuestions', { count: inp.questions })}</li>
            <li>{t('inputPolls', { count: inp.polls })}</li>
            <li>{t('inputWords', { count: inp.words })}</li>
            <li>{t('inputFeedback', { count: inp.feedback })}</li>
            <li>{t('inputAgenda', { count: inp.agendaReactions })}</li>
          </ul>
        </div>
      </div>

      <details className="mb-3">
        <summary className="small fw-semibold" style={{ cursor: 'pointer' }}>
          {t('languagesTitle', { language: localeDisplayName(stato.languages.source, locale) })}
        </summary>
        <p className="small text-secondary mt-2 mb-1">{t('targetLanguages')}</p>
        <div className="d-flex flex-wrap gap-3">
          {locales
            .filter((l) => l !== stato.languages.source)
            .map((l) => (
              <label key={l} className="small d-inline-flex align-items-center gap-1">
                <input
                  type="checkbox"
                  checked={(lingue ?? []).includes(l)}
                  onChange={(e) =>
                    setLingue((attuali) =>
                      e.target.checked ? [...(attuali ?? []), l] : (attuali ?? []).filter((x) => x !== l),
                    )
                  }
                />
                {localeDisplayName(l, locale)}
              </label>
            ))}
        </div>
      </details>

      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <button
          type="button"
          className={`btn btn-sm ${report ? 'btn-outline-primary' : 'btn-primary'}`}
          disabled={!possibile || inCorso || lavoro}
          onClick={() => void genera()}
        >
          {lavoro ? '…' : report ? t('regenerate') : t('generate')}
        </button>
        {stato.job && (
          <span className="small" role="status">
            {stato.job.status === 'FAILED'
              ? t('statusFailed', { error: stato.job.lastError ?? '—' })
              : stato.job.status === 'DONE'
                ? stato.job.completedAt
                  ? t('statusDone', { date: data(stato.job.completedAt) })
                  : null
                : stato.job.status === 'RUNNING'
                  ? t('statusRunning')
                  : t('statusQueued')}
          </span>
        )}
      </div>

      {report && (
        <>
          <div className="border rounded p-3 mb-3">
            <div className="d-flex justify-content-between align-items-start">
              <div className="me-3">
                <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
                  {t('publish')}
                </div>
                <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                  {t('publishDesc')}
                </div>
              </div>
              <ToggleSwitch
                label=""
                ariaLabel={t('publish')}
                checked={stato.published}
                onChange={() => void pubblica()}
                disabled={lavoro}
              />
            </div>
          </div>

          <div className="d-flex flex-wrap align-items-center gap-2">
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setAnteprima((v) => !v)}>
              {anteprima ? t('hidePreview') : t('preview')}
            </button>
            {anteprima && lingueResoconto.length > 1 && (
              <label className="small d-inline-flex align-items-center gap-2">
                {t('previewLanguage')}
                <select
                  className="form-select form-select-sm w-auto"
                  value={mostrata}
                  onChange={(e) => setLinguaAnteprima(e.target.value)}
                >
                  {lingueResoconto.map((l) => (
                    <option key={l} value={l}>
                      {localeDisplayName(l, locale)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {anteprima && mostrata && report.narratives[mostrata] && (
            <div className="mt-3">
              <PostEventReport
                hasVideo={false}
                report={{
                  metrics: report.metrics,
                  narrative: report.narratives[mostrata]!,
                  language: mostrata,
                  sourceLanguage: report.sourceLanguage,
                  requestedLanguage: mostrata,
                  generatedAt: report.generatedAt,
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
