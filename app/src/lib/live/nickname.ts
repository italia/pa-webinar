// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Il nickname di chi partecipa (Event.nicknamesEnabled): un nome scelto dalla
 * persona, che gli altri vedono al posto del suo in video (il nome nel token
 * della conferenza), in chat, nelle domande e nella trascrizione dai
 * sottotitoli; il registratore per persona legge lo stesso nome dalla
 * conferenza. Col pubblico anonimo prende il posto dello pseudonimo. Chi
 * conduce non ne ha: e' sempre nel video con il suo nome.
 *
 * Dove vive:
 * - l'iscritto, dal browser con cui si e' iscritto, lo salva sull'iscrizione
 *   (cifrato, `Registration.nickname`): vale a ogni ingresso finche' non lo
 *   cambia o lo toglie, e va via con l'iscrizione;
 * - l'ospite, e chi apre il link di un altro, lo tiene solo per la visita: la
 *   pagina lo manda con ogni richiesta del token, e il server ne prende nota in
 *   Redis (un'impronta e chi l'ha preso, con scadenza) perche' resti unico e
 *   perche' chat e domande lo riconoscano come suo.
 *
 * Il server lo controlla sempre (lib/live/nickname-rule per la forma), non si
 * fida della pagina: niente parole della piattaforma (i ruoli, lo pseudonimo,
 * in tutte le lingue), niente somiglianze con chi conduce l'evento, unico
 * nell'evento. A chi lo trova occupato propone un'alternativa libera.
 *
 * Chi organizza e chi modera vedono chi c'e' dietro come per gli pseudonimi:
 * la scheda Partecipanti mostra nome ed email dell'iscrizione accanto al
 * nickname (api/events/[param]/seats), e l'elenco degli iscritti lo riporta
 * accanto al nome. Dietro il nickname di un ospite c'e' solo quello che
 * l'ospite ha scritto.
 */

import { createHash, createHmac } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { getTranslations } from 'next-intl/server';

