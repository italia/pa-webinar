/**
 * La valutazione di fine evento spetta a chi ha partecipato. Le prove, in
 * ordine:
 * - l'iscrizione entrata in sala (Registration.joinedAt), con il link
 *   personale o con il link della valutazione dell'email (lib/feedback/rating-link);
 * - il token della sala ricevuto entrando, firmato dal portale per quella
 *   stanza (lib/auth/jwt postoDaTokenSala): ospiti, chi interviene, un
 *   iscritto entrato da un altro dispositivo. Il token di chi modera non vale.
 * L'identificativo dell'ospite lo genera il browser e da solo non prova niente.
 *
 * Una risposta a testa. Un iscritto risponde con la sua iscrizione, anche
 * quando la prova e' il token del suo posto (che la contiene). Un'iscrizione
 * mai entrata non vale come identita' se la prova e' il posto di qualcun
 * altro: chi ha in mano il link di un altro non risponde a suo nome. Chi entra
 * senza iscrizione risponde una volta per ingresso in sala: e' anonimo, e chi
 * rientra riceve un posto nuovo; e' la stessa garanzia dei voti ai sondaggi, e
 * il numero di ingressi lo frena il limite sui token della sala.
 */
import { postoDaTokenSala } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';

import { verifyRatingToken } from './rating-link';

export interface IdentitaValutazione {
  /** L'iscrizione a cui va la risposta (una a testa). */
  registrationId: string | null;
  /** Per chi non e' iscritto: la chiave della risposta, il posto in sala. */
  chiaveOspite: string | null;
}

/** La chiave di una risposta a testa per chi entra senza iscrizione. */
export function chiaveDelPosto(posto: string): string {
  return `posto:${posto}`;
}

async function iscrizioneDellEvento(id: string, eventId: string): Promise<{ id: string; joinedAt: Date | null } | null> {
  const r = await prisma.registration.findUnique({
    where: { id },
    select: { id: true, eventId: true, joinedAt: true },
  });
  return r && r.eventId === eventId ? { id: r.id, joinedAt: r.joinedAt } : null;
}

export async function identitaPerValutazione(opts: {
  eventId: string;
  roomName: string;
  /** L'iscrizione del link personale, gia' verificata dal chiamante. */
  iscrizione: { id: string; joinedAt: Date | null } | null;
  ratingToken?: string | null;
  tokenSala?: string | null;
}): Promise<IdentitaValutazione> {
  if (opts.iscrizione?.joinedAt) return { registrationId: opts.iscrizione.id, chiaveOspite: null };

  const dalLink = opts.ratingToken ? verifyRatingToken(opts.ratingToken, opts.eventId) : null;
  if (dalLink) {
    const iscrizione = await iscrizioneDellEvento(dalLink, opts.eventId);
    if (iscrizione?.joinedAt) return { registrationId: iscrizione.id, chiaveOspite: null };
  }

  const prova = opts.tokenSala ? await postoDaTokenSala(opts.tokenSala, opts.roomName) : null;
  if (prova?.iscrizioneId) {
    const iscrizione = await iscrizioneDellEvento(prova.iscrizioneId, opts.eventId);
    if (iscrizione) return { registrationId: iscrizione.id, chiaveOspite: null };
  }
  if (prova) return { registrationId: null, chiaveOspite: chiaveDelPosto(prova.posto) };

  throw new AppError('Only people who took part can rate this event', 403, 'NOT_A_PARTICIPANT');
}
