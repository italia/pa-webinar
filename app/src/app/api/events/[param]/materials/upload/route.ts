/**
 * POST /api/events/[param]/materials/upload — un file come materiale
 * dell'evento, caricato dalla sala (pannello «Materiali»).
 *
 * CHI. Chi può già aggiungere un link al pannello (POST ../materials): il
 * token moderatore primario o un co-moderatore non revocato. Relatori,
 * iscritti e ospiti no. Organizzatori e amministratori entrano in sala con il
 * link moderatore, e dall'area admin hanno il proprio caricamento.
 *
 * COME. Lo stesso percorso dell'area admin (`/api/admin/assets/upload-url`
 * con `type=document`): stesse tipologie e stesso limite
 * (`MATERIAL_FILE_*` in lib/validation/materials), tipo verificato sui byte
 * veri, scrittura lato server nello storage "files" sotto `assets/document/…`,
 * lettura da `/api/assets/…` come ogni altro materiale. Lato server e non con
 * un URL prefirmato: dimensione e tipo si controllano sul contenuto, e il
 * browser non deve raggiungere lo storage (nessun host in più nella CSP,
 * nessuna regola CORS sul bucket).
 *
 * IN UNA SOLA RICHIESTA. Il file e la riga `EventMaterial` nascono insieme e
 * la chiave la decide il server: il client non può indicare un `blobPath`
 * (cancellare il materiale cancella quel blob) né lasciare una riga che punta
 * a un file mai arrivato.
 *
 * VISIBILITÀ. `ALWAYS` («in sala e dopo l'evento»), come il predefinito
 * dell'area admin e come i link aggiunti dalla sala: ciò che si condivide in
 * diretta (le slide, un documento) di solito serve anche dopo, e un `DURING`
 * lo farebbe sparire dalla pagina dell'evento alla chiusura. Chi vuole
 * un'altra fase la cambia dall'area admin.
 *
 * QUANTO. Il link moderatore è condiviso e non scade: oltre al limite per
 * minuto, un tetto per evento sul numero di file e sui byte
 * (`MATERIAL_FILES_PER_EVENT_*`), e un numero massimo di caricamenti letti
 * insieme da questo processo, perché ognuno sta in memoria per intero (vedi
 * `CARICAMENTI_IN_CORSO_MAX`). Il tetto per evento è morbido: due caricamenti
 * nello stesso istante possono superarlo di un file.
 *
 * Il pannello di tutti i partecipanti si aggiorna con l'avviso sul canale
 * della sala (`pokeLivePanel`); senza Redis, con il suo polling.
 */

import { randomUUID } from 'crypto';

import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import {
  extractModeratorToken,
  isEventModerator,
  resolveGrantForEvent,
} from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '@/lib/errors';
import { eventParamWhere } from '@/lib/events/event-param';
import { materialAddedBy, materialAuthorName } from '@/lib/events/material-author';
import { discardUploadedBlob, materialFileUrl } from '@/lib/events/material-files';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { getFilesStorage } from '@/lib/storage';
import { buildAssetKey, sanitizeFilename } from '@/lib/utils/asset-key';
import { contentMatchesDeclaredMime, normalizeMimeType } from '@/lib/utils/mime-sniff';
import {
  MATERIAL_FILE_MAX_BYTES,
  MATERIAL_FILE_MIME_TYPES,
  MATERIAL_FILES_PER_EVENT_MAX,
  MATERIAL_FILES_PER_EVENT_MAX_BYTES,
} from '@/lib/validation/materials';

export const dynamic = 'force-dynamic';

const ALLOWED_MIME: ReadonlySet<string> = new Set(MATERIAL_FILE_MIME_TYPES);

/**
 * Margine sul Content-Length oltre al file: la cornice multipart e i due campi
 * di testo (titolo e descrizione, fino a 800 caratteri che in UTF-8 possono
 * valere quattro byte l'uno).
 */