import { locales } from '@/i18n/config';
import { getCached, setCache } from '@/lib/cache';
import { encryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { pseudonimo } from '@/lib/live/pseudonym';
import {
  alternativeNickname,
  difettoDiForma,
  formaDiConfronto,
  imitaUnNome,
  normalizzaNickname,
  usaUnaParolaRiservata,
  type MotivoNickname,
} from '@/lib/live/nickname-rule';
import { getRedis, withDeadline } from '@/lib/redis';

export type EsitoNickname =
  | { ok: true; nickname: string }
  | { ok: false; motivo: MotivoNickname; suggerimento?: string };

/** Chi chiede il nickname: un'iscrizione, o un ospite con la sua chiave. */
export type ChiloChiede = { iscrizione: string } | { ospite: string };

/**
 * L'impronta di un nickname nell'evento: HMAC con APP_SECRET della forma di
 * confronto, come `hashEmail`. Con l'evento dentro, lo stesso nickname in due
 * eventi non si riconosce. Senza APP_SECRET (solo in sviluppo) SHA-256.
 */
export function improntaNickname(eventId: string, nickname: string): string {
  const input = `nickname:${eventId}:${formaDiConfronto(nickname)}`;
  const secret = process.env.APP_SECRET;
  return secret
    ? createHmac('sha256', secret).update(input).digest('hex')
    : createHash('sha256').update(input).digest('hex');
}

// ── Parole riservate ──

const RISERVATE_TTL_MS = 5 * 60_000;
let riservate: { parole: string[]; at: number } | null = null;

/**
 * Le parole della piattaforma in tutte le lingue: i ruoli (`live.nickname.
 * reserved`, una lista separata da virgole che ogni lingua compila con le sue
 * forme) e la parola dello pseudonimo (`live.pseudonym` senza il codice), con
 * le traduzioni personalizzate dall'amministrazione. Letta ogni cinque minuti.
 */
export async function paroleRiservate(): Promise<string[]> {
  if (riservate && Date.now() - riservate.at < RISERVATE_TTL_MS) return riservate.parole;
  const parole = new Set<string>();
  await Promise.all(
    locales.map(async (locale) => {
      const t = await getTranslations({ locale, namespace: 'live' });
      for (const p of t('nickname.reserved').split(','))
        if (p.trim()) parole.add(p.trim());
      const prefisso = t('pseudonym', { code: '' })
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .trim();
      if (prefisso) parole.add(prefisso);
    })
  );
  riservate = { parole: [...parole], at: Date.now() };
  return riservate.parole;
}

/** Solo per i test. */
export function resetNicknameCachesForTests(): void {
  riservate = null;
  memoria.clear();
}

// ── Chi conduce ──

const CONDUCE_TTL_MS = 60_000;

/** Un segmento di testo libero che sembra un nome: poche parole. */
const PAROLE_DI_UN_NOME = 4;

/**
 * I nomi di chi conduce l'evento: il moderatore principale, le concessioni
 * nominali ancora valide (moderatori, relatori, organizzatori), l'account che
 * l'ha creato, e i relatori scritti nella pagina dell'evento (una riga o un
 * elenco separato da virgole, di poche parole). Letti una volta al minuto per
 * evento: una concessione aggiunta vale al piu' un minuto dopo.
 */
export async function nomiDiChiConduce(eventId: string): Promise<string[]> {
  const chiave = `nickname-hosts:${eventId}`;
  const memo = getCached<string[]>(chiave);
  if (memo) return memo;
  const evento = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      moderatorName: true,
      speakersInfo: true,
      createdBy: { select: { name: true } },
      additionalMods: { where: { revokedAt: null }, select: { name: true } },
    },
  });
  const nomi: string[] = [];
  const chiaro = (v: string | null | undefined) => (v ? (tryDecryptPII(v) ?? v) : null);
  if (evento) {
    for (const v of [
      chiaro(evento.moderatorName),
      chiaro(evento.createdBy?.name),
      ...evento.additionalMods.map((m) => chiaro(m.name)),
    ]) {
      if (v?.trim()) nomi.push(v.trim());
    }
    const info = evento.speakersInfo;
    if (info && typeof info === 'object' && !Array.isArray(info)) {
      for (const testo of Object.values(info as Record<string, unknown>)) {
        if (typeof testo !== 'string') continue;
        for (const riga of testo.split(/\r?\n/)) {
          const pulita = riga.replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, '');
          for (const pezzo of pulita.split(/[,;|()–—:]/u)) {
            const p = pezzo.trim();
            if (p && p.split(/\s+/u).length <= PAROLE_DI_UN_NOME) nomi.push(p);
          }
        }
      }
    }
  }
  setCache(chiave, nomi, CONDUCE_TTL_MS);
  return nomi;
}

// ── I nickname degli ospiti, per la visita ──

// Una chiave per nickname, con la sua scadenza: un nickname lasciato (cambiato,
// o di chi se n'e' andato) si libera dodici ore dopo l'ultimo ingresso di chi
// l'aveva, qualunque cosa facciano gli altri. Il valore dice chi l'ha preso (la
// chiave dell'ospite) e con quale posto della sala e' entrato l'ultima volta:
// il posto e' cio' che un token della sala prova, il nome no.
const OSPITI_TTL_SECONDS = 12 * 60 * 60;
const REDIS_TIMEOUT_MS = 1500;
const MEMORIA_TETTO = 5000;
const chiaveRedis = (eventId: string, impronta: string) =>
  `live:nickname:${eventId}:${impronta}`;

/** Chi tiene un nickname: la chiave dell'ospite e il suo ultimo posto. */
interface Presa {
  chi: string;
  posto: string;
}
const scrivi = (p: Presa) => `${p.chi}|${p.posto}`;
function leggi(v: string | null | undefined): Presa | null {
  if (!v) return null;
  const i = v.indexOf('|');
  return i < 0 ? { chi: v, posto: '' } : { chi: v.slice(0, i), posto: v.slice(i + 1) };
}

