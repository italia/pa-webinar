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
    try {
      response = await handler(request, context);
    } catch (error) {
      response = errorResponse(error);
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
        level:
          response.status >= 500
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

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError('Invalid JSON body', 400, 'INVALID_BODY');
  }
}
