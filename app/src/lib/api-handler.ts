import { type NextRequest } from 'next/server';
import { AppError, errorResponse } from './errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteContext = { params: Promise<any> };
type RouteHandler = (
  request: NextRequest,
  context: RouteContext
) => Promise<Response>;

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