const memoria = new Map<string, Map<string, { valore: string; at: number }>>();
let ultimaPulizia = 0;

function memoriaEvento(eventId: string): Map<string, { valore: string; at: number }> {
  // La pulizia di tutta la memoria al piu' una volta al minuto: la si legge a
  // ogni messaggio in chat di un ospite.
  if (Date.now() - ultimaPulizia > 60_000) {
    ultimaPulizia = Date.now();
    const scadenza = Date.now() - OSPITI_TTL_SECONDS * 1000;
    for (const [ev, m] of memoria) {
      for (const [k, v] of m) if (v.at < scadenza) m.delete(k);
      if (m.size === 0 && ev !== eventId) memoria.delete(ev);
    }
  }
  let m = memoria.get(eventId);
  if (!m) {
    m = new Map();
    memoria.set(eventId, m);
  }
  return m;
}

/** I valori grezzi di queste impronte fra gli ospiti, nello stesso ordine. */
async function valoriOspiti(
  eventId: string,
  impronte: readonly string[]
): Promise<Array<string | null>> {
  if (impronte.length === 0) return [];
  const redis = getRedis();
  if (redis) {
    const valori = await withDeadline(
      redis.mget(...impronte.map((k) => chiaveRedis(eventId, k))),
      REDIS_TIMEOUT_MS,
      null
    );
    if (valori) return valori.map((v) => v ?? null);
  }
  const m = memoriaEvento(eventId);
  const scadenza = Date.now() - OSPITI_TTL_SECONDS * 1000;
  return impronte.map((k) => {
    const v = m.get(k);
    return v && v.at >= scadenza ? v.valore : null;
  });
}

/** Chi ha preso queste impronte fra gli ospiti, nello stesso ordine. */
async function presiDaOspiti(
  eventId: string,
  impronte: readonly string[]
): Promise<Array<string | null>> {
  return (await valoriOspiti(eventId, impronte)).map((v) => leggi(v)?.chi ?? null);
}

// Scrive il valore nuovo solo se c'e' ancora quello letto (o nessuno, con ''):
// una presa scaduta e ripresa da un altro nel frattempo non si sovrascrive.
const SOSTITUISCI = `
local v = redis.call('GET', KEYS[1])
if (v == false and ARGV[1] == '') or v == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
  return 1
end
return 0`;

/** Sostituisce `atteso` (null: nessuno) con `nuovo`. Vero se e' riuscito. */
async function sostituisci(
  eventId: string,
  impronta: string,
  atteso: string | null,
  nuovo: string
): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    const esito = await withDeadline(
      redis.eval(
        SOSTITUISCI,
        1,
        chiaveRedis(eventId, impronta),
        atteso ?? '',
        nuovo,
        String(OSPITI_TTL_SECONDS)
      ) as Promise<unknown>,
      REDIS_TIMEOUT_MS,
      null
    );
    if (esito !== null) return esito === 1;
    // Redis non risponde: si ripiega sulla memoria, come senza Redis.
  }
  const m = memoriaEvento(eventId);
  const prima = m.get(impronta);
  const viva =
    prima && prima.at >= Date.now() - OSPITI_TTL_SECONDS * 1000 ? prima.valore : null;
  if (viva !== atteso) return false;
  if (!prima && m.size >= MEMORIA_TETTO) return false;
  m.set(impronta, { valore: nuovo, at: Date.now() });
  return true;
}

// ── Il controllo ──

