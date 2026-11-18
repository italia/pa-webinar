// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Chi era in sala durante una registrazione, e dove compare nel video.
 *
 * La sala sa chi e' chi per posto della conferenza (`RoomOccupant`, scritto da
 * Prosody): il posto di un iscritto e' `reg-<iscrizione>-<suffisso>` e cambia a
 * ogni ingresso, quello di chi conduce o di un ospite e' nuovo a ogni token.
 * Qui i posti di un'iscrizione diventano una persona sola; gli altri restano
 * uno per posto, con il nome che la sala ha visto, e lo staff ne sceglie anche
 * piu' d'uno quando la stessa persona e' rientrata con un altro link.
 */
import type { Prisma } from '@prisma/client';

import { iscrizioneDelPosto } from '@/lib/captions/room';
import { zeroDelVideo } from '@/lib/captions/transcript';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { PREFISSO_POSTO_MODERATORE } from '@/lib/auth/jwt';
import { isRecorderSeat } from '@/lib/recorder/seat';

import {
  intervalliDelleFrasi,
  intervalliDelleTracce,
  intervalliDiParola,
  intervalliDiPresenza,
  proposte,
  type IntervalloProposto,
  type RegistroDiSessione,
  type VoceDelRegistro,
} from './intervals';

type Db = Prisma.TransactionClient | typeof prisma;

/** Quanto serve della registrazione per collocarla nel tempo. */
export interface RegistrazioneNelTempo {
  id: string;
  eventId: string;
  blobKey: string;
  mediaStartedAt: Date | null;
  createdAt: Date;
  durationSec: number | null;
}

export const CAMPI_TEMPO = {
  id: true,
  eventId: true,
  blobKey: true,
  mediaStartedAt: true,
  createdAt: true,
  durationSec: true,
} as const;

/** L'inizio del video e la sua durata, se nota (lo zero dei tempi della pipeline). */
export async function finestra(
  db: Db,
  r: RegistrazioneNelTempo
): Promise<{ t0: Date; durata: number | null; fine: Date | null }> {
  const t0 = await zeroDelVideo(db as Prisma.TransactionClient, r);
  const durata = r.durationSec && r.durationSec > 0 ? r.durationSec : null;
  return { t0, durata, fine: durata ? new Date(t0.getTime() + durata * 1000) : null };
}

/** I posti e gli endpoint di chi chiede di essere tolto. */
export interface IdentitaInSala {
  seatIds: readonly string[];
  endpointIds: readonly string[];
}

export type TipoPersona = 'registrant' | 'host' | 'guest';

export interface PersonaInSala {
  /** `reg:<iscrizione>` o `seat:<posto>`: stabile per la durata della richiesta. */
  key: string;
  name: string | null;
  kind: TipoPersona;
  registrationId: string | null;
  seatIds: string[];
  endpointIds: string[];
  firstJoinedAt: string;
  lastLeftAt: string | null;
  /** Almeno un ingresso con la voce nel video (con il consenso alla registrazione). */
  inVideo: boolean;
}

function tipoDelPosto(seatId: string): TipoPersona {
  if (iscrizioneDelPosto(seatId)) return 'registrant';
  if (seatId.startsWith(PREFISSO_POSTO_MODERATORE)) return 'host';
  return 'guest';
}

/** Il registro di chi parla di una sessione, come lo scrive la sala. */
export function vociDelRegistro(
  log: unknown
): Array<VoceDelRegistro & { displayName?: string }> {
  if (!Array.isArray(log)) return [];
  return log.flatMap((v) => {
    const voce = v as {
      atMs?: unknown;
      participantId?: unknown;
      displayName?: unknown;
    } | null;
    if (!voce || typeof voce.atMs !== 'number' || typeof voce.participantId !== 'string')
      return [];
    return [
      {
        atMs: voce.atMs,
        participantId: voce.participantId,
        ...(typeof voce.displayName === 'string'
          ? { displayName: voce.displayName }
          : {}),
      },
    ];
  });
}

/**
 * Le persone che erano in sala mentre la registrazione girava, per il modulo
 * con cui lo staff registra una richiesta arrivata per altre vie. Nome in
 * chiaro: e' per l'amministrazione, che lo vede gia' nell'elenco degli
 * iscritti, e non lascia questa risposta.
 */
