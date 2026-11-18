// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { createHash } from 'crypto';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { PREFISSO_POSTO_MODERATORE } from '@/lib/auth/jwt';
import { iscrizioneDelPosto } from '@/lib/captions/room';
import type { Destinazione, PeriodoConsenso } from '@/lib/recording/destination';

/**
 * Le prove dei consensi di un evento, per chi lo gestisce (art. 7.1 GDPR:
 * chi tratta i dati deve poter dimostrare il consenso): quelle date
 * all'iscrizione e quelle date in sala d'attesa o in sala, con l'ora del
 * ritiro quando c'e' stato (lib/live/consent-withdrawal), e quelle conservate
 * dopo la cancellazione delle sorgenti (lib/gdpr/retained-consent-proofs).
 *
 * Una riga per prova, e per i periodi precedenti di un consenso ridato dopo
 * un ritiro o sostituito da uno successivo. Chi l'ha data si dice per nome
 * (quello con cui e' entrato, o quello dell'iscrizione) e per ruolo: iscritto,
 * ospite (anche chi apre un link d'iscrizione inoltrato), chi conduce o
 * interviene.
 */

export type TipoConsenso = 'recording' | 'transcription';
/** `self-service`: dato di nuovo dalla pagina dei propri dati (lib/gdpr/consent-giving),
 *  con la stessa prova di quello dato in sala. */
export type OrigineConsenso = 'registration' | 'room' | 'self-service';
export type RuoloConsenso = 'registrant' | 'guest' | 'host';

export interface ProvaConsenso {
  kind: TipoConsenso;
  source: OrigineConsenso;
  role: RuoloConsenso;
  /** Null se non si e' potuto decifrare, se non si e' chiesto (`nomi: false`) o
   *  se la persona ne ha chiesto la rimozione (`nomeRimosso`). */
  name: string | null;
  nomeRimosso: boolean;
  /** La prova sopravvive alla sua sorgente, che e' stata cancellata. */
  conservata: boolean;
  /** Un periodo sostituito da uno successivo: resta come prova di quel testo,
   *  ma se il consenso vale lo dice il periodo che l'ha sostituito. */
  superata: boolean;
  givenAt: string;
  withdrawnAt: string | null;
  /** La versione del testo (lib/registration/consents,
   *  lib/recording/destination). Null se il testo non ne dichiarava una. */
  textVersion: number | null;
  /** La destinazione del video dichiarata dal testo, per la registrazione. */
  destination: Destinazione;
  /** L'impronta di chi ha il consenso, per contare persone e non righe: la
   *  stessa con la sorgente viva e con la prova conservata. Non si esporta. */
  holder: string;
}

/** Una prova come sta sulla sorgente: il nome e' ancora cifrato. */
export interface RigaProva {
  kind: TipoConsenso;
  source: OrigineConsenso;
  role: RuoloConsenso;
  /** Il nome cifrato. Null se non si e' chiesto (`nomi: false`). */
  displayName: string | null;
  /** L'impronta dell'indirizzo. Null per chi non ne ha dato uno. */
  emailHash: string | null;
  locale: string | null;
  /** Un periodo di RecordingConsent.earlierPeriods senza ritiro: e' stato
   *  sostituito da uno successivo, non ritirato. */
  superata: boolean;
  givenAt: string;
  withdrawnAt: string | null;
  textVersion: number | null;
  destination: Destinazione;
  /** Chi ha il consenso: l'iscrizione, l'account dello staff o la concessione,
   *  altrimenti il posto. */
  holder: string;
}

/** Le tabelle sorgente: il client, o la transazione che le sta cancellando. */
export type LettoreProve = Pick<
  Prisma.TransactionClient,
  'registration' | 'recordingConsent' | 'multitrackConsent'
>;

/** Quali prove leggere. Senza filtri, tutte quelle dell'evento. */
export interface FiltroProve {
  /** Le prove di queste iscrizioni: all'iscrizione e in sala. */
  registrationIds?: readonly string[];
  /** Le prove date in sala entrando con queste concessioni. */
  grantIds?: readonly string[];
  /** Le prove date in sala entrando dal link primario con questi account dello
   *  staff. */
  staffAccountIds?: readonly string[];
  /** Le prove date in sala con questa impronta dell'indirizzo, anche se la
   *  concessione o l'account non ci sono piu'. */
  emailHash?: string;
}

/** Una prova di sala: lo stesso posto e gli stessi legami sulle due tabelle. */
export interface ProvaDiSala {
  jitsiUserId: string;
  registrationId: string | null;
  eventModeratorId: string | null;
  staffAccountId: string | null;
}

