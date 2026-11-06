// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { Prisma } from '@prisma/client';

import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { tipiDiProvaDaConservare } from '@/lib/gdpr/cleanup-selection';
import {
  improntaTitolare,
  leggiRigheProve,
  periodiSostituiti,
  titolareIscrizione,
  type FiltroProve,
  type LettoreProve,
  type TipoConsenso,
} from '@/lib/gdpr/consent-proofs';

/**
 * Le prove dei consensi che restano quando le loro sorgenti se ne vanno
 * (RetainedConsentProof): un video o una trascrizione pubblicati devono poter
 * dimostrare il consenso (art. 7.1 GDPR) anche dopo la pulizia dei dati
 * dell'evento o la cancellazione chiesta da una persona.
 *
 * La copia sta nella stessa transazione che cancella le sorgenti, e la precede:
 * iscrizioni, prove di sala e concessioni portano nome e indirizzo, e dopo non
 * ci sono piu'. Il nome cifrato si copia senza decifrarlo. Una riga per periodo
 * del consenso. La tabella non ha chiavi verso le sorgenti, cosi' chi legge i
 * consensi vivi (token della sala, sottotitoli, trascrizione) non scambia una
 * prova storica per un consenso che vale.
 *
 * Dopo una cancellazione chiesta dalla persona la prova resta senza nome, con
 * il ritiro all'ora della richiesta: conserva tipo, date, testo e impronta
 * dell'indirizzo, senza i quali non proverebbe niente. Per ospiti e per le
 * prove di trascrizione di chi conduce l'impronta non c'e': la persona non puo'
 * toglierle da sola, e se ne vanno con il video.
 *
 * Se ne vanno al primo giro della pulizia dopo che video e trascrizione non sono
 * piu' pubblicati (lib/gdpr/cleanup-selection), oppure con l'evento: cancellare
 * un evento cancella le sue prove anche se un video esterno resta online.
 */

/** Le stesse tabelle della lettura, piu' quella in cui si copia. */
type ClienteCopia = LettoreProve & Pick<Prisma.TransactionClient, 'retainedConsentProof'>;

/** Lo stato di pubblicazione dell'evento, letto dentro la transazione. */
export async function tipiDelleProve(
  db: Pick<Prisma.TransactionClient, 'event' | 'postprodArtifact'>,
  eventId: string
): Promise<TipoConsenso[]> {
  const evento = await db.event.findUnique({
    where: { id: eventId },
    select: {
      youtubeUrl: true,
      recordingUrl: true,
      recordingPublished: true,
      transcriptPublished: true,
    },
  });
  if (!evento) return [];
  // Il flag non si azzera quando si cancella la sessione: da solo terrebbe la
  // prova per sempre.
  const trascrizionePubblicata =
    !!evento.transcriptPublished &&
    (await db.postprodArtifact.count({
      where: { type: 'TRANSCRIPT_JSON', recording: { eventId } },
    })) > 0;
  return tipiDiProvaDaConservare({
    youtubeUrl: evento.youtubeUrl ?? null,
    recordingUrl: evento.recordingUrl ?? null,
    recordingPublished: !!evento.recordingPublished,
    trascrizionePubblicata,
  });
}

/**
 * Copia le prove dei tipi dati e restituisce quante. Va chiamata nella
 * transazione che cancella le sorgenti, prima di cancellarle: le righe nuove non
 * hanno un vincolo unico, e reggono solo perche' la sorgente sparisce con la
 * copia.
 */
export async function conservaProve(
  tx: ClienteCopia,
  {
    eventId,
    tipi,
    senzaNome = false,
    adesso,
    ...filtro
  }: FiltroProve & {
    eventId: string;
    tipi: readonly TipoConsenso[];
    senzaNome?: boolean;
    adesso: Date;
  }
): Promise<number> {
  if (tipi.length === 0) return 0;
  const righe = (await leggiRigheProve(tx, eventId, filtro)).filter((r) =>
    tipi.includes(r.kind)
  );
  if (righe.length === 0) return 0;
  await tx.retainedConsentProof.createMany({
    data: righe.map((r) => ({
      eventId,
      kind: r.kind,
      source: r.source,
      role: r.role,
      holderHash: improntaTitolare(eventId, r.holder),
      emailHash: r.emailHash,
      displayName: senzaNome ? null : r.displayName,
      nameRemovedAt: senzaNome ? adesso : null,
      locale: r.locale,
      textVersion: r.textVersion,
      destination: r.destination,
      givenAt: new Date(r.givenAt),
      withdrawnAt: r.withdrawnAt ? new Date(r.withdrawnAt) : senzaNome ? adesso : null,
    })),
  });
  return righe.length;
}

/** Le prove scelte perdono il nome, e un consenso ancora valido si considera
 *  ritirato ora. Restituisce quante ne ha cambiate. */
