import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { withErrorHandling, parseJsonBody } from './api-handler';
import { NotFoundError, AppError } from './errors';

function makeNextRequest(
  url: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'), init);
}

// ── withErrorHandling ──────────────────────────────────────

describe('withErrorHandling', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns the handler response on success', async () => {
    const handler = withErrorHandling(async () => {
      return Response.json({ ok: true });
    });
    const res = await handler(
      makeNextRequest('http://localhost/api/test'),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('catches thrown AppError and returns error response', async () => {
    const handler = withErrorHandling(async () => {
      throw new NotFoundError('Event');
    });
    const res = await handler(
      makeNextRequest('http://localhost/api/events/abc'),
      { params: Promise.resolve({ param: 'abc' }) },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
  });

  it('catches generic errors and returns 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withErrorHandling(async () => {
      throw new Error('unexpected');
    });
    const res = await handler(
      makeNextRequest('http://localhost/api/test'),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(500);
  });

  it('logs structured JSON with method, path, status', async () => {
    const logSpy = vi.spyOn(console, 'log');
    const handler = withErrorHandling(async () => {
      return Response.json({ ok: true });
    });
    await handler(
      makeNextRequest('http://localhost/api/events', { method: 'GET' }),
      { params: Promise.resolve({}) },
    );
    expect(logSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(logged.method).toBe('GET');
    expect(logged.path).toBe('/api/events');
    expect(logged.status).toBe(200);
    expect(logged.level).toBe('info');
    expect(typeof logged.duration_ms).toBe('number');
  });

  it('logs warn level for 4xx errors', async () => {
    const logSpy = vi.spyOn(console, 'log');
    const handler = withErrorHandling(async () => {
      throw new NotFoundError('Event');
    });
    await handler(
      makeNextRequest('http://localhost/api/test'),
      { params: Promise.resolve({}) },
    );
    const logged = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(logged.level).toBe('warn');
    expect(logged.status).toBe(404);
  });

  it('logs error level for 5xx errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log');
    const handler = withErrorHandling(async () => {
      throw new Error('boom');
    });
    await handler(
      makeNextRequest('http://localhost/api/test'),
      { params: Promise.resolve({}) },
    );
    const logged = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(logged.level).toBe('error');
    expect(logged.status).toBe(500);
  });

  it('passes context to handler', async () => {
    const handler = withErrorHandling(async (_req, ctx) => {
      const params = await ctx.params;
      return Response.json({ slug: params.param });
    });
    const res = await handler(
      makeNextRequest('http://localhost/api/events/my-event'),
      { params: Promise.resolve({ param: 'my-event' }) },
    );
    const body = await res.json();
    expect(body.slug).toBe('my-event');
  });
});

// ── parseJsonBody ──────────────────────────────────────────

describe('parseJsonBody', () => {
  it('parses valid JSON body', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    });
    const body = await parseJsonBody(req);
    expect(body).toEqual({ name: 'test' });
  });

  it('throws AppError 400 for invalid JSON', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json{{{',
    });
    await expect(parseJsonBody(req)).rejects.toThrow(AppError);
    await expect(parseJsonBody(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'bad',
      }),
    )).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_BODY',
    });
  });
});
