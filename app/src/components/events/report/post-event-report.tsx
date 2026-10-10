'use client';

/**
 * Il resoconto dell'evento nella pagina dopo l'evento (lib/report): il testo
 * scritto dal modello linguistico e riletto dallo staff, i numeri e i grafici
 * calcolati dalla piattaforma, la mappa concettuale. Ogni sezione compare
 * solo se ha contenuto.
 */
import type { RefObject } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import type { VideoPlayerHandle } from '@/components/events/video-player';
import type { Agreement, ReportView, Stance } from '@/lib/report/types';
import { localeDisplayName } from '@/lib/utils/locale-display';

import {
  BarreAccordo,
  BarreOrizzontali,
  COLORI,
  Distribuzione,
  GraficoAndamento,
} from './charts';
import ConceptMap from './concept-map';

const secondi = (mmss: string): number | null => {
  const m = mmss.trim().match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};

const COLORE_ACCORDO: Record<Agreement, string> = {
  high: COLORI.verde,
  mixed: '#A66300',
  low: COLORI.rosso,
  unknown: COLORI.secondario,
};

const ICONA_POSIZIONE: Record<Stance, string> = {
  support: '+',
  concern: '!',
  question: '?',
};

function Sezione({
  id,
  titolo,
  children,
}: {
  id: string;
  titolo: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="report-section"
      aria-labelledby={`report-${id}`}
      id={`resoconto-${id}`}
    >
      <h3 id={`report-${id}`} className="h5 fw-semibold mb-3">
        {titolo}
      </h3>
      {children}
    </section>
  );
}

function Elenco({ voci }: { voci: string[] }) {
  if (voci.length === 0) return null;
  return (
    <ul className="report-list mb-0">
      {voci.map((v) => (
        <li key={v}>{v}</li>
      ))}
    </ul>
  );
}

function Paragrafi({ testo }: { testo: string }) {
  return (
    <>
      {testo
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} className="mb-2">
            {p}
          </p>
        ))}
    </>
  );
}

