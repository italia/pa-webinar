'use client';

/**
 * Le valutazioni dell'evento nella sua pagina in amministrazione: per ogni
 * domanda la media e la distribuzione delle risposte, poi tutti i commenti,
 * e il CSV con ogni risposta. Senza nomi: la sala promette risposte anonime
 * per chi organizza (GET /api/admin/events/{id}/feedback).
 */

import { useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import useSWR from 'swr';

import type { EventFeedbackReport, FeedbackItemStats } from '@/lib/feedback/event-feedback-report';

const COMMENTI_VISIBILI = 8;

const fetcher = ([url, token]: [string, string | null]): Promise<EventFeedbackReport> =>
  fetch(url, {
    credentials: 'include',
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<EventFeedbackReport>;
  });

function testo(m: Record<string, string> | null | undefined, locale: string): string {
  if (!m) return '';
  return m[locale] || m.it || Object.values(m)[0] || '';
}

export default function EventFeedbackPanel({
  eventId,
  token = null,
}: {
  eventId: string;
  /** Il token del moderatore, quando la pagina si e' aperta dal suo link. */
  token?: string | null;
}) {
  const t = useTranslations('admin.feedbackPanel');
  const locale = useLocale();
  const format = useFormatter();
  const [tuttiCommenti, setTuttiCommenti] = useState(false);
  const [scaricando, setScaricando] = useState(false);
  const { data, error, isLoading } = useSWR(
    [`/api/admin/events/${eventId}/feedback`, token] as [string, string | null],
    fetcher,
    { refreshInterval: 60_000 },
  );

  // Il CSV passa dalla stessa richiesta autenticata: il token non finisce in
  // un indirizzo (cronologia, intestazioni Referer).
  const scaricaCsv = async () => {
    setScaricando(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/feedback?format=csv&locale=${locale}`, {
        credentials: 'include',
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `valutazioni-${eventId.slice(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.alert(t('downloadFailed'));
    } finally {
      setScaricando(false);
    }
  };

  if (isLoading) return <p className="text-muted mb-0">{t('loading')}</p>;
  if (error || !data) return <p className="text-danger mb-0">{t('loadFailed')}</p>;

  const totale = data.responses.length;
  const commenti = data.responses.flatMap((r) =>
    data.items
      .filter((it) => it.type === 'OPEN_TEXT')
      .map((it) => ({ id: `${r.id}-${it.id}`, prompt: it.prompt, text: r.answers[it.id]?.text, at: r.submittedAt }))
      .filter((c): c is { id: string; prompt: Record<string, string>; text: string; at: string } => !!c.text),
  );
  const piuDomandeAperte = data.items.filter((it) => it.type === 'OPEN_TEXT').length > 1;
  const commentiMostrati = tuttiCommenti ? commenti : commenti.slice(0, COMMENTI_VISIBILI);

  return (
    <div className="feedback-panel">
      <div className="feedback-panel__head">
        <p className="feedback-panel__count">
          {totale === 0 ? t('empty') : t('responses', { count: totale })}
        </p>
        {totale > 0 && (
          <button type="button" className="btn btn-outline-primary btn-sm" onClick={scaricaCsv} disabled={scaricando}>
            {t('downloadCsv')}
          </button>
        )}
      </div>
      {!data.enabled && <p className="feedback-panel__note">{t('disabled')}</p>}

      {totale > 0 && (
        <div className="feedback-panel__items">
          {data.items
            .filter((it) => it.type !== 'OPEN_TEXT')
            .map((it) => (
              <ItemStats key={it.id} item={it} locale={locale} />
            ))}
        </div>
      )}

      {commenti.length > 0 && (
        <section className="feedback-panel__comments" aria-labelledby={`fb-comments-${eventId}`}>
          <h3 className="feedback-panel__subtitle" id={`fb-comments-${eventId}`}>
            {t('commentsTitle', { count: commenti.length })}
          </h3>
          <ul className="feedback-panel__list">
            {commentiMostrati.map((c) => (
              <li key={c.id} className="feedback-panel__comment">
                {piuDomandeAperte && <span className="feedback-panel__comment-q">{testo(c.prompt, locale)}</span>}
                <p className="mb-1">{c.text}</p>
                <span className="feedback-panel__meta">
                  {format.dateTime(new Date(c.at), { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </li>
            ))}
          </ul>
          {commenti.length > COMMENTI_VISIBILI && (
            <button type="button" className="btn btn-link px-0" onClick={() => setTuttiCommenti((v) => !v)}>
              {tuttiCommenti ? t('showFewer') : t('showAll', { count: commenti.length })}
            </button>
          )}
        </section>
      )}

      {data.legacy.count > 0 && (
        <section className="feedback-panel__legacy">
          <h3 className="feedback-panel__subtitle">{t('legacyTitle')}</h3>
          <p className="feedback-panel__note">
            {t('legacySummary', {
              count: data.legacy.count,
              average: format.number(data.legacy.average ?? 0, { maximumFractionDigits: 1 }),
            })}
          </p>
          <ul className="feedback-panel__list">
            {data.legacy.entries
              .filter((e) => e.comment)
              .map((e, i) => (
                <li key={i} className="feedback-panel__comment">
                  <p className="mb-1">{e.comment}</p>
                  <span className="feedback-panel__meta">
                    {t('legacyRating', { rating: e.rating })} ·{' '}
                    {format.dateTime(new Date(e.createdAt), { dateStyle: 'medium' })}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ItemStats({ item, locale }: { item: FeedbackItemStats; locale: string }) {
  const t = useTranslations('admin.feedbackPanel');
  const format = useFormatter();
  const dist = item.distribution ?? [];
  const massimo = Math.max(1, ...dist);
  const etichette: string[] =
    item.type === 'LIKERT'
      ? dist.map((_, i) => String((item.scaleMin ?? 1) + i))
      : item.type === 'YES_NO'
        ? [t('no'), t('yes')]
        : (item.options ?? []).map((o) => testo(o, locale));
  // Scala: dal voto piu' alto al piu' basso, come si legge una pagella.
  const ordine = item.type === 'LIKERT' ? dist.map((_, i) => dist.length - 1 - i) : dist.map((_, i) => i);
  return (
    <div className="feedback-item">
      <div className="feedback-item__head">
        <span className="feedback-item__prompt">{testo(item.prompt, locale)}</span>
        {item.type === 'LIKERT' && item.average != null && (
          <span className="feedback-item__avg">
            {t('average', {
              value: format.number(item.average, { maximumFractionDigits: 1 }),
              max: item.scaleMax ?? 5,
            })}
          </span>
        )}
        {item.type === 'YES_NO' && item.average != null && (
          <span className="feedback-item__avg">{t('yesShare', { pct: Math.round(item.average * 100) })}</span>
        )}
      </div>
      {item.type === 'LIKERT' && (item.scaleMinLabel || item.scaleMaxLabel) && (
        <span className="feedback-item__scale">
          {(item.scaleMin ?? 1)} = {testo(item.scaleMinLabel, locale)} · {(item.scaleMax ?? 5)} ={' '}
          {testo(item.scaleMaxLabel, locale)}
        </span>
      )}
      <ul className="feedback-item__bars">
        {ordine.map((i) => (
          <li key={i} className="feedback-item__bar">
            <span className="feedback-item__label">{etichette[i]}</span>
            <span className="feedback-item__track" aria-hidden="true">
              <span className="feedback-item__fill" style={{ width: `${((dist[i] ?? 0) / massimo) * 100}%` }} />
            </span>
            <span className="feedback-item__n">{dist[i] ?? 0}</span>
          </li>
        ))}
      </ul>
      <span className="feedback-item__answered">{t('answered', { count: item.answered })}</span>
    </div>
  );
}
