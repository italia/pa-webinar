/**
 * /api/events/[param]/presentation — il PDF presentato nella sala.
 *
 *   GET     chi sta nella stanza: lo stato completo (titolo, pagina, chi
 *           presenta, dove leggere il file). Regola dei pannelli
 *           (lib/events/panel-read-access): chi conduce, i relatori, gli
 *           iscritti, gli ospiti finché la stanza è aperta a loro; con la
 *           password dell'evento, solo chi l'ha inserita.
 *   POST    presenta un PDF caricato fra i materiali dell'evento (sostituisce
 *           quello in corso). Sullo stesso PDF è il passaggio di mano («Presenta
 *           tu»): chi chiama diventa chi presenta, dalla pagina indicata, e il
 *           numero di pagine già noto resta;
 *   PATCH   vai a una pagina del materiale presentato;
 *   DELETE  chiudi la presentazione.
 *
 * Le tre mutazioni: link moderatore principale o concessione nominale non
 * revocata, MODERATOR o SPEAKER, come `Authorization: Bearer`. Concluso
 * l'evento non si avvia né si gira pagina, e la lettura non mostra più nulla. Ognuna fa
 * crescere la versione, annuncia il nuovo puntatore sul canale della sala
 * (snapshot `presentation`) e scrive l'azione nella cronologia, che la
 * post-produzione legge accanto alla trascrizione. Vedi lib/presentation/state.
 *
 * Ogni risposta dice a chi chiede se la presentazione è sua (`yours`): chi può
 * presentare e non è chi presenta adesso vede «Presenta tu».
 */

import type { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { extractModeratorToken, resolveGrantForEvent } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '@/lib/errors';
import { eventParamWhere } from '@/lib/events/event-param';
import {
  PANEL_READ_EVENT_SELECT,
  authorizePanelRead,
} from '@/lib/events/panel-read-access';
import { recordLiveAction } from '@/lib/live/actions';
import { publishPresentation } from '@/lib/live-state/publish';
import {
  PRESENTABLE_MATERIAL_SELECT,
  PRESENTATION_CLEARED,
  PRESENTATION_ROW_SELECT,
  isCurrentPresenter,
  isPresentableMaterial,
  isPresentationOpen,
  liveActorOf,
  pointerOf,
  presentationStateOf,
  readPresentationRow,
} from '@/lib/presentation/state';
import { rateLimit } from '@/lib/rate-limit';
import {
  movePresentationSchema,
  startPresentationSchema,
  stopPresentationQuerySchema,
} from '@/lib/validation/presentation';

export const dynamic = 'force-dynamic';

const EVENT_SELECT = {
  ...PANEL_READ_EVENT_SELECT,
  slug: true,
  moderatorName: true,
} as const;

/** Pagine girate al minuto per chi presenta: ben oltre un uso vero. */
const MOVES_PER_MINUTE = 240;
/** Avvii e chiusure al minuto per chi presenta. */
const STARTS_PER_MINUTE = 30;

const nessunaCache = { 'Cache-Control': 'private, no-store' };

function parametri(context: { params: Promise<unknown> }): Promise<{ param: string }> {
  return context.params as Promise<{ param: string }>;
}

async function eventoDa(param: string) {
  const event = await prisma.event.findFirst({
    where: eventParamWhere(param),
    select: EVENT_SELECT,
  });
  if (!event) throw new NotFoundError('Event');
  return event;
}

type Evento = Awaited<ReturnType<typeof eventoDa>>;

/** Chi può presentare: il link principale o una concessione non revocata, moderatore o relatore. */
async function chiPresenta(event: Evento, request: Request) {
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator or speaker token required');
  const grant = await resolveGrantForEvent(event, token);
  if (!grant) throw new ForbiddenError('Only moderators and speakers can present');
  return { token, grant };
}

function limite(chiave: string, limit: number): void {
  const rl = rateLimit(chiave, { limit, windowMs: 60_000 });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
}

function salaChiusa(): AppError {
  return new AppError('The event is closed', 409, 'EVENT_CLOSED');
}

/** La presentazione è cambiata sotto i piedi di chi chiede: un altro materiale, o chiusa. */
function presentazioneCambiata(): AppError {
  return new ConflictError('The presentation changed');
}

function eNonTrovato(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2025'
  );
}

