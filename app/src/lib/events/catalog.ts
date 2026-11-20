// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Il catalogo degli eventi: di che tipo e' un evento e da quale modello e' nato,
 * per le statistiche dell'istanza (lib/analytics/catalog-stats).
 *
 * Il tipo e' la famiglia del formato del wizard (`classeFormato`: riunione,
 * partecipativo, pubblico), salvata sull'evento alla creazione. Le chiamate
 * rapide e gli archivi importati sono tipi a se': li dice gia' `eventType`. Un
 * evento senza famiglia (nato prima del catalogo, o creato senza modello e senza
 * formato) e' «non catalogato»: il catalogo non indovina.
 *
 * Pure, salvo il tipo dei dati: la regola si verifica senza banca dati.
 */

import type { EventFormatClass, EventType } from '@prisma/client';

import {
  classeFormato,
  PARTECIPANTI_ATTESI,
  type ClasseFormato,
} from '@/lib/events/guided-format';
import { VASTA_SCALA } from '@/lib/live/participant-list';
import { coerceMatrix, togglesFromMatrix } from '@/lib/utils/permission-matrix';

/** Le famiglie del formato, nell'ordine in cui si presentano. */
export const CLASSI_FORMATO = [
  'MEETING',
  'PARTICIPATORY',
  'PUBLIC',
] as const satisfies readonly EventFormatClass[];

const CLASSE_DEL_FORMATO: Record<ClasseFormato, EventFormatClass> = {
  riunione: 'MEETING',
  partecipativo: 'PARTICIPATORY',
  pubblico: 'PUBLIC',
};

/** La famiglia di un formato del wizard, come si salva sull'evento. */
export function classeDaFormato(classe: ClasseFormato): EventFormatClass {
  return CLASSE_DEL_FORMATO[classe];
}

/** Le colonne di un modello che servono al catalogo (una `select` di Prisma). */
export const MODELLO_PER_CATALOGO = {
  id: true,
  name: true,
  maxParticipants: true,
  participantsCanUnmute: true,
  participantsCanStartVideo: true,
  permissionMatrix: true,
} as const;

/** Cio' di un modello che ne decide la famiglia. */
export interface ModelloPerCatalogo {
  id: string;
  name: string;
  maxParticipants: number;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  permissionMatrix?: unknown;
}

/**
 * La famiglia di un modello: la stessa regola delle domande del formato, sulle
 * risposte che il modello da' gia'. Chi partecipa parla o si mostra se il
 * modello glielo lascia fare (la matrice dei permessi, se c'e', vince sugli
 * interruttori, come alla creazione); le persone attese vengono dal numero di
 * partecipanti.
 */
export function classeDelModello(modello: ModelloPerCatalogo): EventFormatClass {
  const matrice = coerceMatrix(modello.permissionMatrix);
  const permessi = matrice
    ? togglesFromMatrix(matrice)
    : {
        participantsCanUnmute: modello.participantsCanUnmute,
        participantsCanStartVideo: modello.participantsCanStartVideo,
      };
  const voce =
    permessi.participantsCanUnmute || permessi.participantsCanStartVideo
      ? 'tutti'
      : 'relatori';
  const persone =
    modello.maxParticipants >= VASTA_SCALA
      ? 'grande'
      : modello.maxParticipants <= PARTECIPANTI_ATTESI.piccolo
        ? 'piccolo'
        : 'medio';
  return classeDaFormato(classeFormato({ persone, voce }));
}

/** Il catalogo come si scrive sull'evento. */
export interface CatalogoEvento {
  templateId: string | null;
  templateName: string | null;
  formatClass: EventFormatClass | null;
}

/**
 * Il catalogo di un evento nuovo. La famiglia dichiarata (dalle domande del
 * formato) vince; senza, quella del modello da cui l'evento parte. Il nome del
 * modello si fotografa adesso: le statistiche lo ritrovano anche dopo un cambio
 * di nome o la cancellazione del modello.
 */
export function catalogoDiCreazione(
  modello: ModelloPerCatalogo | null,
  formatClass: EventFormatClass | null | undefined
): CatalogoEvento {
  return {
    templateId: modello?.id ?? null,
    templateName: modello?.name ?? null,
    formatClass: formatClass ?? (modello ? classeDelModello(modello) : null),
  };
}

/** I tipi delle statistiche: le famiglie del formato, i tipi a se' e chi non ne ha. */
export const TIPI_CATALOGO = [
  ...CLASSI_FORMATO,
  'INSTANT',
  'LEGACY',
  'UNCATALOGED',
] as const;
export type TipoCatalogo = (typeof TIPI_CATALOGO)[number];

/** Il tipo di un evento nelle statistiche. */
export function tipoDiCatalogo(evento: {
  eventType: EventType | string;
  formatClass: EventFormatClass | null;
}): TipoCatalogo {
  if (evento.eventType === 'INSTANT') return 'INSTANT';
  if (evento.eventType === 'LEGACY') return 'LEGACY';
  return evento.formatClass ?? 'UNCATALOGED';
}