export async function personeDellaRegistrazione(
  recordingId: string,
  db: Db = prisma
): Promise<PersonaInSala[]> {
  const r = await db.recording.findUnique({
    where: { id: recordingId },
    select: CAMPI_TEMPO,
  });
  if (!r) return [];
  const { t0, fine } = await finestra(db, r);
  const occupanti = await db.roomOccupant.findMany({
    where: {
      eventId: r.eventId,
      ...(fine ? { joinedAt: { lt: fine } } : {}),
      OR: [{ leftAt: null }, { leftAt: { gt: t0 } }],
    },
    select: {
      endpointId: true,
      seatId: true,
      voiceExcluded: true,
      joinedAt: true,
      leftAt: true,
    },
    orderBy: { joinedAt: 'asc' },
  });
  const inSala = occupanti.filter((o) => o.seatId && !isRecorderSeat(o.seatId));
  if (inSala.length === 0) return [];

  const persone = new Map<string, PersonaInSala>();
  const ancoraInSala = new Set<string>();
  for (const o of inSala) {
    const registrationId = iscrizioneDelPosto(o.seatId);
    const key = registrationId ? `reg:${registrationId}` : `seat:${o.seatId}`;
    const p =
      persone.get(key) ??
      ({
        key,
        name: null,
        kind: tipoDelPosto(o.seatId),
        registrationId,
        seatIds: [],
        endpointIds: [],
        firstJoinedAt: o.joinedAt.toISOString(),
        lastLeftAt: null,
        inVideo: false,
      } satisfies PersonaInSala);
    if (!p.seatIds.includes(o.seatId)) p.seatIds.push(o.seatId);
    if (!p.endpointIds.includes(o.endpointId)) p.endpointIds.push(o.endpointId);
    if (o.joinedAt.toISOString() < p.firstJoinedAt)
      p.firstJoinedAt = o.joinedAt.toISOString();
    // Un ingresso senza uscita: la persona era ancora in sala alla fine.
    if (!o.leftAt) ancoraInSala.add(key);
    else if (!p.lastLeftAt || o.leftAt.toISOString() > p.lastLeftAt)
      p.lastLeftAt = o.leftAt.toISOString();
    p.inVideo ||= !o.voiceExcluded;
    persone.set(key, p);
  }
  for (const key of ancoraInSala) persone.get(key)!.lastLeftAt = null;

  await assegnaNomi(db, r, [...persone.values()]);
  return [...persone.values()].sort(
    (a, b) =>
      (a.name ?? '￿').localeCompare(b.name ?? '￿') ||
      a.firstJoinedAt.localeCompare(b.firstJoinedAt)
  );
}

/**
 * Il nome di ciascuno: l'iscrizione per gli iscritti; per gli altri posti la
 * prova del consenso data in sala, poi il nome che il registro di chi parla ha
 * visto per i suoi endpoint, poi quello della sua traccia.
 */
async function assegnaNomi(
  db: Db,
  r: RegistrazioneNelTempo,
  persone: PersonaInSala[]
): Promise<void> {
  const iscrizioni = persone.flatMap((p) => (p.registrationId ? [p.registrationId] : []));
  const posti = persone.flatMap((p) => p.seatIds);
  const endpoint = persone.flatMap((p) => p.endpointIds);
  const [registrazioni, proveR, proveT, sessioni, tracce] = await Promise.all([
    iscrizioni.length
      ? db.registration.findMany({
          where: { id: { in: iscrizioni } },
          select: { id: true, displayName: true },
        })
      : [],
    db.recordingConsent.findMany({
      where: { eventId: r.eventId, jitsiUserId: { in: posti } },
      select: { jitsiUserId: true, displayName: true },
    }),
    db.multitrackConsent.findMany({
      where: { eventId: r.eventId, jitsiUserId: { in: posti } },
      select: { jitsiUserId: true, displayName: true },
    }),
    db.callSession.findMany({
      where: { eventId: r.eventId },
      select: { dominantSpeakerLog: true },
    }),
    db.recordingTrack.findMany({
      where: { recordingId: r.id, participantId: { in: endpoint } },
      select: { participantId: true, displayName: true },
    }),
  ]);
  const perIscrizione = new Map(
    registrazioni.map((x) => [x.id, tryDecryptPII(x.displayName)])
  );
  const perPosto = new Map<string, string | null>();
  for (const p of [...proveR, ...proveT]) {
    if (!perPosto.get(p.jitsiUserId))
      perPosto.set(p.jitsiUserId, tryDecryptPII(p.displayName));
  }
  const perEndpoint = new Map<string, string>();
  for (const s of sessioni) {
    for (const v of vociDelRegistro(s.dominantSpeakerLog)) {
      if (v.displayName) perEndpoint.set(v.participantId, v.displayName);
    }
  }
  for (const t of tracce) {
    const nome = t.displayName ? tryDecryptPII(t.displayName) : null;
    if (nome && !perEndpoint.has(t.participantId)) perEndpoint.set(t.participantId, nome);
  }
  for (const p of persone) {
    p.name =
      (p.registrationId ? perIscrizione.get(p.registrationId) : null) ??
      p.seatIds.map((s) => perPosto.get(s)).find((n) => !!n) ??
      p.endpointIds.map((e) => perEndpoint.get(e)).find((n) => !!n) ??
      null;
  }
}

