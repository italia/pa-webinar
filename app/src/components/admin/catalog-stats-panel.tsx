// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

/**
 * Il catalogo nelle statistiche dell'istanza: quali tipi di evento e quali
 * modelli ricorrono di piu', e mese per mese quanti eventi, con quanti
 * partecipanti e quanto sono durati (lib/analytics/catalog-stats). Solo numeri:
 * nessun titolo, nessuna persona.
 *
 * La classifica e' una tabella con una barra per riga (la barra ripete il
 * numero accanto, che resta il dato); il dettaglio per mese e' una tabella con
 * una misura alla volta.
 */

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Card, CardBody, Spinner, Table } from 'design-react-kit';

import type {
  CellaCatalogo,
  GruppoModello,
  GruppoTipo,
  MesiCatalogo,
  StatisticheCatalogo,
} from '@/lib/analytics/catalog-stats';
import { MESI_CATALOGO } from '@/lib/analytics/catalog-stats';

type Raggruppa = 'type' | 'template';
type Misura = 'events' | 'avgParticipants' | 'avgDurationMinutes';

const MISURE: readonly Misura[] = ['events', 'avgParticipants', 'avgDurationMinutes'];

export default function CatalogStatsPanel({
  catalog,
  months,
  onMonthsChange,
  loading = false,
}: {
  catalog: StatisticheCatalogo;
  months: MesiCatalogo;
  onMonthsChange: (months: MesiCatalogo) => void;
  /** Una lettura nuova e' in corso: i numeri sono quelli di prima. */
  loading?: boolean;
}) {
  const t = useTranslations('admin.analytics.catalog');
  const tc = useTranslations('admin.catalog');
  const format = useFormatter();
  const [raggruppa, setRaggruppa] = useState<Raggruppa>('type');
  const [misura, setMisura] = useState<Misura>('events');

  const gruppi: Array<GruppoTipo | GruppoModello> = (
    raggruppa === 'type' ? catalog.byType : catalog.byTemplate
  ).filter((g) => g.events > 0);
  const massimo = Math.max(1, ...gruppi.map((g) => g.events));
  const nonCatalogati = catalog.byType.find((g) => g.type === 'UNCATALOGED')?.events ?? 0;

  const nome = (g: GruppoTipo | GruppoModello): string => {
    if ('type' in g) return tc(`types.${g.type}`);
    if (g.special === 'INSTANT' || g.special === 'LEGACY')
      return tc(`types.${g.special}`);
    if (g.special === 'NONE') return tc('noTemplate');
    if (g.deleted) return t('deletedTemplate', { name: g.name ?? '' });
    return g.name ?? '';
  };

  const valore = (c: CellaCatalogo, m: Misura): string => {
    if (m === 'events') return format.number(c.events);
    if (m === 'avgParticipants') {
      return c.avgParticipants == null
        ? '—'
        : format.number(c.avgParticipants, { maximumFractionDigits: 1 });
    }
    return c.avgDurationMinutes == null
      ? '—'
      : format.number(c.avgDurationMinutes, {
          style: 'unit',
          unit: 'minute',
          unitDisplay: 'short',
        });
  };

  const mese = (m: string): string => {
    const [anno, numero] = m.split('-').map(Number) as [number, number];
    return format.dateTime(new Date(Date.UTC(anno, numero - 1, 1)), {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    });
  };

  const colonnaGruppo = raggruppa === 'type' ? t('columns.type') : t('columns.template');

  return (
    <Card className="border-0 shadow-sm mb-4">
      <CardBody className="p-4">
        <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
          <div>
            <h2 className="h5 fw-semibold mb-1">{t('title')}</h2>
            <p className="text-secondary small mb-0">{t('intro')}</p>
          </div>
          <div
            className="d-flex flex-wrap gap-2"
            role="group"
            aria-label={t('periodLabel')}
          >
            {MESI_CATALOGO.map((n) => (
              <button
                key={n}
                type="button"
                className={`btn btn-sm ${months === n ? 'btn-primary' : 'btn-outline-primary'}`}
                aria-pressed={months === n}
                onClick={() => onMonthsChange(n)}
              >
                {t('months', { count: n })}
              </button>
            ))}
            {loading && <Spinner active small className="ms-2" />}
          </div>
        </div>

        <div
          className="d-flex flex-wrap gap-2 mb-3"
          role="group"
          aria-label={t('groupByLabel')}
        >
          {(['type', 'template'] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={`btn btn-sm ${raggruppa === r ? 'btn-primary' : 'btn-outline-primary'}`}
              aria-pressed={raggruppa === r}
              onClick={() => setRaggruppa(r)}
            >
              {t(`groupBy.${r}`)}
            </button>
          ))}
        </div>

        <div aria-busy={loading}>
          {gruppi.length === 0 ? (
            <p className="text-muted text-center py-4 mb-0">{t('empty')}</p>
          ) : (
            <>
              <h3 className="h6 fw-semibold mb-2">
                {raggruppa === 'type' ? t('rankingTypes') : t('rankingTemplates')}
              </h3>
              <div className="table-responsive mb-2">
                <Table className="mb-0 align-middle">
                  <caption className="visually-hidden">
                    {raggruppa === 'type' ? t('rankingTypes') : t('rankingTemplates')}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{colonnaGruppo}</th>
                      <th scope="col" style={{ minWidth: 180 }}>
                        {t('columns.events')}
                      </th>
                      <th scope="col" className="text-end">
                        {t('columns.held')}
                      </th>
                      <th scope="col" className="text-end">
                        {t('columns.avgParticipants')}
                      </th>
                      <th scope="col" className="text-end">
                        {t('columns.avgDuration')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {gruppi.map((g) => (
                      <tr key={g.key}>
                        <th scope="row" className="fw-semibold">
                          {nome(g)}
                        </th>
                        <td>
                          <div className="d-flex align-items-center gap-2">
                            <span className="fw-semibold" style={{ minWidth: '2.5em' }}>
                              {format.number(g.events)}
                            </span>
                            <span
                              aria-hidden="true"
                              className="flex-grow-1"
                              style={{ maxWidth: 220 }}
                            >
                              <span
                                className="d-block"
                                style={{
                                  width: `${Math.max(2, (g.events / massimo) * 100)}%`,
                                  height: 8,
                                  borderRadius: 4,
                                  backgroundColor: 'var(--app-primary)',
                                }}
                              />
                            </span>
                          </div>
                        </td>
                        <td className="text-end">{format.number(g.held)}</td>
                        <td className="text-end">{valore(g, 'avgParticipants')}</td>
                        <td className="text-end">{valore(g, 'avgDurationMinutes')}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <p className="small text-secondary mb-4">{t('measuresNote')}</p>

              <div className="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-2">
                <h3 className="h6 fw-semibold mb-0">{t('byMonth')}</h3>
                <div>
                  <label className="form-label small mb-1" htmlFor="catalogo-misura">
                    {t('measureLabel')}
                  </label>
                  <select
                    id="catalogo-misura"
                    className="form-select form-select-sm"
                    value={misura}
                    onChange={(e) => setMisura(e.target.value as Misura)}
                  >
                    {MISURE.map((m) => (
                      <option key={m} value={m}>
                        {t(`measures.${m}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {/* Scorre in orizzontale: deve poterlo fare anche chi usa la tastiera. */}
              <div
                className="table-responsive"
                tabIndex={0}
                role="region"
                aria-label={t('byMonth')}
              >
                <Table className="mb-0 text-nowrap" size="sm">
                  <caption className="visually-hidden">
                    {t('byMonthCaption', { measure: t(`measures.${misura}`) })}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{colonnaGruppo}</th>
                      {catalog.months.map((m) => (
                        <th key={m} scope="col" className="text-end">
                          {mese(m)}
                        </th>
                      ))}
                      <th scope="col" className="text-end">
                        {t('columns.total')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {gruppi.map((g) => (
                      <tr key={g.key}>
                        <th scope="row" className="fw-semibold text-wrap">
                          {nome(g)}
                        </th>
                        {g.byMonth.map((c, i) => (
                          <td key={catalog.months[i] ?? i} className="text-end">
                            {c.events === 0 && misura !== 'events'
                              ? '—'
                              : valore(c, misura)}
                          </td>
                        ))}
                        <td className="text-end fw-semibold">{valore(g, misura)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          )}
          {nonCatalogati > 0 && (
            <p className="small text-secondary mt-3 mb-0">
              {t('uncatalogedNote', { count: nonCatalogati })}
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
