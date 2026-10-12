'use client';

/**
 * Admin dashboard for questionnaire responses.
 *
 * Filters: event, placement, date range. For each matching questionnaire
 * the server pre-computes item-level aggregates (distribution, average,
 * text samples); the client just visualises them. Charts are native
 * CSS bars — no chart library — to keep the bundle small.
 */

import { useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Card, CardBody, Input, Label } from 'design-react-kit';

import { SkeletonLines } from '@/components/ui/skeleton';
import { getLocalized } from '@/lib/utils/locale';

type Placement = 'PRE_REGISTRATION' | 'POST_EVENT';

interface Row {
  id: string;
  event: { id: string; slug: string; title: Record<string, string> };
  placement: Placement;
  title: Record<string, string>;
  responseCount: number;
  items: ItemAgg[];
}

interface ItemAgg {
  itemId: string;
  prompt: Record<string, string>;
  type: 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'YES_NO' | 'LIKERT' | 'OPEN_TEXT';
  summary: {
    type: string;
    totalAnswered: number;
    distribution?: { idx?: number; value?: number; label?: Record<string, string>; count: number }[];
    yes?: number;
    no?: number;
    average?: number | null;
    samples?: string[];
  };
}

export default function QuestionnaireResponsesDashboard() {
  const t = useTranslations('admin.questionnaireResponses');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [placement, setPlacement] = useState<string>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Gli eventi del filtro si accumulano da tutti i risultati visti: ricavati
  // solo dai risultati correnti, dopo una scelta (o un intervallo di date)
  // l'elenco si restringeva e restava ristretto.
  const [events, setEvents] = useState<{ id: string; label: string }[]>([]);
  const [eventId, setEventId] = useState<string>('');

  // Ogni cambio di filtro ricarica: niente pulsante «Filtra».
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams();
    if (eventId) qs.set('eventId', eventId);
    if (placement) qs.set('placement', placement);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    fetch(`/api/admin/questionnaire-responses?${qs}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { rows: Row[] };
        if (cancelled) return;
        setRows(data.rows);
        setFailed(false);
        setEvents((prima) => {
          const uniq = new Map(prima.map((e) => [e.id, e.label]));
          for (const r of data.rows) {
            uniq.set(r.event.id, getLocalized(r.event.title, locale) || r.event.slug);
          }
          return [...uniq.entries()]
            .map(([id, label]) => ({ id, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, placement, from, to, locale]);

  return (
    <div>
      <Card className="shadow-sm border-0 mb-4" style={{ borderRadius: 8 }}>
        <CardBody className="p-3">
          <div className="row g-3 align-items-end">
            <div className="col-md-4">
              <Label for="qr-event">{t('event')}</Label>
              <select
                id="qr-event"
                className="form-select"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
              >
                <option value="">{t('allEvents')}</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-4">
              <Label for="qr-placement">{t('placement')}</Label>
              <select
                id="qr-placement"
                className="form-select"
                value={placement}
                onChange={(e) => setPlacement(e.target.value)}
              >
                <option value="">{t('allPlacements')}</option>
                <option value="PRE_REGISTRATION">{t('placementPre')}</option>
                <option value="POST_EVENT">{t('placementPost')}</option>
              </select>
            </div>
            <div className="col-md-2">
              <Label for="qr-from">{t('from')}</Label>
              <Input
                id="qr-from"
                type="date"
                value={from}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)}
              />
            </div>
            <div className="col-md-2">
              <Label for="qr-to">{t('to')}</Label>
              <Input
                id="qr-to"
                type="date"
                value={to}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <SkeletonLines lines={5} loadingLabel={tc('loading')} />
      ) : failed ? (
        <div className="alert alert-danger" role="alert">{tc('errorGeneric')}</div>
      ) : rows.length === 0 ? (
        <p className="text-muted">{t('empty')}</p>
      ) : (
        <div className="d-flex flex-column gap-3">
          {rows.map((r) => (
            <QuestionnaireCard key={r.id} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionnaireCard({ row }: { row: Row }) {
  const t = useTranslations('admin.questionnaireResponses');
  const locale = useLocale();
  const eventTitle = getLocalized(row.event.title, locale) || row.event.slug;
  return (
    <Card className="shadow-sm border-0" style={{ borderRadius: 8 }}>
      <CardBody className="p-4">
        <div className="mb-3">
          <h2 className="h5 fw-semibold mb-0" style={{ color: 'var(--app-text)' }}>
            {eventTitle}
          </h2>
          <div className="text-muted small">
            {t('cardMeta', {
              placement: row.placement === 'PRE_REGISTRATION' ? t('placementPre') : t('placementPost'),
              count: row.responseCount,
            })}
          </div>
        </div>

        <div className="d-flex flex-column gap-3">
          {row.items.map((it) => (
            <ItemSummary key={it.itemId} item={it} />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

// Le etichette dei tipi sono quelle del wizard (admin.wizard.step4).
const TYPE_KEYS: Record<ItemAgg['type'], string> = {
  SINGLE_CHOICE: 'questionTypeSingle',
  MULTI_CHOICE: 'questionTypeMulti',
  YES_NO: 'questionTypeYesNo',
  LIKERT: 'questionTypeLikert',
  OPEN_TEXT: 'questionTypeOpen',
};

function ItemSummary({ item }: { item: ItemAgg }) {
  const t = useTranslations('admin.questionnaireResponses');
  const tTypes = useTranslations('admin.wizard.step4');
  const locale = useLocale();
  const format = useFormatter();
  const prompt = getLocalized(item.prompt, locale);
  const { summary } = item;

  return (
    <div>
      <h3 className="h6 fw-semibold mb-1">{prompt}</h3>
      <div className="text-muted small mb-2">
        {t('itemMeta', { type: tTypes(TYPE_KEYS[item.type]), count: summary.totalAnswered })}
      </div>

      {(item.type === 'SINGLE_CHOICE' || item.type === 'MULTI_CHOICE') && summary.distribution && (
        <Bars bars={summary.distribution.map((d) => ({
          label: getLocalized(d.label ?? {}, locale) || t('optionN', { n: (d.idx ?? 0) + 1 }),
          count: d.count,
        }))} total={summary.totalAnswered} />
      )}

      {item.type === 'YES_NO' && (
        <Bars bars={[
          { label: t('yes'), count: summary.yes ?? 0 },
          { label: t('no'), count: summary.no ?? 0 },
        ]} total={(summary.yes ?? 0) + (summary.no ?? 0)} />
      )}

      {item.type === 'LIKERT' && summary.distribution && (
        <>
          <div className="small text-muted mb-1">
            {t('average', {
              value:
                summary.average == null
                  ? '—'
                  : format.number(summary.average, { maximumFractionDigits: 2 }),
            })}
          </div>
          <Bars bars={summary.distribution.map((d) => ({
            label: String(d.value ?? ''),
            count: d.count,
          }))} total={summary.totalAnswered} />
        </>
      )}

      {item.type === 'OPEN_TEXT' && summary.samples && (
        <div className="d-flex flex-column gap-1">
          {summary.samples.length === 0 ? (
            <div className="text-muted small">{t('noAnswers')}</div>
          ) : (
            summary.samples.map((s, i) => (
              <div key={i} className="border-start border-2 ps-2 small" style={{ borderColor: 'var(--app-primary)' }}>
                {s}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Bars({ bars, total }: { bars: { label: string; count: number }[]; total: number }) {
  const t = useTranslations('admin.questionnaireResponses');
  if (total === 0) return <div className="text-muted small">{t('noData')}</div>;
  const max = Math.max(...bars.map((b) => b.count), 1);
  return (
    <div className="d-flex flex-column gap-1">
      {bars.map((b, i) => {
        const pct = Math.round((b.count / max) * 100);
        const shareOfTotal = total > 0 ? Math.round((b.count / total) * 100) : 0;
        return (
          <div key={i} className="d-flex align-items-center gap-2">
            <div style={{ width: 120, fontSize: '0.85rem' }}>{b.label}</div>
            <div className="flex-grow-1" style={{ height: 14, backgroundColor: '#f0f0f0', borderRadius: 4 }} aria-hidden="true">
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  backgroundColor: 'var(--app-primary)',
                  borderRadius: 4,
                }}
              />
            </div>
            <div style={{ width: 70, fontSize: '0.8rem', textAlign: 'right' }} className="text-muted">
              {b.count} · {shareOfTotal}%
            </div>
          </div>
        );
      })}
    </div>
  );
}
