/**
 * Chi puo' leggere e modificare il glossario di un evento: chi lo modera,
 * con il proprio token (la pagina dell'evento si apre anche dal link del
 * moderatore), oppure chi passa la guardia dello staff che la rotta indica.
 */

import { extractModeratorToken, isEventModerator } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** L'id dell'evento, se chi chiede puo' usarne il glossario. Prima il token:
 *  chi apre la pagina dal link del moderatore puo' avere anche una sessione
 *  dello staff che quell'evento non lo gestisce. */
export async function eventoDelGlossario(
  request: Request,
  id: string,
  guardiaStaff: () => Promise<void>,
): Promise<string> {
  if (!UUID_RE.test(id)) throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  const token = extractModeratorToken(request);
  const event = token
    ? await prisma.event.findUnique({ where: { id }, select: { id: true, moderatorToken: true } })
    : null;
  if (event && token && (await isEventModerator(event, token))) return id;
  await guardiaStaff();
  const esiste = await prisma.event.findUnique({ where: { id }, select: { id: true } });
  if (!esiste) throw new NotFoundError('Event');
  return id;
}
