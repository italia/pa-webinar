import { describe, it, expect, vi } from 'vitest';
import {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  errorResponse,
} from './errors';

// ── Error class hierarchy ──────────────────────────────────

describe('AppError', () => {
  it('stores statusCode, code, and message', () => {
    const err = new AppError('Something broke', 500, 'BROKEN');
    expect(err.message).toBe('Something broke');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('BROKEN');
    expect(err.name).toBe('AppError');
  });

  it('stores optional details', () => {
    const err = new AppError('Bad', 400, 'BAD', { field: 'email' });
    expect(err.details).toEqual({ field: 'email' });
  });

  it('is an instance of Error', () => {
    const err = new AppError('test', 500, 'TEST');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });
});

describe('ValidationError', () => {
  it('has statusCode 422 and VALIDATION_ERROR code', () => {
    const err = new ValidationError('Invalid input');
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('Invalid input');
  });

  it('accepts optional details', () => {
    const err = new ValidationError('Bad', [{ path: 'name' }]);
    expect(err.details).toEqual([{ path: 'name' }]);
  });
});

describe('NotFoundError', () => {
  it('formats resource name in message', () => {
    const err = new NotFoundError('Event');
    expect(err.message).toBe('Event not found');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });
});

describe('UnauthorizedError', () => {
  it('has default message', () => {
    const err = new UnauthorizedError();
    expect(err.message).toBe('Unauthorized');
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('accepts custom message', () => {
    const err = new UnauthorizedError('Token expired');
    expect(err.message).toBe('Token expired');
  });
});

describe('ForbiddenError', () => {
  it('has default message', () => {
    const err = new ForbiddenError();
    expect(err.message).toBe('Forbidden');
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('accepts custom message', () => {
    const err = new ForbiddenError('Not your resource');
    expect(err.message).toBe('Not your resource');
  });
});

describe('ConflictError', () => {
  it('has statusCode 409', () => {
    const err = new ConflictError('Already registered');
    expect(err.message).toBe('Already registered');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
  });
});

describe('RateLimitError', () => {
  it('has statusCode 429', () => {
    const err = new RateLimitError();
    expect(err.message).toBe('Too many requests');
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe('RATE_LIMIT');
  });

  it('sets Retry-After header when retryAfterSeconds provided', () => {
    const err = new RateLimitError(30);
    expect(err.headers).toEqual({ 'Retry-After': '30' });
  });

  it('ceils fractional retryAfterSeconds', () => {
    const err = new RateLimitError(10.3);
    expect(err.headers).toEqual({ 'Retry-After': '11' });
  });

  it('has no headers when retryAfterSeconds omitted', () => {
    const err = new RateLimitError();
    expect(err.headers).toBeUndefined();
  });
});

// ── errorResponse ──────────────────────────────────────────

describe('errorResponse', () => {
  it('handles AppError', async () => {
    const err = new NotFoundError('Event');
    const res = errorResponse(err);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Event not found');
    expect(body.code).toBe('NOT_FOUND');
  });

  it('includes AppError headers', async () => {
    const err = new RateLimitError(60);
    const res = errorResponse(err);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('handles Prisma P2002 (unique constraint)', async () => {
    const prismaError = { code: 'P2002', meta: {} };
    const res = errorResponse(prismaError);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('CONFLICT');
  });

  it('handles Prisma P2025 (record not found)', async () => {
    const prismaError = { code: 'P2025', meta: {} };
    const res = errorResponse(prismaError);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
  });

  it('handles Zod-like errors with issues array', async () => {
    const zodError = {
      issues: [{ path: ['name'], message: 'Required' }],
    };
    const res = errorResponse(zodError);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.issues).toHaveLength(1);
  });

  it('returns 500 for unknown errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = errorResponse(new Error('oops'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('INTERNAL_ERROR');
    spy.mockRestore();
  });

  it('does not expose details in production', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const err = new AppError('fail', 400, 'FAIL', { secret: 'data' });
    const res = errorResponse(err);
    const body = await res.json();
    expect(body.details).toBeUndefined();
    process.env.NODE_ENV = origEnv;
  });

  it('exposes details in development', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const err = new AppError('fail', 400, 'FAIL', { field: 'email' });
    const res = errorResponse(err);
    const body = await res.json();
    expect(body.details).toEqual({ field: 'email' });
    process.env.NODE_ENV = origEnv;
  });
});