export default function PostEventReport({
  report,
  playerRef,
  hasVideo,
}: {
  report: ReportView;
  playerRef?: RefObject<VideoPlayerHandle | null>;
  hasVideo: boolean;
}) {
  const t = useTranslations('postEvent.report');
  const format = useFormatter();
  const { narrative: n, metrics: m } = report;
  const lingua = (codice: string) => localeDisplayName(codice, report.requestedLanguage);

  const vai = (mmss: string) => {
    const s = secondi(mmss);
    if (s == null || !playerRef?.current) return;
    playerRef.current.seekTo(s, true);
    document
      .getElementById('event-video')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const serie = [
    { chiave: 'chat', etichetta: t('series.chat'), colore: COLORI.primario },
    { chiave: 'questions', etichetta: t('series.questions'), colore: COLORI.verde },
    { chiave: 'polls', etichetta: t('series.polls'), colore: COLORI.ambra },
    { chiave: 'words', etichetta: t('series.words'), colore: COLORI.turchese },
    { chiave: 'reactions', etichetta: t('series.reactions'), colore: COLORI.rosso },
  ];
  const andamento = m?.timeline.buckets ?? [];
  const conAndamento = andamento.some((b) => b.total > 0);
  const agendaReazioni = (m?.agenda ?? []).filter((a) => a.agree + a.disagree > 0);
  const valutazioni = m?.feedback.items ?? [];
  const sondaggi = m?.polls ?? [];
  const numeri = m
    ? [
        { valore: m.attendance.peak, etichetta: t('metrics.peak') },
        {
          valore: m.attendance.joined,
          etichetta: t('metrics.joined'),
          nota:
            m.attendance.conversionPct != null
              ? t('metrics.ofRegistered', { pct: m.attendance.conversionPct })
              : null,
        },
        {
          valore: m.participation.activePeople,
          etichetta: t('metrics.active'),
          nota:
            m.participation.activePct != null
              ? t('metrics.ofPresent', { pct: m.participation.activePct })
              : null,
        },
        { valore: m.participation.interactions, etichetta: t('metrics.interactions') },
        ...(m.feedback.average != null
          ? [
              {
                valore: format.number(m.feedback.average, { maximumFractionDigits: 1 }),
                etichetta: t('metrics.rating'),
                nota: t('metrics.responses', { count: m.feedback.responses }),
              },
            ]
          : []),
      ].filter((x) => x.valore !== 0)
    : [];

  return (
    <section className="report mb-4" aria-labelledby="report-title" id="resoconto">
      <header className="report-header">
        <p className="report-kicker mb-1">{t('title')}</p>
        <h2 id="report-title" className="h3 fw-bold mb-2">
          {n.title || t('title')}
        </h2>
        {n.abstract && <p className="lead mb-3">{n.abstract}</p>}
        <p className="small text-secondary mb-0">
          {t('generatedAt', {
            date: format.dateTime(new Date(report.generatedAt), { dateStyle: 'long' }),
          })}
          {report.language !== report.sourceLanguage &&
            ` · ${t('translated', { language: lingua(report.sourceLanguage) })}`}
        </p>
        {report.language !== report.requestedLanguage && (
          <p className="small text-secondary mb-0">
            {t('languageFallback', { language: lingua(report.language) })}
          </p>
        )}
      </header>

      {n.highlights.length > 0 && (
        <Sezione id="highlights" titolo={t('sections.highlights')}>
          <ul className="report-highlights">
            {n.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </Sezione>
      )}

      {numeri.length > 0 && (
        <Sezione id="numbers" titolo={t('sections.numbers')}>
          <div className="report-figures">
            {numeri.map((x) => (
              <div key={x.etichetta} className="report-figure">
                <div className="report-figure-value">{x.valore}</div>
                <div className="report-figure-label">{x.etichetta}</div>
                {x.nota && <div className="report-figure-note">{x.nota}</div>}
              </div>
            ))}
          </div>
          {n.engagement.summary && <p className="mt-3 mb-2">{n.engagement.summary}</p>}
          <Elenco voci={n.engagement.observations} />
        </Sezione>
      )}

      {conAndamento && m && (
        <Sezione id="timeline" titolo={t('sections.timeline')}>
          <GraficoAndamento
            titolo={t('timelineDesc', {
              minutes: Math.max(1, Math.round(m.timeline.bucketSec / 60)),
            })}
            serie={serie}
            punti={andamento.map((b) => ({
              etichetta: b.label,
              valori: {
                chat: b.chat,
                questions: b.questions,
                polls: b.polls,
                words: b.words,
                reactions: b.reactions,
              },
            }))}
            piccoIndice={m.timeline.peakIndex}
            etichettaTempo={t('timeFromStart')}
          />
          {m.timeline.peakIndex >= 0 && andamento[m.timeline.peakIndex] && (
            <p className="small text-secondary mt-2 mb-0">
              {t('peak', { label: andamento[m.timeline.peakIndex]!.label })}
            </p>
          )}
        </Sezione>
      )}

      {n.topics.length > 0 && (
        <Sezione id="topics" titolo={t('sections.topics')}>
          <ol className="report-topics">
            {n.topics.map((tema) => (
              <li key={tema.title} className="report-topic">
                <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
                  <h4 className="h6 fw-semibold mb-0">{tema.title}</h4>
                  <span
                    className="report-badge"
                    style={{
                      color: COLORE_ACCORDO[tema.agreement],
                      borderColor: COLORE_ACCORDO[tema.agreement],
                    }}
                  >
                    {t(`agreement.${tema.agreement}`)}
                  </span>
                  {tema.start && hasVideo && (
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0 report-seek"
                      onClick={() => vai(tema.start!)}
                    >
                      {t('goTo', { time: tema.start })}
                    </button>
                  )}
                </div>
                {tema.explanation && <p className="mb-2">{tema.explanation}</p>}
                <Elenco voci={tema.keyPoints} />
                {tema.positions.length > 0 && (
                  <ul className="report-positions mt-2 mb-0">
                    {tema.positions.map((p) => (
                      <li
                        key={p.text}
                        className={`report-position report-position-${p.stance}`}
                      >
                        <span className="report-position-icon" aria-hidden="true">
                          {ICONA_POSIZIONE[p.stance]}
                        </span>
                        <span className="visually-hidden">
                          {t(`stance.${p.stance}`)}:{' '}
                        </span>
                        {p.text}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </Sezione>
      )}

      {n.conceptMap.nodes.length >= 3 && (
        <Sezione id="map" titolo={t('sections.map')}>
          <ConceptMap
            mappa={n.conceptMap}
            titolo={n.title}
            descrizione={t('mapDesc')}
            legenda={{
              topic: t('kind.topic'),
              concept: t('kind.concept'),
              actor: t('kind.actor'),
              outcome: t('kind.outcome'),
            }}
          />
        </Sezione>
      )}

      {(n.consensus.summary || agendaReazioni.length > 0) && (
        <Sezione id="consensus" titolo={t('sections.consensus')}>
          {n.consensus.summary && <p>{n.consensus.summary}</p>}
          {agendaReazioni.length > 0 && (
            <div className="mb-3">
              <p className="small text-secondary mb-2">{t('agendaReactions')}</p>
              <BarreAccordo
                titolo={t('agendaReactions')}
                voci={agendaReazioni.map((a) => ({
                  etichetta: a.label,
                  accordo: a.agree,
                  disaccordo: a.disagree,
                }))}
                etichettaAccordo={t('agree')}
                etichettaDisaccordo={t('disagree')}
              />
            </div>
          )}
          <div className="row g-3">
            {n.consensus.agreements.length > 0 && (
              <div className="col-md-6">
                <p className="fw-semibold mb-1" style={{ color: COLORI.verde }}>
                  {t('agreements')}
                </p>
                <Elenco voci={n.consensus.agreements} />
              </div>
            )}
            {n.consensus.disagreements.length > 0 && (
              <div className="col-md-6">
                <p className="fw-semibold mb-1" style={{ color: COLORI.rosso }}>
                  {t('disagreements')}
                </p>
                <Elenco voci={n.consensus.disagreements} />
              </div>
            )}
          </div>
        </Sezione>
      )}

      {sondaggi.length > 0 && (
        <Sezione id="polls" titolo={t('sections.polls')}>
          {sondaggi.map((p) => (
            <div key={p.question} className="mb-3">
              <p className="fw-semibold mb-2">
                {p.question}{' '}
                <span className="fw-normal text-secondary small">
                  · {t('votes', { count: p.totalVotes })}
                </span>
              </p>
              <BarreOrizzontali
                titolo={p.question}
                voci={p.options.map((o) => ({ etichetta: o.text, valore: o.votes }))}
                formato={(v, quota) => (quota != null ? `${quota}% · ${v}` : String(v))}
              />
            </div>
          ))}
        </Sezione>
      )}

      {(valutazioni.length > 0 || n.feedback.summary) && (
        <Sezione id="feedback" titolo={t('sections.feedback')}>
          {n.feedback.summary && <p>{n.feedback.summary}</p>}
          {valutazioni.map((v) => (
            <Distribuzione
              key={v.prompt}
              titolo={v.prompt}
              scalaMin={v.scaleMin}
              distribuzione={v.distribution}
              descrizione={
                <>
                  <span className="fw-semibold">{v.prompt}</span>
                  {v.average != null && (
                    <span className="text-secondary">
                      {' '}
                      ·{' '}
                      {t('average', {
                        value: format.number(v.average, { maximumFractionDigits: 1 }),
                        max: v.scaleMax,
                      })}
                    </span>
                  )}
                </>
              }
            />
          ))}
          <div className="row g-3">
            {n.feedback.strengths.length > 0 && (
              <div className="col-md-6">
                <p className="fw-semibold mb-1">{t('strengths')}</p>
                <Elenco voci={n.feedback.strengths} />
              </div>
            )}
            {n.feedback.improvements.length > 0 && (
              <div className="col-md-6">
                <p className="fw-semibold mb-1">{t('improvements')}</p>
                <Elenco voci={n.feedback.improvements} />
              </div>
            )}
          </div>
          {n.feedback.quotes.length > 0 && (
            <div className="mt-3">
              <p className="fw-semibold mb-1">{t('quotes')}</p>
              {n.feedback.quotes.map((q) => (
                <blockquote key={q} className="report-quote">
                  {q}
                </blockquote>
              ))}
            </div>
          )}
        </Sezione>
      )}

      {(n.benefits.summary || n.benefits.items.length > 0) && (
        <Sezione id="benefits" titolo={t('sections.benefits')}>
          {n.benefits.summary && <p>{n.benefits.summary}</p>}
          <Elenco voci={n.benefits.items} />
        </Sezione>
      )}

      {(n.openQuestions.length > 0 || n.nextSteps.length > 0) && (
        <div className="row g-3">
          {n.openQuestions.length > 0 && (
            <div className="col-md-6">
              <Sezione id="open" titolo={t('sections.openQuestions')}>
                <Elenco voci={n.openQuestions} />
              </Sezione>
            </div>
          )}
          {n.nextSteps.length > 0 && (
            <div className="col-md-6">
              <Sezione id="next" titolo={t('sections.nextSteps')}>
                <Elenco voci={n.nextSteps} />
              </Sezione>
            </div>
          )}
        </div>
      )}

      {n.summary && (
        <details className="report-section report-full">
          <summary className="fw-semibold">{t('sections.summary')}</summary>
          <div className="mt-3">
            <Paragrafi testo={n.summary} />
          </div>
        </details>
      )}

      <p className="report-notice small mb-0">{t('aiNotice')}</p>
    </section>
  );
}