/** Il suffisso del posto di una prova data dalla pagina dei propri dati. */
const SUFFISSO_I_MIEI_DATI = '-mydata';

/**
 * Il posto di una prova data dalla pagina dei propri dati: quello dell'iscrizione
 * (`reg-<id>-…`, come lo legge iscrizioneDelPosto), che nessuna conferenza usa.
 */
export function postoDaIMieiDati(registrationId: string): string {
  return `reg-${registrationId}${SUFFISSO_I_MIEI_DATI}`;
}

/** Dove e' stata data una prova legata a un posto: in sala o dai propri dati. */
export function origineDelPosto(jitsiUserId: string): 'room' | 'self-service' {
  return iscrizioneDelPosto(jitsiUserId) && jitsiUserId.endsWith(SUFFISSO_I_MIEI_DATI)
    ? 'self-service'
    : 'room';
}

const ruoloDiSala = (p: ProvaDiSala): RuoloConsenso =>
  p.eventModeratorId || p.staffAccountId
    ? 'host'
    : p.registrationId || iscrizioneDelPosto(p.jitsiUserId)
      ? 'registrant'
      : p.jitsiUserId.startsWith(PREFISSO_POSTO_MODERATORE)
        ? 'host'
        : 'guest';

/** Il titolare delle prove di un'iscrizione, all'iscrizione e in sala. */
export const titolareIscrizione = (registrationId: string): string => `reg:${registrationId}`;

/** Il titolare delle prove date entrando con un account dello staff. */
export const titolareAccount = (staffAccountId: string): string => `staff:${staffAccountId}`;

const titolarePosto = (posto: string): string => `posto:${posto}`;

/** Chi conduce con un legame che resta da un ingresso all'altro. */
const titolareChiConduce = (
  p: Pick<ProvaDiSala, 'eventModeratorId' | 'staffAccountId'>
): string | null => {
  if (p.staffAccountId) return titolareAccount(p.staffAccountId);
  return p.eventModeratorId ? `concessione:${p.eventModeratorId}` : null;
};

const titolareDiSala = (p: ProvaDiSala): string => {
  const conduce = titolareChiConduce(p);
  if (conduce) return conduce;
  const iscrizione = p.registrationId ?? iscrizioneDelPosto(p.jitsiUserId);
  return iscrizione ? titolareIscrizione(iscrizione) : titolarePosto(p.jitsiUserId);
};

/**
 * L'impronta dell'indirizzo di una prova di sala: quella scritta con il consenso,
 * che resta se la concessione o l'account se ne vanno, altrimenti quella di chi
 * la prova cita (le concessioni possono averla ricevuta dopo).
 */
const improntaDiSala = (p: {
  emailHash: string | null;
  registration: { emailHash: string | null } | null;
  eventModerator: { emailHash: string | null } | null;
  staffAccount: { emailHash: string | null } | null;
}): string | null =>
  p.emailHash ??
  p.registration?.emailHash ??
  p.eventModerator?.emailHash ??
  p.staffAccount?.emailHash ??
  null;

/** I legami per trovare le prove di sala di una persona in un evento. */
const legamiDiSala = (
  registrationIds: string[],
  grantIds: string[],
  staffAccountIds: string[],
  emailHash: string | undefined
) => [
  { registrationId: { in: registrationIds } },
  { eventModeratorId: { in: grantIds } },
  { staffAccountId: { in: staffAccountIds } },
  ...(emailHash ? [{ emailHash }] : []),
];

const periodiPrecedenti = (v: unknown): PeriodoConsenso[] =>
  Array.isArray(v)
    ? v.filter(
        (p): p is PeriodoConsenso =>
          !!p && typeof p === 'object' && typeof (p as PeriodoConsenso).consentedAt === 'string'
      )
    : [];

/** L'impronta di un titolare in un evento: non dice chi e', e non vale altrove. */
export const improntaTitolare = (eventId: string, holder: string): string =>
  createHash('sha256').update(`${eventId}|${holder}`).digest('hex');

/**
 * Le impronte con cui si riconosce una prova di sala: quella del titolare e
 * quella del posto. La seconda serve quando la prova perde il legame con
 * l'account cancellato, e il titolare diventa il posto.
 */
export const impronteDiSala = (eventId: string, p: ProvaDiSala): string[] => [
  ...new Set([
    improntaTitolare(eventId, titolareDiSala(p)),
    improntaTitolare(eventId, titolarePosto(p.jitsiUserId)),
  ]),
];