function erroriDi(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path, message: i.message }));
}

// ── GET ──────────────────────────────────────────────────

export const GET = withErrorHandling(async (request, context) => {
  const { param } = await parametri(context);
  const event = await eventoDa(param);
  const token = extractModeratorToken(request);
  const lettore = await authorizePanelRead(event, token);
  // Chi può presentare deve sapere se la presentazione è sua: solo per lui si
  // risolve la concessione.
  const viewer =
    token && (lettore.kind === 'moderator' || lettore.kind === 'speaker')
      ? await resolveGrantForEvent(event, token)
      : null;
  const row = await readPresentationRow(event.id);
  return Response.json(presentationStateOf(row, event, viewer), {
    headers: nessunaCache,
  });
});

// ── POST: presenta un materiale ──────────────────────────

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await parametri(context);
  const event = await eventoDa(param);
  const { grant } = await chiPresenta(event, request);
  // Un evento concluso non ha più una sala: si chiude, non si presenta.
  if (!isPresentationOpen(event.status)) throw salaChiusa();
  limite(
    `presentation-start:${event.id}:${grant.grantId ?? 'primary'}`,
    STARTS_PER_MINUTE
  );

  const parsed = startPresentationSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success)
    throw new ValidationError('Validation failed', erroriDi(parsed.error));
  const { materialId } = parsed.data;
  const page = parsed.data.page ?? 1;

  // Un PDF dell'evento, anche fuori dalla fase che il pubblico vede adesso:
  // presentarlo è mostrarlo alla sala, come farebbe la condivisione dello
  // schermo. Vale anche per un relatore, che altrimenti non potrebbe
  // presentare il PDF appena caricato in una prova prima dell'inizio (la fase
  // «prima» mostra al pubblico solo i materiali «prima dell'evento»). L'id di
  // un materiale non elencato non lo conosce chi non lo ha caricato.
  const material = await prisma.eventMaterial.findFirst({
    where: { eventId: event.id, id: materialId },
    select: PRESENTABLE_MATERIAL_SELECT,
  });
  if (!material) throw new NotFoundError('Material');
  if (!isPresentableMaterial(material, event.id)) {
    throw new AppError('Only an uploaded PDF can be presented', 422, 'NOT_PRESENTABLE');
  }

  // Lo stesso PDF già presentato: tiene il numero di pagine e, se a chiamare è
  // un altro, è un passaggio di mano.
  const prima = await prisma.eventPresentation.findUnique({
    where: { eventId: event.id },
    select: {
      materialId: true,
      pageCount: true,
      presenterRole: true,
      presenterGrantId: true,
    },
  });
  const stessoDocumento = prima?.materialId === material.id;
  const passaggio = stessoDocumento && !isCurrentPresenter(prima, grant);
  const presenter = {
    materialId: material.id,
    page: stessoDocumento && prima.pageCount ? Math.min(page, prima.pageCount) : page,
    pageCount: stessoDocumento ? prima.pageCount : null,
    presenterRole: grant.role,
    presenterGrantId: grant.grantId,
    startedAt: new Date(),
  };
  const row = await prisma.eventPresentation.upsert({
    where: { eventId: event.id },
    create: { eventId: event.id, ...presenter, version: 1 },
    update: { ...presenter, version: { increment: 1 } },
    select: PRESENTATION_ROW_SELECT,
  });

  publishPresentation(event.id, pointerOf(row));
  void recordLiveAction({
    eventId: event.id,
    kind: 'presentation.started',
    actor: liveActorOf(grant.role),
    data: {
      materialId: material.id,
      title: material.title,
      page: row.page,
      ...(passaggio ? { handover: true } : {}),
    },
  });

  return Response.json(presentationStateOf(row, event, grant), { headers: nessunaCache });
});