/** Per ogni candidato, se e' libero per chi lo chiede. */
async function liberi(
  eventId: string,
  candidati: readonly string[],
  chi: ChiloChiede
): Promise<boolean[]> {
  const impronte = candidati.map((c) => improntaNickname(eventId, c));
  const [iscrizioni, ospiti] = await Promise.all([
    prisma.registration.findMany({
      where: { eventId, nicknameKey: { in: impronte } },
      select: { id: true, nicknameKey: true },
    }),
    presiDaOspiti(eventId, impronte),
  ]);
  return impronte.map((k, i) => {
    const iscrizione = iscrizioni.find((r) => r.nicknameKey === k);
    if (iscrizione && !('iscrizione' in chi && chi.iscrizione === iscrizione.id))
      return false;
    const ospite = ospiti[i];
    // Un nickname preso da un ospite non passa a un iscritto, e viceversa.
    return !ospite || ('ospite' in chi && chi.ospite === ospite);
  });
}

/** Le regole che non dipendono da chi altro c'e'. */
async function difettoNellEvento(
  eventId: string,
  nick: string
): Promise<MotivoNickname | null> {
  const forma = difettoDiForma(nick);
  if (forma) return forma;
  if (usaUnaParolaRiservata(nick, await paroleRiservate())) return 'reserved';
  if (imitaUnNome(nick, await nomiDiChiConduce(eventId))) return 'host';
  return null;
}

async function suggerimento(
  eventId: string,
  nick: string,
  chi: ChiloChiede
): Promise<string | undefined> {
  const [parole, nomi] = await Promise.all([
    paroleRiservate(),
    nomiDiChiConduce(eventId),
  ]);
  const candidati = alternativeNickname(nick).filter(
    (c) =>
      !difettoDiForma(c) && !usaUnaParolaRiservata(c, parole) && !imitaUnNome(c, nomi)
  );
  const esiti = await liberi(eventId, candidati, chi);
  return candidati.find((_, i) => esiti[i]);
}

/** Il controllo completo, senza salvare ne' prendere niente. */
export async function verificaNickname(
  eventId: string,
  raw: string,
  chi: ChiloChiede
): Promise<EsitoNickname> {
  const nick = normalizzaNickname(raw);
  const difetto = await difettoNellEvento(eventId, nick);
  if (difetto) return { ok: false, motivo: difetto };
  const [libero] = await liberi(eventId, [nick], chi);
  if (!libero)
    return {
      ok: false,
      motivo: 'taken',
      suggerimento: await suggerimento(eventId, nick, chi),
    };
  return { ok: true, nickname: nick };
}

/**
 * Salva (o toglie, con null) il nickname di un'iscrizione. Il vincolo unico
 * sull'impronta tiene fuori due iscritti che lo scelgono insieme.
 */