/** Chi c'e' dietro un posto senza iscrizione, per la trascrizione dai sottotitoli. */
export interface TitolareDelPosto {
  /** La concessione o l'account: distingue chi ha lo stesso nome. Null per gli altri. */
  persona: string | null;
  /** Le impronte da scrivere nel corpo della trascrizione (`impronteDiSala`). */
  impronte: string[];
}

/** I titolari dei posti di un evento, dalle prove di sala delle due tabelle. */
export async function titolariDeiPosti(
  db: Pick<LettoreProve, 'recordingConsent' | 'multitrackConsent'>,
  eventId: string
): Promise<Map<string, TitolareDelPosto>> {
  const legami = {
    jitsiUserId: true,
    registrationId: true,
    eventModeratorId: true,
    staffAccountId: true,
  } as const;
  const [registrazione, trascrizione] = await Promise.all([
    db.recordingConsent.findMany({ where: { eventId }, select: legami }),
    db.multitrackConsent.findMany({ where: { eventId }, select: legami }),
  ]);
  const posti = new Map<string, TitolareDelPosto>();
  for (const p of [...registrazione, ...trascrizione]) {
    if (p.registrationId || iscrizioneDelPosto(p.jitsiUserId)) continue;
    const gia = posti.get(p.jitsiUserId);
    posti.set(p.jitsiUserId, {
      persona: gia?.persona ?? titolareChiConduce(p),
      impronte: [...new Set([...(gia?.impronte ?? []), ...impronteDiSala(eventId, p)])],
    });
  }
  return posti;
}

/** Quanto serve di una prova conservata per riconoscere un periodo sostituito. */
interface PeriodoConservato {
  kind: string;
  source: string;
  role: string;
  holderHash: string;
  givenAt: Date;
  withdrawnAt: Date | null;
}

/**
 * I periodi sostituiti tra le prove conservate, che non hanno una colonna per
 * dirlo. Le prove di sala di un'iscrizione sono i periodi di un'unica prova
 * (vincolo unico) e si susseguono: un periodo ritirato finisce prima che inizi
 * il successivo, uno sostituito no. Un ritiro che arriva dopo la copia segna
 * tutti i periodi ancora aperti, e non cambia questa lettura. Gli altri titolari
 * possono avere piu' prove di sala insieme, una per posto, e restano fuori.
 */
export function periodiSostituiti<T extends PeriodoConservato>(
  righe: readonly T[]
): Set<T> {
  const perTitolare = new Map<string, T[]>();
  for (const r of righe) {
    if (r.kind !== 'recording' || r.source === 'registration' || r.role !== 'registrant')
      continue;
    perTitolare.set(r.holderHash, [...(perTitolare.get(r.holderHash) ?? []), r]);
  }
  const sostituiti = new Set<T>();
  for (const periodi of perTitolare.values()) {
    periodi.sort((a, b) => a.givenAt.getTime() - b.givenAt.getTime());
    periodi.forEach((periodo, i) => {
      const dopo = periodi[i + 1];
      if (dopo && (!periodo.withdrawnAt || periodo.withdrawnAt > dopo.givenAt)) {
        sostituiti.add(periodo);
      }
    });
  }
  return sostituiti;
}

/**
 * Le prove sulle tabelle sorgente, senza decifrare niente: la stessa lettura per
 * chi le mostra e per chi le copia prima di cancellarle (dentro la transazione
 * che le cancella).
 */
