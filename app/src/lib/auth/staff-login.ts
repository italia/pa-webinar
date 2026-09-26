import { createHash, randomBytes } from 'node:crypto';

import { prisma } from '@/lib/db';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { linguaEmail } from '@/lib/email/lingua';
import { enqueueEmail } from '@/lib/email/outbox';
import { staffLoginEmail } from '@/lib/email/templates';
import { getPublicEnv } from '@/lib/env';
import { getSettings } from '@/lib/settings';
import { localizedUrl } from '@/lib/utils/localized-url';
import { defaultLocale, locales } from '@/i18n/config';

import { DURATA_LINK_MINUTI } from './staff-link-config';

export { DURATA_LINK_MINUTI };

/**
 * Il link di accesso monouso dello staff (ADR-014).
 *
 * Nel database finisce solo l'hash del token: chi legge una copia del
 * database non puo' entrare al posto di nessuno. Il link apre una pagina che
 * chiede un clic prima di consumarlo — i filtri antispam che aprono i link
 * delle email non devono bruciarlo al posto della persona.
 */

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Crea il link per l'account e lo accoda come email. */
export async function inviaLinkAccesso(
  account: { id: string; email: string; name: string },
  locale: string,
): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  await prisma.staffLoginToken.create({
    data: {
      accountId: account.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + DURATA_LINK_MINUTI * 60_000),
    },
  });

  // La lingua arriva da chi chiede il link: se non e' una lingua della
  // piattaforma, l'indirizzo nella mail porterebbe a una pagina inesistente e
  // il token andrebbe sprecato.
  const localeValido = (locales as readonly string[]).includes(locale) ? locale : defaultLocale;
  const lingua = linguaEmail(localeValido);
  const base = getPublicEnv('NEXT_PUBLIC_APP_URL');
  const settings = await getSettings();
  const mail = staffLoginEmail({
    locale: lingua,
    name: tryDecryptPII(account.name) ?? '',
    url: localizedUrl(base, `/admin/access?t=${token}`, localeValido),
    minutes: DURATA_LINK_MINUTI,
    siteName: settings.siteName,
  });
  const to = tryDecryptPII(account.email);
  if (!to) return;
  await enqueueEmail({
    to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    metadata: { kind: 'staff-login', accountId: account.id },
  });
}

/**
 * Consuma il link: restituisce l'account se il token e' valido, non usato,
 * non scaduto e l'account e' attivo; altrimenti `null`, sempre con la stessa
 * risposta per chi chiama. Il consumo e' atomico: due clic contemporanei non
 * aprono due sessioni.
 */
export async function consumaLinkAccesso(token: string): Promise<string | null> {
  if (!token || token.length > 200) return null;
  const tokenHash = hashToken(token);
  const riga = await prisma.staffLoginToken.findUnique({
    where: { tokenHash },
    select: { id: true, accountId: true, account: { select: { active: true } } },
  });
  if (!riga?.account.active) return null;

  const consumato = await prisma.staffLoginToken.updateMany({
    where: { id: riga.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (consumato.count !== 1) return null;

  await prisma.staffAccount.update({
    where: { id: riga.accountId },
    data: { lastLoginAt: new Date() },
  });
  return riga.accountId;
}
