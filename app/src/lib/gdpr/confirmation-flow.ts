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
 *  2. con `code` e `issuedAt`: se il codice torna per la stessa richiesta, la
 *     modifica si fa.
 *
 * Limiti: per IP su tutte e due le fasi, come le altre rotte dei propri dati;
 * per indirizzo tre codici l'ora, come le email di accesso e cancellazione, e dieci
 * verifiche l'ora, che con sei cifre lasciano a chi tira a indovinare una
 * probabilita' trascurabile. Contati nella memoria di ogni pod, come gli altri.
 * Chi chiama ha gia' il token di quell'indirizzo: un 429 non gli dice niente che
 * non sappia. Nei log non va niente della persona.
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
import { verifyGdprToken } from '@/lib/gdpr/request-token';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { getSettings } from '@/lib/settings';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { defaultLocale } from '@/i18n/config';

const ORA_MS = 3_600_000;

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
  limita(`gdpr-registration-code:${richiesta.emailHash}`, 3);
  const to = tryDecryptPII(iscrizione.email);
  if (!to)
    throw new AppError('Registration address unavailable', 409, 'ADDRESS_UNAVAILABLE');
  const lingua = linguaPagina(locale) ?? linguaPagina(iscrizione.locale) ?? defaultLocale;
  const { codice, emessoIl } = emettiCodice(richiesta);
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
  return Response.json(
    { codeSent: true, issuedAt: emessoIl, expiresInMinutes: DURATA_CODICE_MINUTI },
    { status: 202, headers: { 'Cache-Control': 'no-store' } }
  );
}

/** Il codice torna per questa richiesta, o la modifica non si fa (403). */
export function controllaCodice(
  richiesta: RichiestaConfermata,
  issuedAt: number,
  code: string
): void {
  limita(`gdpr-registration-verify:${richiesta.emailHash}`, 10);
  if (!verificaCodice(richiesta, issuedAt, code)) {
    throw new AppError('Invalid or expired confirmation code', 403, 'INVALID_CODE');
  }
}