export async function leggiRigheProve(
  db: LettoreProve,
  eventId: string,
  {
    nomi = true,
    registrationIds,
    grantIds,
    staffAccountIds,
    emailHash,
  }: FiltroProve & { nomi?: boolean } = {}
): Promise<RigaProva[]> {
  const filtrate = !!registrationIds || !!grantIds || !!staffAccountIds || !!emailHash;
  const iscrizioniChieste = [...(registrationIds ?? [])];
  const concessioniChieste = [...(grantIds ?? [])];
  const accountChiesti = [...(staffAccountIds ?? [])];
  const diSala = filtrate
    ? {
        OR: legamiDiSala(iscrizioniChieste, concessioniChieste, accountChiesti, emailHash),
      }
    : {};
  const [iscrizioni, registrazione, trascrizione] = await Promise.all([
    db.registration.findMany({
      where: {
        eventId,
        OR: [{ consentRecording: true }, { consentMultitrack: true }],
        ...(filtrate ? { id: { in: iscrizioniChieste } } : {}),
      },
      select: {
        id: true,
        displayName: nomi,
        emailHash: true,
        locale: true,
        consentTimestamp: true,
        consentRecording: true,
        consentRecordingDestination: true,
        consentRecordingVersion: true,
        consentRecordingWithdrawnAt: true,
        consentMultitrack: true,
        consentMultitrackVersion: true,
        consentMultitrackWithdrawnAt: true,
      },
    }),
    db.recordingConsent.findMany({
      where: { eventId, ...diSala },
      select: {
        displayName: nomi,
        jitsiUserId: true,
        registrationId: true,
        eventModeratorId: true,
        staffAccountId: true,
        emailHash: true,
        locale: true,
        consentedAt: true,
        withdrawnAt: true,
        earlierPeriods: true,
        destination: true,
        textVersion: true,
        registration: { select: { emailHash: true } },
        eventModerator: { select: { emailHash: true } },
        staffAccount: { select: { emailHash: true } },
      },
    }),
    db.multitrackConsent.findMany({
      where: { eventId, ...diSala },
      select: {
        displayName: nomi,
        jitsiUserId: true,
        registrationId: true,
        eventModeratorId: true,
        staffAccountId: true,
        emailHash: true,
        locale: true,
        consentedAt: true,
        withdrawnAt: true,
        textVersion: true,
        registration: { select: { emailHash: true } },
        eventModerator: { select: { emailHash: true } },
        staffAccount: { select: { emailHash: true } },
      },
    }),
  ]);
  const righe: RigaProva[] = [];
  for (const r of iscrizioni) {
    const base = {
      source: 'registration' as const,
      role: 'registrant' as const,
      displayName: r.displayName ?? null,
      emailHash: r.emailHash ?? null,
      locale: r.locale ?? null,
      superata: false,
      givenAt: r.consentTimestamp.toISOString(),
      holder: titolareIscrizione(r.id),
    };
    if (r.consentRecording) {
      righe.push({
        ...base,
        kind: 'recording',
        withdrawnAt: r.consentRecordingWithdrawnAt?.toISOString() ?? null,
        textVersion: r.consentRecordingVersion ?? null,
        destination: r.consentRecordingDestination ?? null,
      });
    }
    if (r.consentMultitrack) {
      righe.push({
        ...base,
        kind: 'transcription',
        withdrawnAt: r.consentMultitrackWithdrawnAt?.toISOString() ?? null,
        textVersion: r.consentMultitrackVersion ?? 1,
        destination: null,
      });
    }
  }
  for (const p of registrazione) {
    const base = {
      kind: 'recording' as const,
      role: ruoloDiSala(p),
      displayName: p.displayName ?? null,
      emailHash: improntaDiSala(p),
      locale: p.locale ?? null,
      holder: titolareDiSala(p),
    };
    // Un consenso ridato o sostituito: i periodi di prima, poi quello attuale.
    for (const periodo of periodiPrecedenti(p.earlierPeriods)) {
      righe.push({
        ...base,
        // I periodi scritti prima che la prova dicesse da dove veniva: in sala.
        source: periodo.source ?? 'room',
        superata: !periodo.withdrawnAt,
        givenAt: periodo.consentedAt,
        withdrawnAt: periodo.withdrawnAt ?? null,
        textVersion: periodo.textVersion ?? null,
        destination: periodo.destination ?? null,
      });
    }
    righe.push({
      ...base,
      source: origineDelPosto(p.jitsiUserId),
      superata: false,
      givenAt: p.consentedAt.toISOString(),
      withdrawnAt: p.withdrawnAt?.toISOString() ?? null,
      textVersion: p.textVersion ?? null,
      destination: p.destination ?? null,
    });
  }
  for (const p of trascrizione) {
    righe.push({
      kind: 'transcription',
      source: origineDelPosto(p.jitsiUserId),
      role: ruoloDiSala(p),
      displayName: p.displayName ?? null,
      emailHash: improntaDiSala(p),
      locale: p.locale ?? null,
      superata: false,
      givenAt: p.consentedAt.toISOString(),
      withdrawnAt: p.withdrawnAt?.toISOString() ?? null,
      textVersion: p.textVersion,
      destination: null,
      holder: titolareDiSala(p),
    });
  }
  return righe;
}

/**
 * Le prove di sala date conducendo un evento, per la consegna dei propri dati
 * (art. 15): gli stessi legami con cui la cancellazione le raggiunge. Quelle di
 * un'iscrizione arrivano con l'iscrizione.
 */
