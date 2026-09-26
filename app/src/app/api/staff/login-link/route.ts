/**
 * POST /api/staff/login-link — chiede il link di accesso (ADR-014).
 *
 * Risponde sempre 202, che l'email corrisponda a un account attivo o no:
 * altrimenti la rotta direbbe a chiunque quali indirizzi hanno accesso
 * all'area di amministrazione.
 */
import { after } from 'next/server';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { hashEmail } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { RateLimitError, ValidationError } from '@/lib/errors';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { inviaLinkAccesso } from '@/lib/auth/staff-login';

export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().trim().email().max(254),
  locale: z.string().min(2).max(5).default('it'),
});

export const POST = withErrorHandling(async (request) => {
  const ip = getClientIp(request);
  const perIp = rateLimit(`staff-link:${ip}`, { limit: 5, windowMs: 60_000 });
  if (!perIp.allowed) throw new RateLimitError((perIp.resetAt - Date.now()) / 1000);

  const parsed = schema.safeParse(await parseJsonBody(request));
  if (!parsed.success) throw new ValidationError('invalid_email');

  const emailHash = hashEmail(parsed.data.email);
  // Due limiti per indirizzo. Stretto per coppia indirizzo+IP, perche' non si
  // inondi la casella di qualcuno; largo per indirizzo, perche' chi conosce
  // l'email di un organizzatore non possa esaurirgli il limite e tenerlo
  // fuori: da un'altra rete la persona riceve comunque il suo link. In ogni
  // caso l'amministrazione puo' sempre rimandarlo dalla pagina organizzatori.
  const perCoppia = rateLimit(`staff-link-mail:${emailHash}:${ip}`, {
    limit: 3,
    windowMs: 10 * 60_000,
  });
  const perIndirizzo = rateLimit(`staff-link-mail:${emailHash}`, {
    limit: 20,
    windowMs: 60 * 60_000,
  });
  if (perCoppia.allowed && perIndirizzo.allowed) {
    const locale = parsed.data.locale;
    // Dopo la risposta: cercare l'account, creare il token e accodare la
    // mail richiedono tempo solo quando l'account esiste, e quel tempo
    // direbbe a chi misura la risposta quali indirizzi hanno accesso.
    after(async () => {
      const account = await prisma.staffAccount.findUnique({
        where: { emailHash },
        select: { id: true, email: true, name: true, active: true },
      });
      if (account?.active) await inviaLinkAccesso(account, locale);
    });
  }

  return Response.json({ ok: true }, { status: 202 });
});
