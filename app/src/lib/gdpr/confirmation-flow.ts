// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * I passi comuni delle rotte che modificano un'iscrizione dalla pagina dei propri
 * dati (api/gdpr/registrations/edit, /cancel), in due tempi:
 *
 *  1. senza `code`: il token della pagina prova la casella e dice di chi e'
 *     l'iscrizione; il server controlla la richiesta e manda il codice
 *     all'indirizzo dell'iscrizione (lib/gdpr/confirmation-code). Risponde 202
 *     con `issuedAt`, che la pagina rimanda;
 *  2. con `code` e `issuedAt`: se quel codice e' stato mandato davvero, ha ancora
 *     tentativi e torna per la stessa richiesta, la modifica si fa e il codice
 *     non vale piu' (`conCodice`).
 *
 * Limiti, nel registro condiviso fra le repliche (lib/gdpr/confirmation-store):
 * cinque codici l'ora per indirizzo e cinque tentativi per codice, che con sei
 * cifre lasciano a chi tira a indovinare una probabilita' trascurabile, e solo
 * dopo che la persona ha ricevuto l'email. In piu', nella memoria di ogni pod come
 * le altre rotte dei propri dati: trenta chiamate l'ora per IP e dieci verifiche
 * l'ora per indirizzo. Chi chiama ha gia' il token di quell'indirizzo: un 429 non
 * gli dice niente che non sappia. Nei log non va niente della persona.
 */
import { AppError, NotFoundError, RateLimitError } from '@/lib/errors';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { inviaCodiceDiConferma } from '@/lib/email/confirmation-code';
import { linguaPagina } from '@/lib/email/lingua';
import {
  DURATA_CODICE_MINUTI,
  emettiCodice,
  verificaCodice,
  type RichiestaConfermata,
} from '@/lib/gdpr/confirmation-code';
import {
  annullaInvio,
  contaInvio,
  contaTentativo,
  prendiEmissione,
  registraEmissione,
  restituisciEmissione,
} from '@/lib/gdpr/confirmation-store';
import { verifyGdprToken } from '@/lib/gdpr/request-token';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { getSettings } from '@/lib/settings';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { defaultLocale } from '@/i18n/config';

const ORA_MS = 3_600_000;

const nonDisponibile = () =>
  new AppError(
    'Confirmation codes are unavailable, try again later',
    503,
    'SERVICE_UNAVAILABLE'
  );

function limita(chiave: string, limit: number): void {
  const rl = rateLimit(chiave, { limit, windowMs: ORA_MS });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
}

/** Il limite per IP, prima di leggere il corpo. */
export function limitePerIp(request: Request): void {
  limita(`gdpr-registration:${getClientIp(request)}`, 30);
}

/**
 * L'iscrizione su cui si agisce, se e' dell'indirizzo provato dal token della
 * pagina: 401 senza un token valido, 404 per un'iscrizione di un altro indirizzo.
 */
export async function iscrizioneDelToken(token: string, registrationId: string) {
  const verificato = verifyGdprToken(token, 'consents');
  if (!verificato) throw new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');
  const iscrizione = await prisma.registration.findFirst({
    where: { id: registrationId, emailHash: verificato.emailHash },
    select: {
      id: true,
      eventId: true,
      email: true,
      locale: true,
      event: { select: { title: true } },
    },
  });
  if (!iscrizione) throw new NotFoundError('Registration');
  return { emailHash: verificato.emailHash, iscrizione };
}

type IscrizioneDelToken = Awaited<ReturnType<typeof iscrizioneDelToken>>['iscrizione'];

/** Manda il codice per questa richiesta all'indirizzo dell'iscrizione. */
export async function mandaCodice(
  richiesta: RichiestaConfermata,
  iscrizione: IscrizioneDelToken,
  { locale, tutte = false }: { locale?: string; tutte?: boolean }
): Promise<Response> {
  const to = tryDecryptPII(iscrizione.email);
  if (!to)
    throw new AppError('Registration address unavailable', 409, 'ADDRESS_UNAVAILABLE');
  const conto = await contaInvio(richiesta.emailHash);
  if (conto === 'troppi') throw new RateLimitError(ORA_MS / 1000);
  if (conto === 'nonDisponibile') throw nonDisponibile();
  const lingua = linguaPagina(locale) ?? linguaPagina(iscrizione.locale) ?? defaultLocale;
  const { codice, emessoIl } = emettiCodice(richiesta);
  // Prima si annota, poi si manda: un codice che parte vale anche sulle altre
  // repliche. Se qualcosa va storto, l'invio non resta nel conto e l'emissione
  // non resta nel registro senza un'email che la annunci.
  if ((await registraEmissione(richiesta, emessoIl)) !== 'ok') {
    await annullaInvio(richiesta.emailHash);
    throw nonDisponibile();
  }
  try {
    await inviaCodiceDiConferma({
      to,
      locale: lingua,
      azione: richiesta.azione,
      tutte,
      eventTitle: getLocalized(iscrizione.event.title as LocalizedField, lingua),
      codice,
      minuti: DURATA_CODICE_MINUTI,
      registrationId: iscrizione.id,
      siteName: (await getSettings()).siteName,
    });
  } catch (err) {
    await prendiEmissione(richiesta, emessoIl);
    await annullaInvio(richiesta.emailHash);
    throw err;
  }
  return Response.json(
    { codeSent: true, issuedAt: emessoIl, expiresInMinutes: DURATA_CODICE_MINUTI },
    { status: 202, headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * Fa la modifica solo se il codice e' stato mandato per questa richiesta, ha
 * ancora tentativi e torna (altrimenti 403). Il codice si prende prima della
 * modifica: con due richieste insieme, una sola la fa. Se la modifica fallisce,
 * il codice torna valido e si puo' riprovare.
 */
export async function conCodice<T>(
  richiesta: RichiestaConfermata,
  issuedAt: number,
  code: string,
  modifica: () => Promise<T>
): Promise<T> {
  limita(`gdpr-registration-verify:${richiesta.emailHash}`, 10);
  const { esito, tentativi } = await contaTentativo(richiesta, issuedAt);
  if (esito === 'nonDisponibile') throw nonDisponibile();
  const sbagliato = () =>
    new AppError('Invalid or expired confirmation code', 403, 'INVALID_CODE');
  if (esito !== 'ammesso' || !verificaCodice(richiesta, issuedAt, code))
    throw sbagliato();
  const preso = await prendiEmissione(richiesta, issuedAt);
  if (preso === 'nonDisponibile') throw nonDisponibile();
  if (!preso) throw sbagliato();
  try {
    return await modifica();
  } catch (err) {
    await restituisciEmissione(richiesta, issuedAt, tentativi);
    throw err;
  }
}