const FORM_OVERHEAD_BYTES = 16 * 1024;

/**
 * Caricamenti che questo processo legge insieme. Ognuno sta in memoria per
 * intero, e più di una volta: il corpo della richiesta, il file estratto dal
 * modulo, i byte passati allo storage — fino a circa 75 MB per un file al
 * limite. Tre insieme restano lontani dal limite di memoria predefinito del
 * pod dell'app; il quarto riceve 429 e riprova fra qualche secondo.
 */
const CARICAMENTI_IN_CORSO_MAX = 3;
let caricamentiInCorso = 0;

/** Il tetto dei materiali caricati per evento: 409, con un codice suo. */
function quotaExceeded(): AppError {
  return new AppError('Event materials quota exceeded', 409, 'MATERIALS_QUOTA_EXCEEDED');
}

/** I file che l'evento ha già fra i materiali: quanti e quanti byte in tutto. */
async function fileDellEvento(eventId: string): Promise<{ count: number; bytes: number }> {
  const agg = await prisma.eventMaterial.aggregate({
    where: { eventId, type: 'FILE' },
    _count: { _all: true },
    _sum: { fileSize: true },
  });
  return { count: agg._count._all, bytes: Number(agg._sum.fileSize ?? 0) };
}

/** I campi di testo del modulo. Il titolo è facoltativo: senza, vale il nome del file. */
const uploadFieldsSchema = z.object({
  title: z.string().trim().max(300).optional(),
  description: z.string().trim().max(500).optional(),
});