export async function salvaNicknameIscrizione(
  eventId: string,
  registrationId: string,
  raw: string | null
): Promise<EsitoNickname | { ok: true; nickname: null }> {
  if (raw === null) {
    await prisma.registration.update({
      where: { id: registrationId },
      data: { nickname: null, nicknameKey: null },
    });
    return { ok: true, nickname: null };
  }
  const chi = { iscrizione: registrationId };
  const esito = await verificaNickname(eventId, raw, chi);
  if (!esito.ok) return esito;
  try {
    await prisma.registration.update({
      where: { id: registrationId },
      data: {
        nickname: encryptPII(esito.nickname),
        nicknameKey: improntaNickname(eventId, esito.nickname),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return {
        ok: false,
        motivo: 'taken',
        suggerimento: await suggerimento(eventId, esito.nickname, chi),
      };
    }
    throw err;
  }
  return esito;
}

/**
 * Il nickname di un ospite per la visita: controllato e preso per la sua
 * chiave (`guestSenderId` dell'indirizzo e del nickname, la stessa con cui
 * scrive in chat) e per il posto del token che sta per entrare, per dodici ore
 * dall'ultimo ingresso. Le regole valgono quando lo si prende: chi lo tiene lo
 * ritrova a ogni rientro senza ripeterle, cosi' un relatore aggiunto dopo non
 * fa uscire chi e' gia' in sala.
 *
 * `postiDellaVisita`: i posti provati dai token della sala di questa visita,
 * letti solo se servono. Se uno e' l'ultimo posto di chi tiene il nickname,
 * l'ospite e' lo stesso tornato da un'altra rete, e lo riprende. Conta il
 * posto, non il nome: un token con lo stesso nome, preso scrivendolo come nome,
 * non prova niente.
 */
export async function prendiNicknameOspite(
  eventId: string,
  raw: string,
  chiaveOspite: (nickname: string) => string,
  posto: string,
  postiDellaVisita: () => Promise<ReadonlySet<string>> = async () => new Set()
): Promise<EsitoNickname> {
  const nick = normalizzaNickname(raw);
  const chi = { ospite: chiaveOspite(nick) };
  const forma = difettoDiForma(nick);
  if (forma) return { ok: false, motivo: forma };
  const impronta = improntaNickname(eventId, nick);
  const nuovo = scrivi({ chi: chi.ospite, posto });
  const valore = (await valoriOspiti(eventId, [impronta]))[0] ?? null;
  const presa = leggi(valore);
  if (
    valore !== null &&
    presa &&
    (presa.chi === chi.ospite ||
      (presa.posto !== '' && (await postiDellaVisita()).has(presa.posto))) &&
    (await sostituisci(eventId, impronta, valore, nuovo))
  ) {
    return { ok: true, nickname: nick };
  }
  const esito = await verificaNickname(eventId, nick, chi);
  if (!esito.ok) return esito;
  if (!(await sostituisci(eventId, impronta, null, nuovo))) {
    return {
      ok: false,
      motivo: 'taken',
      suggerimento: await suggerimento(eventId, nick, chi),
    };
  }
  return esito;
}

/** Il nome scritto da un ospite e' un nickname preso da lui in questa visita. */
export async function nicknameDellOspite(
  eventId: string,
  nome: string,
  chiaveOspite: string
): Promise<boolean> {
  const nick = normalizzaNickname(nome);
  if (difettoDiForma(nick)) return false;
  const [chi] = await presiDaOspiti(eventId, [improntaNickname(eventId, nick)]);
  return chi === chiaveOspite;
}

/** Il nickname salvato su un'iscrizione, in chiaro. */
export function nicknameDellIscrizione(registration: {
  nickname?: string | null;
}): string | null {
  return registration.nickname ? (tryDecryptPII(registration.nickname) ?? null) : null;
}

/**
 * Il nome che gli altri vedono di chi partecipa: il nickname se c'e', altrimenti
 * lo pseudonimo del posto col pubblico anonimo, altrimenti il nome.
 */
export async function nomeDiChiPartecipa(
  evento: { id: string; audienceAnonymous?: boolean | null },
  posto: string,
  nickname: string | null,
  nome: string
): Promise<string> {
  if (nickname) return nickname;
  return evento.audienceAnonymous ? pseudonimo(evento.id, posto) : nome;
}

/**
 * La risposta a un nickname rifiutato, uguale per la rotta del token e per
 * quella del nickname: 422 `NICKNAME_INVALID` con il motivo, o 409
 * `NICKNAME_TAKEN` con un'alternativa libera quando c'e'.
 */
export function rispostaNicknameRifiutato(esito: {
  motivo: MotivoNickname;
  suggerimento?: string;
}): Response {
  const occupato = esito.motivo === 'taken';
  return Response.json(
    {
      error: occupato ? 'Nickname already in use in this event' : 'Nickname not allowed',
      code: occupato ? 'NICKNAME_TAKEN' : 'NICKNAME_INVALID',
      reason: esito.motivo,
      ...(esito.suggerimento ? { suggestion: esito.suggerimento } : {}),
    },
    { status: occupato ? 409 : 422, headers: { 'Cache-Control': 'no-store' } }
  );
}