// ── PATCH: vai a una pagina ──────────────────────────────

export const PATCH = withErrorHandling(async (request, context) => {
  const { param } = await parametri(context);
  const event = await eventoDa(param);
  const { grant } = await chiPresenta(event, request);
  if (!isPresentationOpen(event.status)) throw salaChiusa();
  limite(`presentation-move:${event.id}:${grant.grantId ?? 'primary'}`, MOVES_PER_MINUTE);

  const parsed = movePresentationSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success)
    throw new ValidationError('Validation failed', erroriDi(parsed.error));
  const { materialId } = parsed.data;

  const attuale = await readPresentationRow(event.id);
  if (!attuale || attuale.materialId !== materialId) throw presentazioneCambiata();

  const pageCount = parsed.data.pageCount ?? attuale.pageCount;
  // Oltre l'ultima pagina, quando si sa quale sia, si resta sull'ultima.
  const page = pageCount ? Math.min(parsed.data.page, pageCount) : parsed.data.page;
  if (page === attuale.page && pageCount === attuale.pageCount) {
    // Niente da cambiare: nessuna versione nuova, nessun annuncio.
    return Response.json(presentationStateOf(attuale, event, grant), {
      headers: nessunaCache,
    });
  }

  let row;
  try {
    // Il materiale fa parte della condizione: se nel frattempo un altro ne ha
    // presentato uno diverso, questa pagina non sposta il suo documento.
    row = await prisma.eventPresentation.update({
      where: { eventId: event.id, materialId },
      data: { page, pageCount, version: { increment: 1 } },
      select: PRESENTATION_ROW_SELECT,
    });
  } catch (err) {
    if (eNonTrovato(err)) throw presentazioneCambiata();
    throw err;
  }

  publishPresentation(event.id, pointerOf(row));
  if (page !== attuale.page) {
    void recordLiveAction({
      eventId: event.id,
      kind: 'presentation.page',
      actor: liveActorOf(grant.role),
      data: { materialId, title: row.material?.title ?? '', page, pageCount },
    });
  }

  return Response.json(presentationStateOf(row, event, grant), { headers: nessunaCache });
});

// ── DELETE: chiudi la presentazione ──────────────────────

export const DELETE = withErrorHandling(async (request, context) => {
  const { param } = await parametri(context);
  const event = await eventoDa(param);
  const { grant } = await chiPresenta(event, request);
  limite(
    `presentation-start:${event.id}:${grant.grantId ?? 'primary'}`,
    STARTS_PER_MINUTE
  );

  const query = stopPresentationQuerySchema.safeParse({
    materialId: new URL(request.url).searchParams.get('materialId') ?? undefined,
  });
  if (!query.success)
    throw new ValidationError('Validation failed', erroriDi(query.error));

  const attuale = await readPresentationRow(event.id);
  // Già chiusa: il risultato chiesto c'è.
  if (!attuale?.materialId) {
    return Response.json(presentationStateOf(attuale, event, grant), {
      headers: nessunaCache,
    });
  }
  // Chi chiude la presentazione che vedeva non chiude quella appena aperta da un altro.
  const { materialId } = query.data;
  if (materialId && materialId !== attuale.materialId) throw presentazioneCambiata();

  let row;
  try {
    row = await prisma.eventPresentation.update({
      where: { eventId: event.id, materialId: attuale.materialId },
      data: { ...PRESENTATION_CLEARED, version: { increment: 1 } },
      select: PRESENTATION_ROW_SELECT,
    });
  } catch (err) {
    if (eNonTrovato(err)) throw presentazioneCambiata();
    throw err;
  }

  publishPresentation(event.id, pointerOf(row));
  void recordLiveAction({
    eventId: event.id,
    kind: 'presentation.stopped',
    actor: liveActorOf(grant.role),
    data: { materialId: attuale.materialId, title: attuale.material?.title ?? '' },
  });

  return Response.json(presentationStateOf(row, event, grant), { headers: nessunaCache });
});