export async function proveDiSalaDiChiConduce(
  db: LettoreProve & Pick<Prisma.TransactionClient, 'event'>,
  filtro: Required<Pick<FiltroProve, 'grantIds' | 'staffAccountIds' | 'emailHash'>>
) {
  const dove = {
    OR: legamiDiSala([], [...filtro.grantIds], [...filtro.staffAccountIds], filtro.emailHash),
  };
  const [registrazione, trascrizione] = await Promise.all([
    db.recordingConsent.findMany({ where: dove, select: { eventId: true }, distinct: ['eventId'] }),
    db.multitrackConsent.findMany({ where: dove, select: { eventId: true }, distinct: ['eventId'] }),
  ]);
  const idEventi = [...new Set([...registrazione, ...trascrizione].map((p) => p.eventId))];
  if (idEventi.length === 0) return [];
  const eventi = await db.event.findMany({
    where: { id: { in: idEventi } },
    select: { id: true, title: true, startsAt: true },
  });
  const prove = await Promise.all(
    eventi.map(async (evento) =>
      (await leggiRigheProve(db, evento.id, filtro))
        .filter((r) => r.role === 'host')
        .map((r) => ({
          eventId: evento.id,
          kind: r.kind,
          name: r.displayName ? tryDecryptPII(r.displayName) : null,
          locale: r.locale,
          textVersion: r.textVersion,
          destination: r.destination,
          givenAt: r.givenAt,
          withdrawnAt: r.withdrawnAt,
          superseded: r.superata,
          event: { title: evento.title, startsAt: evento.startsAt.toISOString() },
        }))
    )
  );
  return prove.flat().sort((a, b) => a.givenAt.localeCompare(b.givenAt));
}

export async function proveConsensoEvento(
  eventId: string,
  { nomi = true }: { nomi?: boolean } = {}
): Promise<ProvaConsenso[]> {
  const [sorgenti, conservate] = await Promise.all([
    leggiRigheProve(prisma, eventId, { nomi }),
    prisma.retainedConsentProof.findMany({
      where: { eventId },
      select: {
        kind: true,
        source: true,
        role: true,
        holderHash: true,
        displayName: nomi,
        nameRemovedAt: true,
        textVersion: true,
        destination: true,
        givenAt: true,
        withdrawnAt: true,
      },
    }),
  ]);
  const nome = (cifrato: string | null | undefined) =>
    nomi && cifrato ? tryDecryptPII(cifrato) : null;
  const righe: ProvaConsenso[] = sorgenti.map((r) => ({
    kind: r.kind,
    source: r.source,
    role: r.role,
    name: nome(r.displayName),
    nomeRimosso: false,
    conservata: false,
    superata: r.superata,
    givenAt: r.givenAt,
    withdrawnAt: r.withdrawnAt,
    textVersion: r.textVersion,
    destination: r.destination,
    holder: improntaTitolare(eventId, r.holder),
  }));
  const sostituite = periodiSostituiti(conservate);
  for (const p of conservate) {
    righe.push({
      kind: p.kind as TipoConsenso,
      source: p.source as OrigineConsenso,
      role: p.role as RuoloConsenso,
      name: nome(p.displayName),
      nomeRimosso: !!p.nameRemovedAt,
      conservata: true,
      superata: sostituite.has(p),
      givenAt: p.givenAt.toISOString(),
      withdrawnAt: p.withdrawnAt?.toISOString() ?? null,
      textVersion: p.textVersion,
      destination: p.destination,
      holder: p.holderHash,
    });
  }
  return righe.sort((a, b) => a.givenAt.localeCompare(b.givenAt));
}

/**
 * Quante persone (titolari: un'iscrizione, un account dello staff o una
 * concessione, altrimenti un posto) hanno un consenso valido per tipo, e
 * quante l'hanno ritirato senza ridarlo. Una persona che rientra non conta
 * due volte; un ospite che torna in un'altra visita ha un posto nuovo e conta
 * di nuovo (nessun dato lo lega alla visita di prima). Un periodo sostituito
 * non conta: chi ritira dopo una sostituzione ha ritirato. Senza nomi.
 */
export function riepilogoProve(
  righe: readonly ProvaConsenso[]
): Record<TipoConsenso, { given: number; withdrawn: number }> {
  const stato = new Map<string, boolean>();
  for (const r of righe) {
    if (r.superata) continue;
    const chiave = `${r.kind}|${r.holder}`;
    stato.set(chiave, (stato.get(chiave) ?? false) || !r.withdrawnAt);
  }
  const conta = {
    recording: { given: 0, withdrawn: 0 },
    transcription: { given: 0, withdrawn: 0 },
  };
  for (const [chiave, valido] of stato) {
    const kind = chiave.split('|')[0] as TipoConsenso;
    conta[kind][valido ? 'given' : 'withdrawn'] += 1;
  }
  return conta;
}