async function togliNome(
  tx: Pick<Prisma.TransactionClient, 'retainedConsentProof'>,
  scelte: Prisma.RetainedConsentProofWhereInput,
  adesso: Date
): Promise<number> {
  const dove = { ...scelte, nameRemovedAt: null };
  await tx.retainedConsentProof.updateMany({
    where: { ...dove, withdrawnAt: null },
    data: { withdrawnAt: adesso },
  });
  const { count } = await tx.retainedConsentProof.updateMany({
    where: dove,
    data: { displayName: null, nameRemovedAt: adesso },
  });
  return count;
}

/**
 * La cancellazione di iscrizioni, sulle prove che una pulizia dello stesso evento
 * ha copiato con il nome prima che la cancellazione prendesse il suo turno. Va
 * per titolare, non per indirizzo: la cancellazione dallo staff tocca un solo
 * evento, e la stessa persona puo' avere prove di altri. Restituisce quante prove
 * sono cambiate.
 */
export async function togliNomeDelleIscrizioni(
  tx: Pick<Prisma.TransactionClient, 'retainedConsentProof'>,
  eventId: string,
  registrationIds: readonly string[],
  adesso: Date
): Promise<number> {
  const holderHash = {
    in: registrationIds.map((id) => improntaTitolare(eventId, titolareIscrizione(id))),
  };
  return togliNome(tx, { eventId, holderHash }, adesso);
}

/**
 * La cancellazione chiesta dalla persona, sulle prove gia' conservate del suo
 * indirizzo. Restituisce quante prove sono cambiate per evento: una nuova
 * richiesta non ne cambia nessuna.
 */
export async function togliNomeDalleProve(
  emailHash: string,
  adesso: Date
): Promise<Map<string, number>> {
  return prisma.$transaction(async (tx) => {
    const prove = await tx.retainedConsentProof.findMany({
      where: { emailHash, nameRemovedAt: null },
      select: { eventId: true },
    });
    const perEvento = new Map<string, number>();
    if (prove.length === 0) return perEvento;
    await togliNome(tx, { emailHash }, adesso);
    for (const { eventId } of prove) {
      perEvento.set(eventId, (perEvento.get(eventId) ?? 0) + 1);
    }
    return perEvento;
  });
}

/**
 * Il ritiro di un consenso quando l'iscrizione non c'e' piu' (art. 7.3 GDPR): la
 * prova deve essere di questo indirizzo e di questo tipo. Come per il ritiro
 * dalla sala (lib/live/consent-withdrawal), ritirare la registrazione ritira
 * anche la trascrizione dello stesso evento, che senza registrazione non ha
 * luogo. Vale per tutti i periodi del consenso. Il video non cambia.
 *
 * Restituisce false se la prova non si trova; ritirarla due volte non cambia
 * niente e non scrive nel registro.
 */
export async function ritiraProvaConservata(
  emailHash: string,
  proofId: string,
  consent: TipoConsenso,
  adesso: Date = new Date()
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const prova = await tx.retainedConsentProof.findFirst({
      where: { id: proofId, emailHash, kind: consent },
      select: { eventId: true },
    });
    if (!prova) return false;
    const { eventId } = prova;
    const ritira = async (kind: TipoConsenso) =>
      (
        await tx.retainedConsentProof.updateMany({
          where: { eventId, emailHash, kind, withdrawnAt: null },
          data: { withdrawnAt: adesso },
        })
      ).count;
    const recording = consent === 'recording' ? await ritira('recording') : 0;
    const transcription = await ritira('transcription');
    if (recording + transcription > 0) {
      await tx.gdprAuditLog.create({
        data: {
          eventId,
          action: 'CONSENT_WITHDRAWN',
          recordCount: recording + transcription,
          details: JSON.stringify({ source: 'self-service', recording, transcription }),
        },
      });
    }
    return true;
  });
}

/** Le prove conservate di un indirizzo, per la pagina dei propri dati (art. 15). */
export async function proveConservateDellaPersona(emailHash: string) {
  const prove = await prisma.retainedConsentProof.findMany({
    where: { emailHash },
    select: {
      id: true,
      eventId: true,
      kind: true,
      source: true,
      role: true,
      holderHash: true,
      displayName: true,
      nameRemovedAt: true,
      locale: true,
      textVersion: true,
      destination: true,
      givenAt: true,
      withdrawnAt: true,
      retainedAt: true,
      event: { select: { title: true, startsAt: true } },
    },
    orderBy: { givenAt: 'asc' },
  });
  const sostituite = periodiSostituiti(prove);
  return prove.map((p) => ({
    id: p.id,
    eventId: p.eventId,
    kind: p.kind as TipoConsenso,
    source: p.source,
    role: p.role,
    name: p.displayName ? tryDecryptPII(p.displayName) : null,
    nameRemoved: !!p.nameRemovedAt,
    superseded: sostituite.has(p),
    locale: p.locale,
    textVersion: p.textVersion,
    destination: p.destination,
    givenAt: p.givenAt.toISOString(),
    withdrawnAt: p.withdrawnAt?.toISOString() ?? null,
    retainedAt: p.retainedAt.toISOString(),
    event: { title: p.event.title, startsAt: p.event.startsAt.toISOString() },
  }));
}
