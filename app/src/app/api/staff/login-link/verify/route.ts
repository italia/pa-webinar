/**
 * POST /api/staff/login-link/verify — consuma il link e apre la sessione
 * dell'organizzatore (ADR-014).
 *
 * POST e non GET: il link nella email apre una pagina che chiede un clic, e
 * solo quel clic arriva qui. Un filtro antispam che visita il link non
 * brucia l'accesso.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { setAdminSessionCookie } from '@/lib/auth/admin-session';
import { consumaLinkAccesso } from '@/lib/auth/staff-login';
import { signOrganizerSession } from '@/lib/auth/staff-session';
import { RateLimitError, ValidationError } from '@/lib/errors';
import { getClientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const schema = z.object({ token: z.string().min(10).max(200) });

export const POST = withErrorHandling(async (request) => {
  const ip = getClientIp(request);
  const rl = rateLimit(`staff-verify:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  const parsed = schema.safeParse(await parseJsonBody(request));
  if (!parsed.success) throw new ValidationError('invalid_link');

  const accountId = await consumaLinkAccesso(parsed.data.token);
  // Scaduto, gia' usato, inesistente, account disattivato: una sola risposta.
  if (!accountId) throw new ValidationError('invalid_link');

  await logAdminAction({
    request,
    action: 'STAFF_LOGIN',
    target: accountId,
    actor: `organizer:${accountId}`,
  });
  const response = NextResponse.json({ ok: true });
  setAdminSessionCookie(response, await signOrganizerSession(accountId));
  return response;
});
