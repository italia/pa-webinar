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
 * un ritiro. Chi l'ha data si dice per nome (quello con cui e'
 * entrato, o quello dell'iscrizione) e per ruolo: iscritto, ospite (anche chi
 * apre un link d'iscrizione inoltrato), chi conduce o interviene.
 */

export type TipoConsenso = 'recording' | 'transcription';
export type OrigineConsenso = 'registration' | 'room';
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
  /** Le prove della registrazione date entrando con queste concessioni. */
  grantIds?: readonly string[];
  /** Le prove della registrazione date entrando dal link primario con questi
   *  account dello staff. */
  staffAccountIds?: readonly string[];
}

const ruoloDelPosto = (posto: string, registrationId: string | null): RuoloConsenso =>
  registrationId || iscrizioneDelPosto(posto)
    ? 'registrant'
    : posto.startsWith(PREFISSO_POSTO_MODERATORE)
      ? 'host'
      : 'guest';

/** Il titolare delle prove di un'iscrizione, all'iscrizione e in sala. */
export const titolareIscrizione = (registrationId: string): string => `reg:${registrationId}`;

const titolareDelPosto = (posto: string, registrationId: string | null): string => {
  const iscrizione = registrationId ?? iscrizioneDelPosto(posto);
  return iscrizione ? titolareIscrizione(iscrizione) : `posto:${posto}`;
};

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
 * Le prove sulle tabelle sorgente, senza decifrare niente: la stessa lettura per
 * chi le mostra e per chi le copia prima di cancellarle (dentro la transazione
 * che le cancella).
 */
export async function leggiRigheProve(
  db: LettoreProve,
  eventId: string,
  { nomi = true, registrationIds, grantIds, staffAccountIds }: FiltroProve & { nomi?: boolean } = {}
): Promise<RigaProva[]> {
  const filtrate = !!registrationIds || !!grantIds || !!staffAccountIds;
  const iscrizioniChieste = [...(registrationIds ?? [])];
  const concessioniChieste = [...(grantIds ?? [])];
  const accountChiesti = [...(staffAccountIds ?? [])];
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
      where: {
        eventId,
        ...(filtrate
          ? {
              OR: [
                { registrationId: { in: iscrizioniChieste } },
                { eventModeratorId: { in: concessioniChieste } },
                { staffAccountId: { in: accountChiesti } },
              ],
            }
          : {}),
      },
      select: {
        displayName: nomi,
        jitsiUserId: true,
        registrationId: true,
        eventModeratorId: true,
        staffAccountId: true,
        locale: true,
        consentedAt: true,
        withdrawnAt: true,
        earlierPeriods: true,
        destination: true,
        textVersion: true,
        // L'indirizzo non sta sulla prova: lo sa chi la lega a una persona.
        registration: { select: { emailHash: true } },
        eventModerator: { select: { emailHash: true } },
        staffAccount: { select: { emailHash: true } },
      },
    }),
    db.multitrackConsent.findMany({
      where: {
        eventId,
        ...(filtrate ? { registrationId: { in: iscrizioniChieste } } : {}),
      },
      select: {
        displayName: nomi,
        jitsiUserId: true,
        registrationId: true,
        locale: true,
        consentedAt: true,
        withdrawnAt: true,
        textVersion: true,
        registration: { select: { emailHash: true } },
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
      source: 'room' as const,
      role:
        p.eventModeratorId || p.staffAccountId
          ? ('host' as const)
          : ruoloDelPosto(p.jitsiUserId, p.registrationId),
      displayName: p.displayName ?? null,
      emailHash:
        p.registration?.emailHash ??
        p.eventModerator?.emailHash ??
        p.staffAccount?.emailHash ??
        null,
      locale: p.locale ?? null,
      holder: p.staffAccountId
        ? `staff:${p.staffAccountId}`
        : p.eventModeratorId
          ? `concessione:${p.eventModeratorId}`
          : titolareDelPosto(p.jitsiUserId, p.registrationId),
    };
    // Un consenso ridato dopo un ritiro: i periodi di prima, poi quello attuale.
    for (const periodo of periodiPrecedenti(p.earlierPeriods)) {
      righe.push({
        ...base,
        givenAt: periodo.consentedAt,
        withdrawnAt: periodo.withdrawnAt ?? null,
        textVersion: periodo.textVersion ?? null,
        destination: periodo.destination ?? null,
      });
    }
    righe.push({
      ...base,
      givenAt: p.consentedAt.toISOString(),
      withdrawnAt: p.withdrawnAt?.toISOString() ?? null,
      textVersion: p.textVersion ?? null,
      destination: p.destination ?? null,
    });
  }
  for (const p of trascrizione) {
    righe.push({
      kind: 'transcription',
      source: 'room',
      role: ruoloDelPosto(p.jitsiUserId, p.registrationId),
      displayName: p.displayName ?? null,
      emailHash: p.registration?.emailHash ?? null,
      locale: p.locale ?? null,
      givenAt: p.consentedAt.toISOString(),
      withdrawnAt: p.withdrawnAt?.toISOString() ?? null,
      textVersion: p.textVersion,
      destination: null,
      holder: titolareDelPosto(p.jitsiUserId, p.registrationId),
    });
  }
  return righe;
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
    givenAt: r.givenAt,
    withdrawnAt: r.withdrawnAt,
    textVersion: r.textVersion,
    destination: r.destination,
    holder: improntaTitolare(eventId, r.holder),
  }));
  for (const p of conservate) {
    righe.push({
      kind: p.kind as TipoConsenso,
      source: p.source as OrigineConsenso,
      role: p.role as RuoloConsenso,
      name: nome(p.displayName),
      nomeRimosso: !!p.nameRemovedAt,
      conservata: true,
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
 * di nuovo (nessun dato lo lega alla visita di prima). Senza nomi.
 */
export function riepilogoProve(
  righe: readonly ProvaConsenso[]
): Record<TipoConsenso, { given: number; withdrawn: number }> {
  const stato = new Map<string, boolean>();
  for (const r of righe) {
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
