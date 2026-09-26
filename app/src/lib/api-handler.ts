import { type NextRequest } from 'next/server';
import { AppError, errorResponse } from './errors';
import { httpRequestDuration, httpRequestsTotal } from './metrics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteContext = { params: Promise<any> };
type RouteHandler = (
  request: NextRequest,
  context: RouteContext
) => Promise<Response>;

function normalizeRoute(pathname: string): string {
  return pathname
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}

export function withErrorHandling(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    const start = Date.now();
    let response: Response;
    let previsto = false;
    try {
      response = await handler(request, context);
    } catch (error) {
      response = errorResponse(error);
      previsto = error instanceof AppError && error.expected === true;
    }
    const duration = Date.now() - start;
    const url = new URL(request.url);
    const route = normalizeRoute(url.pathname);
    const statusCode = String(response.status);

    httpRequestDuration.observe(
      { method: request.method, route, status_code: statusCode },
      duration / 1000,
    );
    httpRequestsTotal.inc({ method: request.method, route, status_code: statusCode });

    console.log(
      JSON.stringify({
        // Un 5xx previsto dalla configurazione (AppError.expected) non e' un
        // guasto da allarme: resta `warn`, come i 4xx.
        level:
          response.status >= 500 && !previsto
            ? 'error'
            : response.status >= 400
              ? 'warn'
              : 'info',
        method: request.method,
        path: url.pathname,
        status: response.status,
        duration_ms: duration,
      }),
    );
    return response;
  };
}

/**
 * Il corpo JSON più grande che una rotta legge: 10 MiB, il limite che
 * l'ingress applicava a ogni richiesta prima di salire per i file caricati
 * attraverso il portale (`proxy-body-size` in infra/helm/pa-webinar/
 * values.yaml). Il limite più alto serve solo ai caricamenti multipart, che
 * controllano da sé la propria dimensione; senza questo tetto qualunque rotta
 * JSON pubblica leggerebbe e interpreterebbe in memoria un corpo grande quanto
 * il limite dell'ingress.
 */
export const JSON_BODY_MAX_BYTES = 10 * 1024 * 1024;

function bodyTooLarge(): AppError {
  return new AppError('Request body too large', 413, 'PAYLOAD_TOO_LARGE');
}

/** Legge il corpo fermandosi appena supera `maxBytes`: non lo tiene mai tutto. */
async function readBodyText(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = body.getReader();
  const parti: Uint8Array[] = [];
  let letti = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    letti += value.byteLength;
    if (letti > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw bodyTooLarge();
    }
    parti.push(value);
  }
  const tutto = new Uint8Array(letti);
  let posizione = 0;
  for (const parte of parti) {
    tutto.set(parte, posizione);
    posizione += parte.byteLength;
  }
  return new TextDecoder().decode(tutto);
}

/**
 * Il corpo JSON della richiesta, o un errore 400 se non è JSON. Un corpo oltre
 * `maxBytes` riceve 413 prima di essere letto per intero: dal Content-Length
 * quando c'è, contando i byte mentre arrivano quando manca.
 */
export async function parseJsonBody(
  request: Request,
  maxBytes: number = JSON_BODY_MAX_BYTES,
): Promise<unknown> {
  const dichiarati = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(dichiarati) && dichiarati > maxBytes) throw bodyTooLarge();
  let testo: string;
  try {
    testo = request.body ? await readBodyText(request.body, maxBytes) : await request.text();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Invalid JSON body', 400, 'INVALID_BODY');
  }
  try {
    return JSON.parse(testo);
  } catch {
    throw new AppError('Invalid JSON body', 400, 'INVALID_BODY');
  }
}
