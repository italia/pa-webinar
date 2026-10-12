import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import {
  isEventModerator,
  extractModeratorToken,
  resolveGrantForEvent,
} from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { isEventPubliclyVisible } from '@/lib/events/visibility';
import { MATERIAL_LIST_EVENT_SELECT, materialAccessFor } from '@/lib/events/material-access';
import { materialAddedBy, materialAuthorName } from '@/lib/events/material-author';
import { roomMaterialJson } from '@/lib/events/material-json';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { getFilesStorage } from '@/lib/storage';
import { createMaterialSchema } from '@/lib/validation/schemas';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// ── GET /api/events/[slug]/materials ─────────────────────

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const event = await prisma.event.findUnique({
    where: { slug },
    select: MATERIAL_LIST_EVENT_SELECT,
  });

  // Stessa regola delle pagine pubbliche (lib/events/visibility): i materiali
  // devono restare accessibili anche durante il pre-warm PROVISIONING/IDLE.
  if (!event || !isEventPubliclyVisible(event)) {
    throw new NotFoundError('Event');
  }

  // La visibilità del singolo materiale (prima/durante/dopo) vale per il
  // pubblico; chi ha un token moderatore vede tutto
  // (lib/events/material-access). Il token è facoltativo: senza, è la vista
  // del pubblico.
  const access = await materialAccessFor(event, extractModeratorToken(request));
  const materials = await prisma.eventMaterial.findMany({
    where: access.where,
    orderBy: { createdAt: 'desc' },
  });

  return Response.json(
    {
      // Campo per campo, il percorso nello storage escluso; il conteggio
      // delle aperture solo a chi conduce (lib/events/material-json).
      materials: materials.map((m) => roomMaterialJson(m, access)),
      // Se questa installazione ha uno storage per i file: il pannello della
      // sala offre il caricamento (POST ./upload) solo quando può riuscire.
      uploadsEnabled: getFilesStorage() !== null,
    },
    // La risposta dipende da chi chiede e dall'ora: nessuna cache condivisa.
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
});

// ── POST /api/events/[slug]/materials ────────────────────

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const ip = getClientIp(request);
  const rl = rateLimit(`materials-add:${ip}:${event.id}`, {
    limit: 20,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request);
  const parsed = createMaterialSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const material = await prisma.eventMaterial.create({
    data: {
      eventId: event.id,
      title: parsed.data.title,
      url: parsed.data.url,
      description: parsed.data.description ?? null,
      visibility: parsed.data.visibility ?? 'ALWAYS',
      // Un nome solo se gia' pubblico, mai una parola fissa: vedi
      // lib/events/material-author.
      addedBy: materialAddedBy(await resolveGrantForEvent(event, token)),
    },
  });

  // Il pannello di chi è in sala rilegge subito, ognuno con i propri permessi.
  pokeLivePanel(event.id, 'materials');

  return Response.json(
    {
      id: material.id,
      type: material.type,
      title: material.title,
      url: material.url,
      description: material.description,
      visibility: material.visibility,
      addedBy: materialAuthorName(material.addedBy),
      createdAt: material.createdAt.toISOString(),
    },
    { status: 201 },
  );
});
