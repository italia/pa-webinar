// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

/**
 * Il catalogo dell'evento in modifica: il tipo e il modello, che contano solo
 * per le statistiche dell'istanza. Non cambiano nessuna impostazione: servono a
 * correggere un evento catalogato male, o a catalogarne uno nato prima.
 */

import type { EventFormatClass } from '@prisma/client';
import { useTranslations } from 'next-intl';

import { CLASSI_FORMATO } from '@/lib/events/catalog';

import type { CampiCatalogo } from './catalogo';

/** Il valore della scelta «il modello cancellato da cui l'evento e' nato». */
const ELIMINATO = '__eliminato__';

export default function CampoCatalogo({
  value,
  onChange,
  modelli,
  salvato,
}: {
  value: CampiCatalogo;
  onChange: (patch: Partial<CampiCatalogo>) => void;
  /** I modelli dell'istanza, fra cui scegliere. */
  modelli: ReadonlyArray<{ id: string; name: string }>;
  /** Il modello come l'evento lo ha salvato, con il nome di quando l'ha preso:
   *  il nome resta se il modello si cancella. */
  salvato: { templateId: string | null; templateName: string | null };
}) {
  const t = useTranslations('admin.catalog');
  // Il modello da cui l'evento e' nato, poi cancellato: resta una scelta,
  // con il suo nome, finche' non se ne sceglie un altro o nessuno.
  const modelloEliminato = salvato.templateId === null ? salvato.templateName : null;
  // Il modello salvato potrebbe non essere piu' nell'elenco (cancellato mentre
  // la pagina era aperta): resta scelto con il nome che aveva. Uno ripreso da
  // una bozza e cancellato nel frattempo non si mostra, e non si salva.
  const salvatoFuoriElenco =
    salvato.templateId !== null && !modelli.some((m) => m.id === salvato.templateId);
  const scelto =
    value.templateId !== null
      ? modelli.some((m) => m.id === value.templateId) ||
        value.templateId === salvato.templateId
        ? value.templateId
        : ''
      : value.deletedTemplateName !== null && modelloEliminato
        ? ELIMINATO
        : '';
  return (
    <fieldset className="mt-4 pt-3 border-top">
      <legend className="h6 fw-semibold mb-1">{t('fieldTitle')}</legend>
      <p id="ev-catalog-help" className="text-secondary small mb-3">
        {t('fieldHelp')}
      </p>
      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label" htmlFor="ev-catalog-type">
            {t('typeLabel')}
          </label>
          <select
            id="ev-catalog-type"
            className="form-select"
            aria-describedby="ev-catalog-help"
            value={value.formatClass ?? ''}
            onChange={(e) =>
              onChange({
                formatClass: (e.target.value || null) as EventFormatClass | null,
              })
            }
          >
            <option value="">{t('types.UNCATALOGED')}</option>
            {CLASSI_FORMATO.map((c) => (
              <option key={c} value={c}>
                {t(`types.${c}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-6">
          <label className="form-label" htmlFor="ev-catalog-template">
            {t('templateLabel')}
          </label>
          <select
            id="ev-catalog-template"
            className="form-select"
            aria-describedby={scelto === ELIMINATO ? 'ev-catalog-deleted' : undefined}
            value={scelto}
            onChange={(e) => {
              const v = e.target.value;
              if (v === ELIMINATO) {
                onChange({ templateId: null, deletedTemplateName: modelloEliminato });
              } else {
                onChange({ templateId: v || null, deletedTemplateName: null });
              }
            }}
          >
            <option value="">{t('noTemplate')}</option>
            {modelli.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            {salvatoFuoriElenco && salvato.templateId && (
              <option value={salvato.templateId}>
                {salvato.templateName ?? salvato.templateId}
              </option>
            )}
            {modelloEliminato && (
              <option value={ELIMINATO}>
                {t('deletedOption', { name: modelloEliminato })}
              </option>
            )}
          </select>
          {scelto === ELIMINATO && modelloEliminato && (
            <small id="ev-catalog-deleted" className="form-text text-muted">
              {t('deletedTemplate', { name: modelloEliminato })}
            </small>
          )}
        </div>
      </div>
    </fieldset>
  );
}
