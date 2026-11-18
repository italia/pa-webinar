// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Il catalogo dell'evento nel wizard (lib/events/catalog): il modello da cui
 * nasce e la famiglia del formato. In creazione viene dalla scelta fatta prima
 * del wizard; in modifica lo corregge lo staff dell'evento.
 */

import type { EventFormatClass } from '@prisma/client';

export interface CampiCatalogo {
  /** Il modello da cui l'evento nasce; null: nessuno. */
  templateId: string | null;
  /** Il nome del modello da cui l'evento e' nato, poi cancellato: resta finche'
   *  non si sceglie «nessun modello» o un altro modello. */
  deletedTemplateName: string | null;
  /** La famiglia del formato; null: non catalogato. */
  formatClass: EventFormatClass | null;
}

/** Cio' che il salvataggio manda del catalogo (i campi della rotta). */
export interface CatalogoInviato {
  templateId?: string | null;
  formatClass?: EventFormatClass | null;
}

/**
 * Cio' che il salvataggio manda del catalogo. In creazione, il catalogo di
 * partenza (il server fotografa il nome del modello e, senza famiglia, la
 * ricava dal modello). In modifica solo i valori cambiati rispetto all'ultimo
 * salvataggio: un salvataggio che non li tocca non li riscrive, e con un link
 * di conduzione non si mandano (li decide lo staff). Togliere il nome di un
 * modello cancellato e' un cambio: si manda «nessun modello».
 *
 * `modelli`: i modelli che esistono. Un modello che non c'e' piu' (ripreso da
 * una bozza scritta prima che lo si cancellasse) non si manda: il server lo
 * rifiuterebbe, e l'evento resta com'era.
 */
export function catalogoDaSalvare(
  form: CampiCatalogo,
  salvato: CampiCatalogo | null,
  viaToken: boolean,
  modelli?: ReadonlyArray<{ id: string }>
): CatalogoInviato {
  if (salvato === null) {
    return {
      ...(form.templateId !== null && { templateId: form.templateId }),
      ...(form.formatClass !== null && { formatClass: form.formatClass }),
    };
  }
  if (viaToken) return {};
  const modelloEsiste =
    form.templateId === null || !modelli || modelli.some((m) => m.id === form.templateId);
  const togliNome =
    form.templateId === null &&
    salvato.templateId === null &&
    salvato.deletedTemplateName !== null &&
    form.deletedTemplateName === null;
  return {
    ...(modelloEsiste &&
      (form.templateId !== salvato.templateId || togliNome) && {
        templateId: form.templateId,
      }),
    ...(form.formatClass !== salvato.formatClass && { formatClass: form.formatClass }),
  };
}

/** Il catalogo come l'evento lo ha salvato. */
export function catalogoDellEvento(evento: {
  templateId?: string | null;
  templateName?: string | null;
  formatClass?: EventFormatClass | null;
}): CampiCatalogo {
  const templateId = evento.templateId ?? null;
  return {
    templateId,
    deletedTemplateName: templateId === null ? (evento.templateName ?? null) : null,
    formatClass: evento.formatClass ?? null,
  };
}

/** Il catalogo dopo un salvataggio riuscito: cio' che il server ora ha. */
export function catalogoDopoIlSalvataggio(
  salvato: CampiCatalogo,
  inviato: CatalogoInviato
): CampiCatalogo {
  return {
    templateId:
      inviato.templateId !== undefined ? inviato.templateId : salvato.templateId,
    // Un modello scelto o tolto toglie il nome di quello cancellato.
    deletedTemplateName:
      inviato.templateId !== undefined ? null : salvato.deletedTemplateName,
    formatClass:
      inviato.formatClass !== undefined ? inviato.formatClass : salvato.formatClass,
  };
}