/** Un campo di testo del modulo, o undefined se manca o non è testo. */
function textField(form: FormData, name: string): string | undefined {
  const v = form.get(name);
  return typeof v === 'string' ? v : undefined;
}

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findFirst({
    where: eventParamWhere(param),
    select: { id: true, moderatorToken: true, moderatorName: true },
  });
  if (!event) throw new NotFoundError('Event');
  // Stessa regola del link (POST ../materials): moderatori sì, relatori no.
  if (!(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const ip = getClientIp(request);
  const rl = rateLimit(`materials-upload:${ip}:${event.id}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  const storage = getFilesStorage();
  if (!storage) {
    // Un'installazione senza storage per i file e' una configurazione
    // ammessa, non un guasto: 503 per il client (che lo traduce dal codice),
    // `warn` nel log.
    const err = new AppError('Files storage is not configured', 503, 'STORAGE_UNAVAILABLE');
    err.expected = true;
    throw err;
  }

  // Il limite si controlla PRIMA di leggere il corpo in memoria. Il
  // Content-Length è obbligatorio: un browser lo manda sempre con un
  // FormData, e senza basterebbe ometterlo per saltare il controllo e
  // mandare un corpo a pezzi senza fine.
  const declaredLen = Number(request.headers.get('content-length'));
  if (!Number.isFinite(declaredLen) || declaredLen <= 0) {
    throw new AppError('Content-Length header is required', 411, 'LENGTH_REQUIRED');
  }
  if (declaredLen > MATERIAL_FILE_MAX_BYTES + FORM_OVERHEAD_BYTES) {
    throw new AppError('File too large', 413, 'PAYLOAD_TOO_LARGE');
  }

  // Il tetto per evento, anche questo prima di leggere il corpo: il file pesa
  // il Content-Length meno la cornice del modulo, che resta sotto
  // FORM_OVERHEAD_BYTES. Il conto esatto si rifà sui byte letti.
  const giaCaricati = await fileDellEvento(event.id);
  if (
    giaCaricati.count >= MATERIAL_FILES_PER_EVENT_MAX ||
    giaCaricati.bytes + Math.max(0, declaredLen - FORM_OVERHEAD_BYTES) >
      MATERIAL_FILES_PER_EVENT_MAX_BYTES
  ) {
    throw quotaExceeded();
  }

  if (caricamentiInCorso >= CARICAMENTI_IN_CORSO_MAX) throw new RateLimitError(5);
  caricamentiInCorso++;
  try {
    // Come per i link: un nome solo se gia' pubblico (lib/events/material-author).
    const addedBy = materialAddedBy(await resolveGrantForEvent(event, token));
    return await riceviECrea(request, event, addedBy, storage, giaCaricati.bytes);
  } finally {
    caricamentiInCorso--;
  }
});

/**
 * Legge il file, lo verifica, lo scrive nello storage e crea la riga. Separata
 * dalla rotta perché tutto ciò che tiene il file in memoria stia dentro il
 * conteggio dei caricamenti in corso.
 */
async function riceviECrea(
  request: Request,
  event: { id: string },
  addedBy: string,
  storage: NonNullable<ReturnType<typeof getFilesStorage>>,
  bytesGiaCaricati: number,
): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError('Request body must be multipart/form-data', 400, 'BAD_REQUEST');
  }

  const fileField = form.get('file');
  if (!(fileField instanceof File)) {
    throw new ValidationError('Missing `file` field in form data');
  }

  const fields = uploadFieldsSchema.safeParse({
    title: textField(form, 'title'),
    description: textField(form, 'description'),
  });
  if (!fields.success) {
    throw new ValidationError(
      'Validation failed',
      fields.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const mime = normalizeMimeType(fileField.type || 'application/octet-stream');
  if (!ALLOWED_MIME.has(mime)) {
    throw new AppError(
      `MIME type "${mime}" is not allowed for event materials`,
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  }
  if (fileField.size > MATERIAL_FILE_MAX_BYTES) {
    throw new AppError('File too large', 413, 'PAYLOAD_TOO_LARGE');
  }

  const buffer = Buffer.from(await fileField.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new ValidationError('Empty file');
  }
  if (buffer.byteLength > MATERIAL_FILE_MAX_BYTES) {
    throw new AppError('File too large', 413, 'PAYLOAD_TOO_LARGE');
  }
  if (bytesGiaCaricati + buffer.byteLength > MATERIAL_FILES_PER_EVENT_MAX_BYTES) {
    throw quotaExceeded();
  }
  // Il tipo dichiarato lo sceglie il browser: si confronta con i byte veri.
  if (!contentMatchesDeclaredMime(buffer, mime)) {
    throw new AppError(
      `File content does not match declared MIME type "${mime}"`,
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  }

  const originalName = fileField.name || 'upload';
  const fileName = sanitizeFilename(originalName);
  const key = buildAssetKey('document', originalName, { uuid: randomUUID() });

  try {
    await storage.put(key, buffer, mime);
  } catch (err) {
    console.error(
      '[materials/upload] scrittura sullo storage non riuscita:',
      err instanceof Error ? err.message : err,
    );
    throw new AppError('Failed to write file to storage', 502, 'STORAGE_WRITE_FAILED');
  }

  const title = fields.data.title || originalName.slice(0, 300);
  let material;
  try {
    material = await prisma.eventMaterial.create({
      data: {
        eventId: event.id,
        type: 'FILE',
        title,
        url: materialFileUrl(request, key),
        description: fields.data.description || null,
        addedBy,
        fileName,
        fileSize: BigInt(buffer.byteLength),
        mimeType: mime,
        blobPath: key,
        visibility: 'ALWAYS',
      },
    });
  } catch (err) {
    // Senza la riga il file non lo elencherebbe né cancellerebbe nessuno.
    await discardUploadedBlob(key);
    throw err;
  }

  pokeLivePanel(event.id, 'materials');

  return Response.json(
    {
      id: material.id,
      type: material.type,
      title: material.title,
      url: material.url,
      description: material.description,
      fileName: material.fileName,
      fileSize: buffer.byteLength,
      mimeType: material.mimeType,
      visibility: material.visibility,
      addedBy: materialAuthorName(material.addedBy),
      createdAt: material.createdAt.toISOString(),
    },
    { status: 201 },
  );
}
