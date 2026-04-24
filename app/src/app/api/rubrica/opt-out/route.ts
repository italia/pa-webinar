/**
 * Public rubrica opt-out endpoint.
 *
 * Participants who received a signed token in their email can use it
 * to withdraw from the address book (GDPR Art. 7.3 — right to withdraw
 * consent at any time). Two methods:
 *
 *   GET  ?token=...   — preview the target display name/organization
 *                       so the confirmation page can show who is being
 *                       opted out. Read-only.
 *   POST ?token=...   — flip optedInToAddressBook to false and stamp
 *                       optedOutAt. Preserves the Person row (so a
 *                       future re-opt-in doesn't lose historical
 *                       lastActiveAt) but the row is no longer shown
 *                       in the rubrica.
 *
 * Tokens are self-signed with APP_SECRET and carry a 90-day TTL.
 */

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { NotFoundError, ValidationError, UnauthorizedError } from '@/lib/errors';
import { verifyRubricaOptOutToken } from '@/lib/persons/opt-out-token';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

async function resolveToken(token: string) {
  const verified = verifyRubricaOptOutToken(token);
  if (!verified) throw new UnauthorizedError('Invalid or expired token');
  const person = await prisma.person.findUnique({
    where: { id: verified.personId },
    select: {
      id: true, displayName: true, organization: true,
      optedInToAddressBook: true, optedOutAt: true,
    },
  });
  if (!person) throw new NotFoundError('Person');
  return person;
}

export const GET = withErrorHandling(async (request) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) throw new ValidationError('Missing token');
  const person = await resolveToken(token);
  return Response.json(
    {
      displayName: person.displayName,
      organization: person.organization,
      alreadyOptedOut: !person.optedInToAddressBook,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

export const POST = withErrorHandling(async (request) => {
  const ip = getClientIp(request);
  const rl = rateLimit(`rubrica-opt-out:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) throw new ValidationError('Too many requests');

  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? (await parseJsonBody(request).catch(() => ({})) as { token?: string }).token;
  if (!token) throw new ValidationError('Missing token');

  const person = await resolveToken(token);

  await prisma.person.update({
    where: { id: person.id },
    data: {
      optedInToAddressBook: false,
      optedOutAt: new Date(),
    },
  });

  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
});
