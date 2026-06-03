'use client';

/**
 * Admin dashboard for questionnaire responses.
 *
 * Filters: event, placement, date range. For each matching questionnaire
 * the server pre-computes item-level aggregates (distribution, average,
 * text samples); the client just visualises them. Charts are native
 * CSS bars — no chart library — to keep the bundle small. A richer
 * visualisation can be added later if the ops team asks for it.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardBody, Input, Label } from 'design-react-kit';

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
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [placement, setPlacement] = useState<string>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [events, setEvents] = useState<{ id: string; label: string }[]>([]);
  const [eventId, setEventId] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (eventId) qs.set('eventId', eventId);
      if (placement) qs.set('placement', placement);
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const res = await fetch(`/api/admin/questionnaire-responses?${qs}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows);
        const uniqEvents = new Map<string, string>();
        for (const r of data.rows as Row[]) {
          const title = r.event.title.it || r.event.slug;
          uniqEvents.set(r.event.id, title);
        }
        setEvents([...uniqEvents.entries()].map(([id, label]) => ({ id, label })));
      }
    } finally {
      setLoading(false);
    }
  }, [eventId, placement, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <Card className="shadow-sm border-0 mb-4" style={{ borderRadius: 8 }}>
        <CardBody className="p-3">
          <div className="row g-3 align-items-end">
            <div className="col-md-3">
              <Label>Evento</Label>
              <select
                className="form-select"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
              >
                <option value="">— tutti —</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <Label>Fase</Label>
              <select
                className="form-select"
                value={placement}
                onChange={(e) => setPlacement(e.target.value)}
              >
                <option value="">— tutte —</option>
                <option value="PRE_REGISTRATION">Pre-registrazione</option>
                <option value="POST_EVENT">Post-evento</option>
              </select>
            </div>
            <div className="col-md-2">
              <Label>Dal</Label>
              <Input
                type="date"
                value={from}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)}
              />
            </div>
            <div className="col-md-2">
              <Label>Al</Label>
              <Input
                type="date"
                value={to}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)}
              />
            </div>
            <div className="col-md-2">
              <Button color="primary" size="sm" onClick={load}>
                Filtra
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <div className="text-muted">Caricamento…</div>
      ) : rows.length === 0 ? (
        <div className="text-muted">Nessun questionario corrisponde ai filtri.</div>
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
  const eventTitle = row.event.title.it || row.event.slug;
  return (
    <Card className="shadow-sm border-0" style={{ borderRadius: 8 }}>
      <CardBody className="p-4">
        <div className="d-flex justify-content-between flex-wrap gap-2 mb-3">
          <div>
            <h5 className="fw-semibold mb-0" style={{ color: 'var(--app-text)' }}>
              {eventTitle}
            </h5>
            <div className="text-muted small">
              Fase: {row.placement === 'PRE_REGISTRATION' ? 'Pre-registrazione' : 'Post-evento'}
              {' · '}
              {row.responseCount} risposte
            </div>
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

function ItemSummary({ item }: { item: ItemAgg }) {
  const prompt = item.prompt.it || Object.values(item.prompt)[0] || '';
  const { summary } = item;

  return (
    <div>
      <div className="fw-semibold mb-1">{prompt}</div>
      <div className="text-muted small mb-2">
        {labelForType(item.type)} · {summary.totalAnswered} risposte
      </div>

      {(item.type === 'SINGLE_CHOICE' || item.type === 'MULTI_CHOICE') && summary.distribution && (
        <Bars bars={summary.distribution.map((d) => ({
          label: d.label?.it || Object.values(d.label ?? {})[0] || `Opzione ${(d.idx ?? 0) + 1}`,
          count: d.count,
        }))} total={summary.totalAnswered} />
      )}

      {item.type === 'YES_NO' && (
        <Bars bars={[
          { label: 'Sì', count: summary.yes ?? 0 },
          { label: 'No', count: summary.no ?? 0 },
        ]} total={(summary.yes ?? 0) + (summary.no ?? 0)} />
      )}

      {item.type === 'LIKERT' && summary.distribution && (
        <>
          <div className="small text-muted mb-1">Media: {summary.average ?? '—'}</div>
          <Bars bars={summary.distribution.map((d) => ({
            label: String(d.value ?? ''),
            count: d.count,
          }))} total={summary.totalAnswered} />
        </>
      )}

      {item.type === 'OPEN_TEXT' && summary.samples && (
        <div className="d-flex flex-column gap-1">
          {summary.samples.length === 0 ? (
            <div className="text-muted small">Nessuna risposta.</div>
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
  if (total === 0) return <div className="text-muted small">Nessun dato.</div>;
  const max = Math.max(...bars.map((b) => b.count), 1);
  return (
    <div className="d-flex flex-column gap-1">
      {bars.map((b, i) => {
        const pct = Math.round((b.count / max) * 100);
        const shareOfTotal = total > 0 ? Math.round((b.count / total) * 100) : 0;
        return (
          <div key={i} className="d-flex align-items-center gap-2">
            <div style={{ width: 120, fontSize: '0.85rem' }}>{b.label}</div>
            <div className="flex-grow-1" style={{ height: 14, backgroundColor: '#f0f0f0', borderRadius: 4 }}>
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

function labelForType(t: string): string {
  switch (t) {
    case 'SINGLE_CHOICE':
      return 'Scelta singola';
    case 'MULTI_CHOICE':
      return 'Scelta multipla';
    case 'YES_NO':
      return 'Sì/No';
    case 'LIKERT':
      return 'Likert';
    case 'OPEN_TEXT':
      return 'Testo libero';
    default:
      return t;
  }
}