/**
 * I posti e gli endpoint di un'iscrizione nella sala dell'evento: tutti i suoi
 * ingressi con il link di iscrizione.
 */
export async function identitaDellIscrizione(
  db: Db,
  eventId: string,
  registrationId: string
): Promise<IdentitaInSala> {
  const righe = await db.roomOccupant.findMany({
    where: { eventId, seatId: { startsWith: `reg-${registrationId}-` } },
    select: { seatId: true, endpointId: true },
  });
  return {
    seatIds: [...new Set(righe.map((x) => x.seatId))],
    endpointIds: [...new Set(righe.map((x) => x.endpointId))],
  };
}

/** Gli endpoint dei posti scelti, letti dalla sala (un posto puo' averne piu' d'uno). */
export async function endpointDeiPosti(
  db: Db,
  eventId: string,
  seatIds: readonly string[]
): Promise<string[]> {
  if (seatIds.length === 0) return [];
  const righe = await db.roomOccupant.findMany({
    where: { eventId, seatId: { in: [...seatIds] } },
    select: { endpointId: true },
  });
  return [...new Set(righe.map((x) => x.endpointId))];
}

/**
 * Dove la persona compare o parla nel video, da tutte le fonti che la sala ha
 * lasciato. Vuoto quando la sala non ne sa niente (la persona e' entrata senza
 * token, o i dati sono gia' stati cancellati): lo staff segna gli intervalli a
 * mano.
 */
export async function proposteDellaPersona(
  db: Db,
  r: RegistrazioneNelTempo,
  identita: IdentitaInSala
): Promise<IntervalloProposto[]> {
  const { seatIds, endpointIds } = identita;
  if (seatIds.length === 0 && endpointIds.length === 0) return [];
  const { t0, durata, fine } = await finestra(db, r);
  const endpoint = new Set(endpointIds);
  const chi: Prisma.RoomOccupantWhereInput[] = [
    ...(seatIds.length ? [{ seatId: { in: [...seatIds] } }] : []),
    ...(endpointIds.length ? [{ endpointId: { in: [...endpointIds] } }] : []),
  ];
  const [presenze, frasi, sessioni, tracce] = await Promise.all([
    db.roomOccupant.findMany({
      where: { eventId: r.eventId, OR: chi },
      select: { joinedAt: true, leftAt: true, voiceExcluded: true },
    }),
    endpointIds.length
      ? db.captionSegment.findMany({
          where: {
            eventId: r.eventId,
            endpointId: { in: [...endpointIds] },
            endedAt: { gt: t0 },
            ...(fine ? { startedAt: { lt: fine } } : {}),
          },
          select: { startedAt: true, endedAt: true },
        })
      : [],
    db.callSession.findMany({
      where: { eventId: r.eventId },
      select: { startedAt: true, dominantSpeakerLog: true },
    }),
    endpointIds.length
      ? db.recordingTrack.findMany({
          where: { recordingId: r.id, participantId: { in: [...endpointIds] } },
          select: { startOffsetMs: true, durationMs: true },
        })
      : [],
  ]);
  const registri: RegistroDiSessione[] = sessioni.map((s) => ({
    startedAt: s.startedAt,
    log: vociDelRegistro(s.dominantSpeakerLog),
  }));
  return proposte(
    intervalliDiPresenza(presenze, t0, durata),
    intervalliDelleFrasi(frasi, t0, durata),
    intervalliDiParola(registri, endpoint, t0, durata),
    intervalliDelleTracce(tracce, durata)
  );
}
